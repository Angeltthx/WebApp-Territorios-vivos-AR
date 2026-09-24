import type { MapText } from '@domain/value-objects/MapText';

/** Los textos impresos en el mapa que se pueden abrir para leer en grande. */
export interface MapTextRepository {
  findAll(): Promise<readonly MapText[]>;
  findById(id: string): Promise<MapText | null>;
}
