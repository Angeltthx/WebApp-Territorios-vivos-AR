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
 * `view` e `iconSize` son por animal a propósito. Una sola regla global no
 * sirve: la ballena y la pava están dibujadas de lado y de perfil se
 * reconocen; el cangrejo y la tortuga están dibujados en planta y así se
 * quedan. Y una ballena no puede ocupar lo mismo que un cangrejo.
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
    // De perfil y grande: es el animal más grande del mapa y en la
    // ilustración está dibujada de lado. Vista en planta no se reconocía.
    view: 'side',
    iconSize: 1.6,
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
    // También de perfil: un ave vista desde arriba es una mancha.
    view: 'side',
    iconSize: 1.1,
    defaultScale: 1,
    sound: {
      // Graznido: agudo, corto y con armónicos impares que lo hacen áspero.
      waveform: 'square',
      rootFrequencyHz: 520,
      overtoneRatios: [1, 3, 5.1],
      durationMs: 260,
    },
  },
  {
    id: 'crab',
    name: '🦀 Cangrejo',
    source: ModelSource.gltf('/models/Cangrejo_PBR.glb'),
    spot: { u: 0.487, v: 0.472 },
    // En planta, como está dibujado: es su silueta reconocible.
    view: 'top',
    iconSize: 1,
    defaultScale: 1,
    sound: {
      // Chasquido de pinza: armónicos no enteros, muy breve.
      waveform: 'triangle',
      rootFrequencyHz: 880,
      overtoneRatios: [1, 2.76, 5.4],
      durationMs: 140,
    },
  },
  {
    id: 'turtle',
    name: '🐢 Tortuga',
    source: ModelSource.gltf('/models/Tortuga_PBR.glb'),
    spot: { u: 0.38, v: 0.635 },
    view: 'top',
    iconSize: 1.15,
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
