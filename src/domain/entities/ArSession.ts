import { Discovery } from '../value-objects/Discovery';
import type { ModelId } from '../value-objects/ModelId';
import { Stabilization } from '../value-objects/Stabilization';
import type { Placement } from './Placement';

export type SessionStatus =
  | 'idle'
  | 'preparing'
  | 'searching'
  | 'tracking'
  | 'lost'
  | 'error';

export type SessionErrorCode =
  | 'unsupported-device'
  | 'camera-denied'
  | 'model-not-found'
  | 'unknown';

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
}

/**
 * Raíz del agregado. Encapsula las transiciones válidas de estado
 * para que la UI no pueda representar combinaciones imposibles.
 */
export class ArSession {
  private constructor(
    readonly status: SessionStatus,
    readonly placement: Placement | null,
    readonly stabilization: Stabilization,
    readonly error: SessionError | null,
    /**
     * Qué animales ha encontrado ya el usuario y cuál está mirando de cerca.
     *
     * Es estado de la sesión y no del motor 3D porque la interfaz depende
     * de él: mientras no haya encontrado ninguno hay que seguir pidiéndole
     * que se acerque, y el nombre y la ficha del que está enfocado salen
     * de aquí.
     */
    readonly discovery: Discovery,
  ) {
    Object.freeze(this);
  }

  static idle(): ArSession {
    return new ArSession('idle', null, Stabilization.default(), null, Discovery.empty());
  }

  preparing(): ArSession {
    return new ArSession('preparing', this.placement, this.stabilization, null, this.discovery);
  }

  searching(placement: Placement): ArSession {
    return new ArSession('searching', placement, this.stabilization, null, this.discovery);
  }

  tracking(): ArSession {
    if (this.placement === null) {
      throw new Error('No se puede pasar a "tracking" sin un Placement previo');
    }
    return new ArSession('tracking', this.placement, this.stabilization, null, this.discovery);
  }

  /**
   * Perder el mapa NO toca lo descubierto ni el primer plano.
   *
   * Es deliberado y es media funcionalidad: mirar de cerca a un animal
   * significa poder apartar el teléfono del mapa y seguir mirándolo. Si
   * perder el marcador cerrara la ficha, el gesto natural de alejarse para
   * verlo mejor la haría desaparecer.
   */
  lost(): ArSession {
    return new ArSession('lost', this.placement, this.stabilization, null, this.discovery);
  }

  failed(code: SessionErrorCode, message: string): ArSession {
    return new ArSession(
      'error',
      this.placement,
      this.stabilization,
      { code, message },
      this.discovery.focus(null),
    );
  }

  withPlacement(placement: Placement): ArSession {
    return new ArSession(
      this.status,
      placement,
      this.stabilization,
      this.error,
      this.discovery,
    );
  }

  withStabilization(stabilization: Stabilization): ArSession {
    return new ArSession(
      this.status,
      this.placement,
      stabilization,
      this.error,
      this.discovery,
    );
  }

  /**
   * Cambia lo descubierto. Descubrir solo tiene sentido mientras se rastrea
   * el mapa; cerrar el primer plano se permite siempre, para que la X
   * funcione aunque el mapa se salga de cuadro en ese instante.
   */
  withDiscovery(discovery: Discovery): ArSession {
    if (!this.hasStarted) return this;
    return new ArSession(this.status, this.placement, this.stabilization, this.error, discovery);
  }

  get activeModelId(): ModelId | null {
    return this.placement?.modelId ?? null;
  }

  /** ¿El objeto está visible y es manipulable ahora mismo? */
  get isInteractive(): boolean {
    return this.status === 'tracking' && this.placement !== null;
  }

  /**
   * ¿Hay que seguir pidiéndole al usuario que se acerque a un animal?
   *
   * Solo mientras ve el mapa, no está mirando ninguno de cerca y no ha
   * encontrado todavía a ninguno. En cuanto aparece el primero la
   * instrucción sobra: ya entendió el gesto y lo repetirá solo.
   */
  get needsApproachHint(): boolean {
    return this.status === 'tracking' && !this.discovery.hasAny;
  }

  /**
   * Una sesión en 'error' NO cuenta como iniciada: el usuario debe poder
   * reintentar sin recargar la página (típico tras denegar la cámara
   * por accidente y luego concederla en ajustes).
   */
  get hasStarted(): boolean {
    return this.status === 'searching' || this.status === 'tracking' || this.status === 'lost';
  }

  get canStart(): boolean {
    return this.status === 'idle' || this.status === 'error';
  }
}
