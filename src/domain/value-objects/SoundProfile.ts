export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface SoundSnapshot {
  readonly waveform: Waveform;
  readonly rootFrequencyHz: number;
  /** Múltiplos de la fundamental que dan el timbre. [1] = tono puro. */
  readonly overtoneRatios: readonly number[];
  readonly durationMs: number;
}

/**
 * Describe un sonido de forma declarativa, sin archivos de audio.
 *
 * El dominio define QUÉ suena; el adaptador de Web Audio decide CÓMO
 * sintetizarlo. Así no hay MP3 que licenciar, descargar ni cachear,
 * y el bundle no crece.
 */
export class SoundProfile {
  static readonly MIN_HZ = 40;
  static readonly MAX_HZ = 4000;
  static readonly MAX_DURATION_MS = 4000;

  private constructor(
    readonly waveform: Waveform,
    readonly rootFrequencyHz: number,
    readonly overtoneRatios: readonly number[],
    readonly durationMs: number,
  ) {
    Object.freeze(this);
  }

  static of(snapshot: SoundSnapshot): SoundProfile {
    const { rootFrequencyHz, durationMs, overtoneRatios } = snapshot;

    if (rootFrequencyHz < SoundProfile.MIN_HZ || rootFrequencyHz > SoundProfile.MAX_HZ) {
      throw new RangeError(
        `Frecuencia fuera de rango audible seguro: ${rootFrequencyHz} Hz ` +
          `(permitido ${SoundProfile.MIN_HZ}–${SoundProfile.MAX_HZ})`,
      );
    }
    if (durationMs <= 0 || durationMs > SoundProfile.MAX_DURATION_MS) {
      throw new RangeError(`Duración inválida: ${durationMs} ms`);
    }
    if (overtoneRatios.length === 0 || overtoneRatios.some((r) => r <= 0)) {
      throw new RangeError('overtoneRatios debe tener al menos un valor positivo');
    }

    return new SoundProfile(
      snapshot.waveform,
      rootFrequencyHz,
      Object.freeze([...overtoneRatios]),
      durationMs,
    );
  }

  get durationSeconds(): number {
    return this.durationMs / 1000;
  }
}
