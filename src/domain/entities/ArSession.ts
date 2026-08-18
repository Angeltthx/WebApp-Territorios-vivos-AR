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
  ) {
    Object.freeze(this);
  }

  static idle(): ArSession {
    return new ArSession('idle', null, Stabilization.default(), null);
  }

  preparing(): ArSession {
    return new ArSession('preparing', this.placement, this.stabilization, null);
  }

  searching(placement: Placement): ArSession {
    return new ArSession('searching', placement, this.stabilization, null);
  }

  tracking(): ArSession {
    if (this.placement === null) {
      throw new Error('No se puede pasar a "tracking" sin un Placement previo');
    }
    return new ArSession('tracking', this.placement, this.stabilization, null);
  }

  lost(): ArSession {
    return new ArSession('lost', this.placement, this.stabilization, null);
  }

  failed(code: SessionErrorCode, message: string): ArSession {
    return new ArSession('error', this.placement, this.stabilization, { code, message });
  }

  withPlacement(placement: Placement): ArSession {
    return new ArSession(this.status, placement, this.stabilization, this.error);
  }

  withStabilization(stabilization: Stabilization): ArSession {
    return new ArSession(this.status, this.placement, stabilization, this.error);
  }

  get activeModelId(): ModelId | null {
    return this.placement?.modelId ?? null;
  }

  /** ¿El objeto está visible y es manipulable ahora mismo? */
  get isInteractive(): boolean {
    return this.status === 'tracking' && this.placement !== null;
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
