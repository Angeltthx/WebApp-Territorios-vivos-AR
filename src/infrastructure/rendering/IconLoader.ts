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
  /**
   * Segundos DEL CLIP de toque en que salpica, y con qué fuerza: la ballena
   * al romper la superficie subiendo y al volver a cruzarla cayendo.
   */
  readonly splashes: readonly ClipSplash[];
}

export interface ClipSplash {
  readonly at: number;
  readonly strength: number;
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
        splashes: [],
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
      let splashes: readonly ClipSplash[] = [];
      const tapClip = model.animation?.tapClip ?? null;
      if (model.animation?.tapMove === 'breach' && tapClip !== null) {
        animations = animations.map((clip) => {
          if (clip.name !== tapClip) return clip;
          const tamed = tameBreach(clip);
          splashes = tamed.splashes;
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
        splashes,
      };
    } catch (error) {
      // Respaldo deliberado: si un .glb falta o falla, el resto del
      // catálogo sigue funcionando en vez de tumbar toda la sesión.
      console.warn(`[IconLoader] No se pudo cargar ${model.source.url}`, error);
      return { object: buildMissingMarker(), animations: [], splashes: [] };
    }
  }

  /** Libera los workers de Draco. Sin esto quedan hilos vivos al parar. */
  dispose(): void {
    this.draco.dispose();
  }
}

/**
 * A qué escala se reproduce la trayectoria de la cadera: la MISMA para la
 * altura y para el avance, así el arco conserva la forma que le dio el
 * animador. En el archivo sube 19 unidades y avanza 20 —casi el largo del
 * animal—, que en un mapa es cruzarlo.
 */
const BREACH_SCALE = 0.42;
/**
 * Lo que se hunde tras caer, en proporción a la altura del salto: tanto
 * como saltó. Con la mitad apenas se mojaba —se pidió que se viera meterse
 * de verdad en el agua—; así queda casi entera por debajo de la superficie,
 * que la recorta (ver MarkerPin).
 */
const BREACH_SINK = 1;
/**
 * Dónde está la superficie del agua, en fracción de la altura del salto
 * sobre la cadera en reposo: la ballena nada justo por debajo, y al saltar
 * la rompe algo antes de llegar a esa altura.
 */
const BREACH_SURFACE = 0.3;
/** Fuerza de cada salpicón: suave al salir, pleno al caer. */
const BREACH_EXIT_SPLASH = 0.45;
const BREACH_ENTRY_SPLASH = 1;

/**
 * Adapta el `Jump` de la ballena al mapa tocando lo mínimo.
 *
 * Del archivo se conserva TODO el tiempo (se reproduce a velocidad 1: la
 * versión anterior lo ponía a 1.8× y los animadores lo notaron) y todos
 * los giros: sube con el morro hacia arriba, se pone de espaldas en la
 * cima, cae y pica de morro, y se endereza. Se conserva también la subida
 * de la cadera, con la forma de su curva, a BREACH_SCALE.
 *
 * Lo único que se reescribe es la cadera DESPUÉS de la cima:
 *
 *   - la caída es un arco que dura lo mismo que tardó en subir, así que
 *     arranca suave en la cima y va cogiendo velocidad. La versión anterior
 *     caía en un cuarto de segundo lo que había subido en dos y medio, y
 *     paraba en seco: parecía chocar contra un suelo;
 *   - al llegar a su profundidad de nado sigue bajando con la velocidad
 *     que traía, el agua la frena poco a poco
 *     —misma pendiente a los dos lados del impacto, sin golpe— y, ya
 *     sumergida, vuelve a flote con entrada y salida suaves. Coincide con el
 *     tramo en que el propio clip la pone de morro hacia abajo y luego la
 *     endereza.
 *
 * El avance también va a BREACH_SCALE, incluida la vuelta al punto de
 * partida que el clip ya trae (mientras está bajo el agua).
 *
 * Salpica DOS veces, como la tortuga: al romper la superficie subiendo
 * (suave) y al volver a cruzarla cayendo (fuerte). La superficie está por
 * encima de la ballena (BREACH_SURFACE): con el salpicón a la altura de su
 * vientre, al caer parecía que chocaba contra un suelo.
 */
export function tameBreach(clip: AnimationClip): { clip: AnimationClip; splashes: readonly ClipSplash[] } {
  const tamed = clip.clone();
  let splashes: ClipSplash[] = [];

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

    // Cuánto tardó en subir: desde que despega (un 10 % de la altura) hasta
    // la cima. La caída dura lo mismo.
    let takeoff = 0;
    for (let i = 0; i <= peak; i += 1) {
      if (values[i * 3 + 1]! >= y0 + rise * 0.1) { takeoff = i; break; }
    }
    const tPeak = times[peak]!;
    const tEnd = times[count - 1]!;
    const fall = Math.max(tPeak - times[takeoff]!, 1e-3);
    const impact = Math.min(tPeak + fall, tEnd - 1e-3);

    const height = rise * BREACH_SCALE;
    const sink = height * BREACH_SINK;
    // Velocidad al llegar al agua; el agua la frena con esta constante.
    const entrySpeed = (2 * height) / fall;
    const tau = sink / entrySpeed;
    // Empieza a volver cuando ya ha bajado un 86 % (dos constantes de
    // tiempo): con más profundidad, esperar a tres dejaba muy poco para subir.
    const surfacing = Math.min(impact + 2 * tau, tEnd);

    for (let i = 0; i < count; i += 1) {
      const t = times[i]!;
      let y: number;
      if (i <= peak) {
        y = y0 + (values[i * 3 + 1]! - y0) * BREACH_SCALE;
      } else if (t <= impact) {
        const x = (t - tPeak) / fall;
        y = y0 + height * (1 - x * x);
      } else {
        const back = smoothstep((t - surfacing) / Math.max(tEnd - surfacing, 1e-3));
        y = y0 - sink * (1 - Math.exp(-(t - impact) / tau)) * (1 - back);
      }
      values[i * 3 + 1] = y;
      values[i * 3 + 2] = z0 + (values[i * 3 + 2]! - z0) * BREACH_SCALE;
    }

    // Los dos salpicones, donde la cadera cruza la superficie: subiendo
    // (sobre la curva original, interpolando entre fotogramas) y cayendo
    // (sobre la parábola, que se sabe resolver).
    const surface = y0 + height * BREACH_SURFACE;
    let exit = times[takeoff]!;
    for (let i = 1; i <= peak; i += 1) {
      const a = values[(i - 1) * 3 + 1]!;
      const b = values[i * 3 + 1]!;
      if (a < surface && b >= surface) {
        exit = times[i - 1]! + ((surface - a) / (b - a)) * (times[i]! - times[i - 1]!);
        break;
      }
    }
    const entry = tPeak + fall * Math.sqrt(1 - BREACH_SURFACE);
    splashes = [
      { at: exit, strength: BREACH_EXIT_SPLASH },
      { at: entry, strength: BREACH_ENTRY_SPLASH },
    ];
  }

  return { clip: tamed, splashes };
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
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
