export interface AnimationStepSnapshot {
  readonly name: string;
  readonly loops: number;
}

export interface AnimationSequenceSnapshot {
  readonly steps: readonly AnimationStepSnapshot[];
  readonly crossFadeSeconds?: number;
  /** Clip expresivo que se reproduce una vez al descubrir el animal. */
  readonly entranceClip?: string;
  /** Clip expresivo que se reinicia al tocar el animal. */
  readonly tapClip?: string;
}

export interface AnimationStep {
  readonly name: string;
  readonly loops: number;
}

/** Secuencia de clips que define el movimiento propio de un animal. */
export class AnimationSequence {
  private constructor(
    readonly steps: readonly AnimationStep[],
    readonly crossFadeSeconds: number,
    readonly entranceClip: string | null,
    readonly tapClip: string | null,
  ) {
    Object.freeze(this.steps);
    Object.freeze(this);
  }

  static of(snapshot: AnimationSequenceSnapshot): AnimationSequence {
    if (snapshot.steps.length === 0) {
      throw new RangeError('Una secuencia de animación requiere al menos un clip');
    }

    const steps = snapshot.steps.map((step) => {
      const name = step.name.trim();
      if (name.length === 0) throw new RangeError('El nombre del clip no puede estar vacío');
      if (!Number.isInteger(step.loops) || step.loops < 1) {
        throw new RangeError(`Bucles inválidos para "${name}": ${step.loops}`);
      }
      return Object.freeze({ name, loops: step.loops });
    });

    const crossFadeSeconds = snapshot.crossFadeSeconds ?? 0.35;
    if (!Number.isFinite(crossFadeSeconds) || crossFadeSeconds < 0 || crossFadeSeconds > 2) {
      throw new RangeError(`Transición de animación inválida: ${crossFadeSeconds}`);
    }

    const clipNames = new Set(steps.map((step) => step.name));
    const configuredClip = (value: string | undefined, label: string): string | null => {
      if (value === undefined) return null;
      const name = value.trim();
      if (!clipNames.has(name)) {
        throw new RangeError(`${label} "${name}" no forma parte de la secuencia`);
      }
      return name;
    };

    return new AnimationSequence(
      steps,
      crossFadeSeconds,
      configuredClip(snapshot.entranceClip, 'El clip de entrada'),
      configuredClip(snapshot.tapClip, 'El clip de toque'),
    );
  }
}
