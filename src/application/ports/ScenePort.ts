import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { Discovery } from '@domain/value-objects/Discovery';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { Stabilization } from '@domain/value-objects/Stabilization';

/**
 * La mano del tutorial (ver `setHint`): sobre qué clase de cosa se posa,
 * si insiste, a cuál prefiere y entre cuáles puede elegir.
 */
export interface HintSpec {
  readonly kind: 'animal' | 'text';
  readonly urgent: boolean;
  /** Dónde ponerla si está a la vista (la ballena la primera vez), o null. */
  readonly preferred: string | null;
  /** Ids de animales (o de textos) sobre los que puede ir. */
  readonly candidates: readonly string[];
}

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

  /**
   * Empieza la misma carga que `preload` y resuelve en cuanto se puede
   * ARRANCAR (el motor y el mapa), sin esperar a los modelos: esos van
   * apareciendo sobre el mapa según llegan.
   */
  whenStartable(models: readonly ArModel[]): Promise<void>;

  /** Cuando la carga lanzada termina del todo (modelos incluidos). */
  whenLoaded(): Promise<void>;


  applyPlacement(placement: Placement): void;

  setStabilization(stabilization: Stabilization): void;

  /**
   * La mano del tutorial sobre el propio mapa, o null para retirarla. La
   * escena decide sobre CUÁL de los candidatos (solo ella sabe qué está a
   * la vista): el preferido si se ve, y si la cámara se centra en otro,
   * ese.
   */
  setHint(hint: HintSpec | null): void;

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
   * Avisa cada vez que un animal salpica al tocar el agua, con la fuerza
   * del salpicón (0–1). Es un fotograma exacto de la animación y solo la
   * escena lo sabe.
   */
  onSplash(listener: (modelId: string, strength: number) => void): void;

  /**
   * Avisa cuando el gesto de toque de un animal llega al instante en que
   * suena (su `tapSoundAt`): el canto de la pava al estirar el cuello, el
   * soplido de la ballena al volver a respirar.
   */
  onTapSound(listener: (modelId: string) => void): void;

  /**
   * Lanza el gesto de toque de un animal. Devuelve false si ya estaba a
   * mitad de uno: el gesto no se reinicia hasta que acaba. Con varios
   * ejemplares (las dos ranas), `instance` dice cuál; sin él, el primero
   * que no esté ya a mitad de su gesto.
   */
  pulse(id: ModelId, instance?: number): boolean;

  clear(): void;

  dispose(): void;
}
