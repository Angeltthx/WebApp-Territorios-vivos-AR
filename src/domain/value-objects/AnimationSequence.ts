export interface AnimationStepSnapshot {
  readonly name: string;
  readonly loops: number;
}

export interface AnimationSequenceSnapshot {
  readonly steps: readonly AnimationStepSnapshot[];
  readonly crossFadeSeconds?: number;
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

    return new AnimationSequence(steps, crossFadeSeconds);
  }
}
