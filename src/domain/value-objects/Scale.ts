/**
 * Regla de negocio: un modelo nunca puede desaparecer ni tapar la cámara.
 * Los límites viven aquí, no dispersos por la UI.
 */
export class Scale {
  static readonly MIN = 0.05;
  static readonly MAX = 5;

  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static of(value: number): Scale {
    if (!Number.isFinite(value)) {
      throw new RangeError('Scale debe ser un número finito');
    }
    return new Scale(Math.min(Scale.MAX, Math.max(Scale.MIN, value)));
  }

  static default(): Scale {
    return new Scale(1);
  }

  multipliedBy(factor: number): Scale {
    return Scale.of(this.value * factor);
  }
}
