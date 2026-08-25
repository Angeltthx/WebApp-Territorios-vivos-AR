import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { Stabilization } from '@domain/value-objects/Stabilization';

/**
 * Abstrae el motor 3D.
 *
 * Nota que NO expone el bucle de render: abstraer 60 llamadas por segundo
 * detrás de una interfaz cuesta rendimiento y legibilidad sin dar nada a
 * cambio. El bucle vive dentro del adaptador.
 */
export interface ScenePort {
  /**
   * Monta TODOS los iconos del catálogo, cada uno clavado a su MarkerSpot.
   * A diferencia de la versión de un solo objeto, aquí no hay uno "activo"
   * que oculte a los demás: los cuatro conviven sobre el mapa.
   */
  preload(models: readonly ArModel[]): Promise<void>;

  /** Destaca uno de los iconos. El resto sigue visible, solo atenuado. */
  setHighlightedModel(id: ModelId): void;

  applyPlacement(placement: Placement): void;

  setStabilization(stabilization: Stabilization): void;

  /** Realimentación visual breve sobre un icono concreto. */
  pulse(id: ModelId): void;

  clear(): void;

  dispose(): void;
}
