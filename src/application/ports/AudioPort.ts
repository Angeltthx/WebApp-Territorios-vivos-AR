import type { SoundProfile } from '@domain/value-objects/SoundProfile';

export interface AudioPort {
  /**
   * iOS y Chrome bloquean el audio hasta que hay un gesto del usuario.
   * Hay que llamar esto DENTRO del handler de un click/tap real.
   */
  unlock(): Promise<void>;

  /** Timbre sintetizado: el respaldo de un animal sin grabaciones. */
  play(profile: SoundProfile): void;
  /**
   * Descarga y decodifica grabaciones por adelantado. Sin garantías: lo que
   * no llegue a tiempo se descarga al reproducirlo.
   */
  preload(urls: readonly string[]): void;
  /** Una grabación, una vez. Si tarda demasiado en llegar, no suena: tarde confunde. */
  playClip(url: string): void;
  /**
   * Ambiente en bucle y sin costuras. Sustituye con un fundido al que
   * estuviera sonando; con la misma ruta, no hace nada.
   */
  startAmbience(url: string): void;
  /** Apaga el ambiente con un fundido. */
  stopAmbience(): void;

  dispose(): void;
}
