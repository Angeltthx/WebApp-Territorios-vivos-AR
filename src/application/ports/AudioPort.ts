import type { SoundProfile } from '@domain/value-objects/SoundProfile';

export interface AudioPort {
  /**
   * iOS y Chrome bloquean el audio hasta que hay un gesto del usuario.
   * Hay que llamar esto DENTRO del handler de un click/tap real.
   */
  unlock(): Promise<void>;

  play(profile: SoundProfile): void;

  dispose(): void;
}
