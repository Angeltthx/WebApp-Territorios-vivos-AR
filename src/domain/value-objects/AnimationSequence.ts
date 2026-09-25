export interface AnimationStepSnapshot {
  readonly name: string;
  readonly loops: number;
}

/**
 * El movimiento que el animal hace CON TODO SU CUERPO al tocarlo, encima de
 * su clip. Es vocabulario, como `IconView`: el catálogo dice la palabra y la
 * capa de render sabe dibujarla.
 *
 *   'breach'  salta fuera del agua, cae, se sumerge y vuelve a salir
 *             (ballena). Todo el movimiento viene del propio clip del
 *             animador; solo se reescala su trayectoria para que quepa.
 *   'leap'    nadando, salta fuera del agua, cae con un salpicón, se
 *             sumerge un poco y vuelve a flote (tortuga).
 *   'scuttle' corretea de lado a lado a saltitos (cangrejo).
 *   'none'    solo el clip (pava: su canto ya salta y mueve la cabeza).
 */
export type TapMove = 'none' | 'breach' | 'leap' | 'scuttle';
const TAP_MOVES: readonly TapMove[] = ['none', 'breach', 'leap', 'scuttle'];

export interface AnimationSequenceSnapshot {
  /** Bucle ambiental: lo que el animal hace siempre, sin que nadie lo toque. */
  readonly steps: readonly AnimationStepSnapshot[];
  readonly crossFadeSeconds?: number;
  /** Clip expresivo que se reproduce una vez al descubrir el animal. */
  readonly entranceClip?: string;
  /**
   * Clip expresivo que se reinicia al tocar el animal. Puede NO estar en
   * `steps`: el salto de la ballena solo tiene sentido como respuesta.
   */
  readonly tapClip?: string;
  /**
   * Velocidad del clip de toque. Por defecto 1, la del animador: acelerarlo
   * (hubo 1.8 en la ballena y 2.4 en el cangrejo) rompe su timing, y los
   * animadores lo notaron enseguida.
   */
  readonly tapSpeed?: number;
  /** Cuántas vueltas da el clip de toque antes de volver al bucle ambiental. */
  readonly tapLoops?: number;
  readonly tapMove?: TapMove;
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
    readonly tapSpeed: number,
    readonly tapLoops: number,
    readonly tapMove: TapMove,
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
    const entranceClip = snapshot.entranceClip?.trim();
    if (entranceClip !== undefined && !clipNames.has(entranceClip)) {
      throw new RangeError(`El clip de entrada "${entranceClip}" no forma parte de la secuencia`);
    }
    const tapClip = snapshot.tapClip?.trim();
    if (tapClip !== undefined && tapClip.length === 0) {
      throw new RangeError('El clip de toque no puede estar vacío');
    }

    const tapSpeed = snapshot.tapSpeed ?? 1;
    if (!Number.isFinite(tapSpeed) || tapSpeed <= 0 || tapSpeed > 4) {
      throw new RangeError(`Velocidad de toque inválida: ${tapSpeed}`);
    }
    const tapLoops = snapshot.tapLoops ?? 1;
    if (!Number.isInteger(tapLoops) || tapLoops < 1) {
      throw new RangeError(`Bucles de toque inválidos: ${tapLoops}`);
    }
    const tapMove = snapshot.tapMove ?? 'none';
    if (!TAP_MOVES.includes(tapMove)) {
      throw new RangeError(`Movimiento de toque desconocido: ${String(tapMove)}`);
    }

    return new AnimationSequence(
      steps,
      crossFadeSeconds,
      entranceClip ?? null,
      tapClip ?? null,
      tapSpeed,
      tapLoops,
      tapMove,
    );
  }
}
