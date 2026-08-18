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
 * Catálogo de demostración: tres objetos con timbres deliberadamente
 * distintos para que se distingan al oído sin mirar la pantalla.
 *
 * Los tres usan geometría procedural, así que la app funciona en cuanto
 * la despliegas, sin necesidad de conseguir ni subir archivos .glb.
 * Para usar los tuyos: cambia `source` por ModelSource.gltf('/models/x.glb').
 */
export const DEMO_CATALOG: readonly ArModelSnapshot[] = [
  {
    id: 'headphones',
    name: 'Audífonos',
    source: ModelSource.primitive('headphones', 0xe8442f),
    defaultScale: 0.85,
    sound: {
      // Timbre grave y redondo, tipo golpe sordo.
      waveform: 'sine',
      rootFrequencyHz: 110,
      overtoneRatios: [1, 2, 3.2],
      durationMs: 700,
    },
  },
  {
    id: 'crystal',
    name: 'Cristal',
    source: ModelSource.primitive('crystal', 0x4ea8ff),
    defaultScale: 1,
    sound: {
      // Campana: armónicos no enteros, que es lo que da el brillo metálico.
      waveform: 'triangle',
      rootFrequencyHz: 660,
      overtoneRatios: [1, 2.76, 5.4, 8.93],
      durationMs: 1600,
    },
  },
  {
    id: 'knot',
    name: 'Nudo',
    source: ModelSource.primitive('torus-knot', 0xf5c542),
    defaultScale: 1,
    sound: {
      // Blip sintético, corto y con cuerpo por los armónicos impares.
      waveform: 'square',
      rootFrequencyHz: 330,
      overtoneRatios: [1, 3, 5],
      durationMs: 320,
    },
  },
];
