import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { Discovery } from '@domain/value-objects/Discovery';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { Proximity } from '@domain/value-objects/Proximity';
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

  /** Regla que decide a qué distancia sale cada animal de su escondite. */
  setProximity(proximity: Proximity): void;

  /**
   * Pone la escena de acuerdo con lo descubierto: qué animales están fuera
   * de su contorno y cuál se está mirando en primer plano.
   *
   * Una sola llamada en vez de un método por cosa. Lo descubierto es un
   * estado, no una secuencia de sucesos, y pasarlo entero evita que la
   * escena y la sesión puedan discrepar.
   */
  applyDiscovery(discovery: Discovery): void;

  /**
   * Avisa cuando cambia qué animal está lo bastante cerca, o null si
   * ninguno lo está.
   *
   * Va por aquí y no por InteractionPort porque no nace de un gesto: nace
   * de la geometría de la escena, que es justo lo que este adaptador tiene
   * y el interior no. El mismo reparto que TrackingPort, que avisa de que
   * apareció el marcador sin que nadie se lo pida.
   */
  onNearbyModel(listener: (modelId: string | null) => void): void;

  /** Realimentación visual breve sobre un icono concreto. */
  pulse(id: ModelId): void;

  clear(): void;

  dispose(): void;
}
