import { ArModel, type ArModelSnapshot } from '@domain/entities/ArModel';
import { ModelSource } from '@domain/value-objects/ModelSource';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { ModelRepository } from '@application/ports/ModelRepository';

/**
 * Fase 1: catálogo en memoria.
 * Fase 2: creas HttpModelRepository implementando la MISMA interfaz y
 * cambias una línea en container.ts. Nada más se toca.
 */
export class StaticModelRepository implements ModelRepository {
  private readonly models: readonly ArModel[];

  constructor(snapshots: readonly ArModelSnapshot[]) {
    if (snapshots.length === 0) {
      throw new RangeError('El catálogo no puede estar vacío');
    }
    this.models = snapshots.map(ArModel.fromSnapshot);
  }

  async findById(id: ModelId): Promise<ArModel | null> {
    return this.models.find((model) => model.id.equals(id)) ?? null;
  }

  async findAll(): Promise<readonly ArModel[]> {
    return this.models;
  }
}

/**
 * Fauna del mapa de Nuquí (Chocó).
 *
 * Cada `spot` es la posición del animal sobre `public/targets/map.jpg`, en
 * coordenadas normalizadas 0–1 desde la esquina SUPERIOR IZQUIERDA. Están
 * medidos sobre la imagen de 880×1280 y verificados dibujando una mira
 * encima:
 *
 *     node scripts/preview-spots.mjs \
 *       '[{"u":0.262,"v":0.220},{"u":0.884,"v":0.264}]' salida.jpg
 *
 * Si algún día se reemplaza el mapa, hay que volver a medir estos cuatro
 * valores y recompilar el target — son solidarios con esa imagen concreta.
 *
 * Los timbres son deliberadamente distintos para que se reconozcan de oído
 * sin mirar la pantalla.
 *
 * La geometría son los .glb del diseñador del equipo, en public/models/.
 * Llegan modelados en unidades de Blender (entre 9 y 23 de lado, con el
 * pivote descentrado): IconLoader los recentra y los encaja a ICON_TARGET_SIZE
 * al cargarlos, así que aquí no hay que tocar `defaultScale` por modelo.
 *
 * Los cuatro van en `view: 'front'`: erguidos sobre el mapa y mirando a
 * quien sostiene el teléfono. Arrastrando el dedo se giran hacia los lados,
 * así que quien quiera ver a un animal de perfil lo gira.
 *
 * `iconSize` es por animal porque de frente cada uno enseña una silueta
 * distinta: la pava se ve entera, la tortuga es baja y ancha, y la ballena
 * se ve escorzada porque su longitud apunta a la cámara. Los números están
 * medidos en pantalla, no calculados sobre el tamaño del archivo.
 *
 * Si un .glb faltara, ese animal cae a un disco gris y los otros tres siguen
 * funcionando. Para volver a los iconos procedurales de PrimitiveFactory —que
 * siguen ahí y no necesitan ningún archivo— basta con cambiar su `source` de
 * vuelta a `ModelSource.primitive(...)`.
 */
export const NUQUI_CATALOG: readonly ArModelSnapshot[] = [
  {
    id: 'whale',
    name: '🐋 Ballena',
    source: ModelSource.gltf('/models/Ballena_PBR.glb'),
    spot: { u: 0.262, v: 0.22 },
    // Lo más grande que cabe de frente sin hundirse en el papel: mirando a
    // la cámara la ballena se extiende HACIA FUERA, no a lo ancho, así que
    // el límite lo pone su fondo, no su silueta. Silueta: 0.204 x 0.141.
    view: 'front',
    iconSize: 3.2,
    facing: 0,
    defaultScale: 1,
    sound: {
      // Canto grave y largo, lo más cerca que se llega de una jorobada
      // con tres osciladores.
      waveform: 'sine',
      rootFrequencyHz: 90,
      overtoneRatios: [1, 1.5, 2.02],
      durationMs: 1800,
    },
  },
  {
    id: 'bird',
    name: '🦃 Pava',
    source: ModelSource.gltf('/models/Pava_PBR.glb'),
    spot: { u: 0.884, v: 0.264 },
    // La referencia de tamaño del conjunto: es la que ya se veía bien.
    // Silueta 0.219 x 0.155, prácticamente la de su dibujo (0.22).
    view: 'front',
    iconSize: 1.8,
    facing: 0,
    defaultScale: 1,
    sound: {
      // Graznido: agudo, corto y con armónicos impares que lo hacen áspero.
      waveform: 'square',
      rootFrequencyHz: 520,
      overtoneRatios: [1, 3, 5.1],
      durationMs: 320,
    },
  },
  {
    id: 'crab',
    name: '🦀 Cangrejo',
    source: ModelSource.gltf('/models/Cangrejo_PBR.glb'),
    spot: { u: 0.487, v: 0.472 },
    // Ya se veía de frente; 'front' es exactamente la misma orientación
    // que tenía con 'side' + 90°, escrita de forma directa.
    view: 'front',
    iconSize: 1.2,
    facing: 0,
    defaultScale: 1,
    sound: {
      // Chasquido de pinza: armónicos no enteros, muy breve. 140 ms era
      // tan corto que en un móvil con ruido alrededor se confundía con no
      // haber sonado; 220 sigue siendo un chasquido pero no deja dudas.
      waveform: 'triangle',
      rootFrequencyHz: 880,
      overtoneRatios: [1, 2.76, 5.4],
      durationMs: 220,
    },
  },
  {
    id: 'turtle',
    name: '🐢 Tortuga',
    source: ModelSource.gltf('/models/Tortuga_PBR.glb'),
    spot: { u: 0.38, v: 0.635 },
    // De frente es una silueta baja y ancha —una tortuga lo es—, así que
    // se agranda por encima de su dibujo para que no quede como una raya.
    view: 'front',
    iconSize: 2,
    facing: 0,
    defaultScale: 1,
    sound: {
      // Burbujeo redondo y tranquilo, a juego con cómo se mueve.
      waveform: 'sine',
      rootFrequencyHz: 240,
      overtoneRatios: [1, 2, 3],
      durationMs: 620,
    },
  },
];
