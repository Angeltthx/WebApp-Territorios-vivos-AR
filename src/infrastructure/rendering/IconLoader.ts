import {
  AnimationMixer,
  Box3,
  AnimationClip,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ArModel } from '@domain/entities/ArModel';

/**
 * De un ArModel a un Object3D listo para colgar de un MarkerPin.
 *
 * Vive aparte del ThreeSceneAdapter por la misma razón que MarkerPin: no
 * depende de MindAR, así que `verify.html` puede construir exactamente los
 * mismos iconos que la app —incluidos los .glb— sin cámara ni teléfono.
 *
 * CONTRATO CON MarkerPin: lo que se devuelve tiene su lado mayor midiendo
 * ICON_TARGET_SIZE, está centrado en su propio origen, y tiene `scale` y
 * `rotation` LIBRES. MarkerPin las sobrescribe en cada frame, así que
 * ninguna corrección puede quedarse guardada ahí (ver `fitToIconSize`).
 */

/**
 * Tamaño natural de un icono, en unidades de marcador (ancho del mapa = 1).
 *
 * Es el tamaño al que PrimitiveFactory dibuja a mano sus figuras: medido
 * sobre ellas, el lado mayor va de 0.20 (tortuga) a 0.26 (ballena). Al
 * normalizar los .glb a este mismo número, los modelos reales y los
 * procedurales se ven del mismo tamaño y se pueden mezclar en el catálogo
 * sin que nada dé un salto.
 *
 * MarkerPin luego aplica su propio ICON_SCALE (0.72). El catálogo conserva
 * la jerarquía entre especies y el ajuste final se verifica sobre el mapa.
 */
export const ICON_TARGET_SIZE = 0.21;

export interface LoadedIcon {
  readonly object: Object3D;
  readonly animations: readonly AnimationClip[];
  /** Segundo del clip de toque en que el animal cae al agua, si cae. */
  readonly splashAt: number | null;
}

/**
 * Carga la geometría de los modelos del catálogo.
 *
 * Una instancia por sesión: GLTFLoader y DRACOLoader mantienen caché y un
 * pool de workers, y crearlos por modelo desperdicia ambos.
 */
export class IconLoader {
  private readonly gltf = new GLTFLoader();
  private readonly draco = new DRACOLoader();

  constructor() {
    // Los .glb de la fauna piden KHR_draco_mesh_compression en
    // `extensionsRequired`. Sin decodificador, GLTFLoader no los abre y
    // todos caerían al marcador gris. Los archivos se copian a
    // public/draco/ desde el propio three (ver el README de esa carpeta).
    //
    // EXT_texture_webp, que también viene en `extensionsRequired`, sí lo
    // soporta three 0.160 de fábrica: no hay nada que configurar.
    this.draco.setDecoderPath('/draco/');
    this.draco.setWorkerLimit(2);
    this.gltf.setDRACOLoader(this.draco);
  }

  async load(model: ArModel): Promise<LoadedIcon> {
    // Cada animal ocupa lo suyo: una ballena no puede salir del tamaño de un
    // cangrejo. El factor vive en el catálogo (IconPose.size).
    const targetSize = ICON_TARGET_SIZE * model.pose.size;

    if (model.source.kind === 'primitive') {
      const { createPrimitive } = await import('./PrimitiveFactory');
      // Las figuras procedurales SÍ están dibujadas a mano con proporciones
      // pensadas entre sí, así que no se normalizan: solo se les aplica el
      // factor del catálogo, envuelto para que MarkerPin no lo pise.
      return {
        object: wrapScaled(createPrimitive(model.source.shape, model.source.colorHex), model.pose.size),
        animations: [],
        splashAt: null,
      };
    }

    try {
      const gltf = await this.gltf.loadAsync(model.source.url);
      // Una malla con esqueleto conserva la esfera de recorte de su pose de
      // reposo: cuando el clip la desplaza, three la cree fuera de cámara y
      // deja de dibujarla. Así "desaparecía" la ballena a mitad de salto.
      // Son cuatro modelos; recortarlos no ahorra nada que se note.
      gltf.scene.traverse((node) => { node.frustumCulled = false; });

      let animations = gltf.animations;
      let splashAt: number | null = null;
      const tapClip = model.animation?.tapClip ?? null;
      if (model.animation?.tapMove === 'breach' && tapClip !== null) {
        animations = animations.map((clip) => {
          if (clip.name !== tapClip) return clip;
          const tamed = tameBreach(clip);
          splashAt = tamed.impactSeconds;
          return tamed.clip;
        });
      }

      // Se mide con el bucle ambiental, que es lo que se ve casi siempre: la
      // pose de reposo del archivo puede ser menor que la de nado. El gesto
      // de toque NO entra en la medida —el salto de la ballena la encogía a
      // la mitad para que cupiera un salto que dura dos segundos—.
      const ambient = animations.filter(
        (clip) => model.animation?.steps.some((step) => step.name === clip.name) ?? false,
      );
      return {
        object: fitToIconSize(gltf.scene, targetSize, ambient),
        animations,
        splashAt,
      };
    } catch (error) {
      // Respaldo deliberado: si un .glb falta o falla, el resto del
      // catálogo sigue funcionando en vez de tumbar toda la sesión.
      console.warn(`[IconLoader] No se pudo cargar ${model.source.url}`, error);
      return { object: buildMissingMarker(), animations: [], splashAt: null };
    }
  }

  /** Libera los workers de Draco. Sin esto quedan hilos vivos al parar. */
  dispose(): void {
    this.draco.dispose();
  }
}

/** Cuánto de la altura original del salto se conserva, y cuánto del avance. */
const BREACH_HEIGHT = 0.42;
const BREACH_TRAVEL = 0.12;
/** Lo que se hunde tras caer, en proporción a la altura del salto. */
const BREACH_SINK = 0.18;

/**
 * Doma el `Jump` de la ballena para que quepa en un mapa.
 *
 * En el archivo la cadera sube 19 unidades y avanza 20 —casi el largo del
 * animal— y tarda 6 segundos en volver del agua. Se conservan intactos el
 * cabeceo y el giro de 180° sobre el lomo (eso ES el salto) y se rehace la
 * trayectoria de la cadera con la misma cadencia:
 *
 *   - subida: la curva original, a BREACH_HEIGHT de su altura;
 *   - caída: una parábola que llega al agua en el mismo fotograma en que
 *     el original frena al chocar (`impactSeconds`, donde va el salpicón);
 *   - después: se hunde un poco y sale despacio, en vez de quedarse flotando
 *     a media altura como hacía el original.
 *
 * El avance se reduce a BREACH_TRAVEL: de perfil, avanzar es cruzar el mapa.
 */
export function tameBreach(clip: AnimationClip): { clip: AnimationClip; impactSeconds: number | null } {
  const tamed = clip.clone();
  let impactSeconds: number | null = null;

  for (const track of tamed.tracks) {
    if (!/Hips\.position$/.test(track.name)) continue;
    const times = track.times;
    const values = track.values;
    const count = times.length;
    if (count < 2) continue;

    const y0 = values[1]!;
    const z0 = values[2]!;
    let peak = 0;
    for (let i = 1; i < count; i += 1) if (values[i * 3 + 1]! > values[peak * 3 + 1]!) peak = i;
    const rise = values[peak * 3 + 1]! - y0;
    if (rise <= 0) continue;

    // El choque: el primer fotograma tras la cima en que ya ha caído un
    // cuarto. Ahí el original pasa de caer en picado a casi pararse.
    let impact = count - 1;
    for (let i = peak; i < count; i += 1) {
      if (values[i * 3 + 1]! < y0 + rise * 0.75) { impact = i; break; }
    }
    impactSeconds = times[impact]!;
    const tPeak = times[peak]!;
    const tEnd = times[count - 1]!;
    const height = rise * BREACH_HEIGHT;

    for (let i = 0; i < count; i += 1) {
      const t = times[i]!;
      let y: number;
      if (i <= peak) {
        y = y0 + (values[i * 3 + 1]! - y0) * BREACH_HEIGHT;
      } else if (t <= impactSeconds) {
        const fall = (t - tPeak) / Math.max(impactSeconds - tPeak, 1e-6);
        y = y0 + height * (1 - fall * fall);
      } else {
        const after = (t - impactSeconds) / Math.max(tEnd - impactSeconds, 1e-6);
        y = y0 - height * BREACH_SINK * Math.sin(Math.PI * after);
      }
      values[i * 3 + 1] = y;
      values[i * 3 + 2] = z0 + (values[i * 3 + 2]! - z0) * BREACH_TRAVEL;
    }
  }

  return { clip: tamed, impactSeconds };
}

/**
 * Encaja un modelo cualquiera en la escala y el origen que espera MarkerPin.
 *
 * Hace falta porque un .glb llega modelado en las unidades que le vinieran
 * bien a quien lo hizo —los de la fauna de Nuquí miden entre 9 y 23 unidades
 * de lado— mientras que aquí el MAPA ENTERO mide 1. Sin esto, la ballena
 * saldría 23 veces más grande que el mapa que la contiene.
 *
 * Además recentra: el pivote de un export de Blender suele quedar en la base
 * o en una esquina de la caja (en estos modelos, hasta 5 unidades fuera del
 * centro), y un icono descentrado parece un error de coordenadas cuando en
 * realidad lo que falla es el origen del archivo.
 *
 * La jerarquía de tres niveles NO es decorativa:
 *
 *     wrapper   ← se devuelve; MarkerPin manda sobre su scale y su rotation
 *       └── fit ← guarda el factor de normalización, a salvo de MarkerPin
 *             └── modelo (desplazado -centro, así su caja queda en el origen)
 *
 * Si se devolviera `fit` directamente, el `icon.scale.setScalar(...)` que
 * MarkerPin ejecuta en cada frame borraría la normalización y el modelo
 * volvería a su tamaño original.
 */
export function fitToIconSize(
  object: Object3D,
  targetSize = ICON_TARGET_SIZE,
  clips: readonly AnimationClip[] = [],
): Object3D {
  const box = new Box3().setFromObject(object);
  if (clips.length > 0) {
    const mixer = new AnimationMixer(object);
    for (const clip of clips) {
      const action = mixer.clipAction(clip).reset().play();
      const step = clip.duration / 8;
      for (let sample = 0; sample <= 8; sample++) {
        mixer.update(sample === 0 ? 0 : step);
        object.updateMatrixWorld(true);
        box.union(new Box3().setFromObject(object, true));
      }
      action.stop();
    }
    mixer.uncacheRoot(object);
  }

  // Un modelo sin geometría legible da una caja vacía (min > max). Devolver
  // el objeto tal cual es mejor que dividir por cero o por Infinity.
  if (box.isEmpty()) return object;

  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest <= 0) return object;

  object.position.sub(center);

  const fit = new Group();
  fit.scale.setScalar(targetSize / largest);
  fit.add(object);

  const wrapper = new Group();
  wrapper.add(fit);
  return wrapper;
}

/**
 * Envuelve un objeto en un grupo escalado.
 *
 * Mismo motivo que la jerarquía de `fitToIconSize`: MarkerPin sobrescribe el
 * `scale` de lo que se le entrega en cada frame, así que cualquier factor
 * propio tiene que ir en un nodo interior.
 */
function wrapScaled(object: Object3D, factor: number): Object3D {
  if (factor === 1) return object;

  const scaled = new Group();
  scaled.scale.setScalar(factor);
  scaled.add(object);

  const wrapper = new Group();
  wrapper.add(scaled);
  return wrapper;
}

/** Marcador gris y neutro para un modelo que no se pudo cargar. */
export function buildMissingMarker(): Object3D {
  return new Mesh(
    new CircleGeometry(0.06, 20),
    new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9, side: DoubleSide }),
  );
}
