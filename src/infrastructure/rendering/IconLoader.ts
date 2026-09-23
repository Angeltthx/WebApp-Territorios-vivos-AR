import {
  Box3,
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
 * MarkerPin luego aplica su propio ICON_SCALE (0.58), así que en pantalla
 * un icono acaba ocupando ~0.12 — dentro del halo, que mide 0.20 de
 * diámetro, sin tapar al animal dibujado debajo.
 */
export const ICON_TARGET_SIZE = 0.21;

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

  async load(model: ArModel): Promise<Object3D> {
    // Cada animal ocupa lo suyo: una ballena no puede salir del tamaño de un
    // cangrejo. El factor vive en el catálogo (IconPose.size).
    const targetSize = ICON_TARGET_SIZE * model.pose.size;

    if (model.source.kind === 'primitive') {
      const { createPrimitive } = await import('./PrimitiveFactory');
      // Las figuras procedurales SÍ están dibujadas a mano con proporciones
      // pensadas entre sí, así que no se normalizan: solo se les aplica el
      // factor del catálogo, envuelto para que MarkerPin no lo pise.
      return wrapScaled(createPrimitive(model.source.shape, model.source.colorHex), model.pose.size);
    }

    try {
      const gltf = await this.gltf.loadAsync(model.source.url);
      return fitToIconSize(gltf.scene, targetSize);
    } catch (error) {
      // Respaldo deliberado: si un .glb falta o falla, el resto del
      // catálogo sigue funcionando en vez de tumbar toda la sesión.
      console.warn(`[IconLoader] No se pudo cargar ${model.source.url}`, error);
      return buildMissingMarker();
    }
  }

  /** Libera los workers de Draco. Sin esto quedan hilos vivos al parar. */
  dispose(): void {
    this.draco.dispose();
  }
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
export function fitToIconSize(object: Object3D, targetSize = ICON_TARGET_SIZE): Object3D {
  const box = new Box3().setFromObject(object);

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
