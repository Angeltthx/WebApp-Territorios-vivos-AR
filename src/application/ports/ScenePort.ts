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
  /** Carga todo el catálogo por adelantado para que cambiar sea instantáneo. */
  preload(models: readonly ArModel[]): Promise<void>;

  setActiveModel(id: ModelId): void;

  applyPlacement(placement: Placement): void;

  setStabilization(stabilization: Stabilization): void;

  /** Realimentación visual breve al tocar el objeto. */
  pulse(): void;

  clear(): void;

  dispose(): void;
}
