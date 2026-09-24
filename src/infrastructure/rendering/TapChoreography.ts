import type { TapMove } from '@domain/value-objects/AnimationSequence';

/**
 * Cómo se desplaza el animal entero durante su gesto de toque, ENCIMA de lo
 * que hace su clip. El clip mueve huesos —aletas, patas, cuello—; esto mueve
 * al animal por el espacio, que es lo que ningún clip de los que hay hace
 * sin salirse del mapa.
 *
 * Distancias en "tamaños de animal" (quien lo aplica multiplica por lo que
 * mide el animal en pantalla) y ángulos en radianes, en los ejes del icono:
 * +Y arriba, +Z hacia donde mira.
 */
export interface TapPose {
  /** Desplazamiento vertical. Negativo: se hunde. */
  readonly rise: number;
  /** Desplazamiento lateral. */
  readonly sway: number;
  /** Media vuelta = π. Se suma al giro del usuario. */
  readonly yaw: number;
  /** Positivo: el morro baja. */
  readonly pitch: number;
  readonly roll: number;
  /** Factor de escala: < 1 se aleja hacia el fondo del agua. */
  readonly depth: number;
}

export const REST_POSE: TapPose = Object.freeze({
  rise: 0, sway: 0, yaw: 0, pitch: 0, roll: 0, depth: 1,
});

interface Choreography {
  readonly duration: number;
  /** Momentos (0–1) en que salpica, y con qué fuerza. */
  readonly splashes: readonly (readonly [at: number, strength: number])[];
  pose(t: number): TapPose;
}

/**
 * La tortuga se sumerge: da una vuelta completa en la superficie, pica de
 * morro, se hunde —encoge, porque se aleja hacia el fondo— y vuelve a salir.
 * Salpica al entrar y, más flojo, al asomar.
 */
const DIVE: Choreography = {
  duration: 3,
  splashes: [[0.4, 0.55], [0.86, 0.3]],
  pose(t) {
    const turn = smooth(clamp01(t / 0.4));
    const down = smooth(clamp01((t - 0.36) / 0.2));
    const up = smooth(clamp01((t - 0.72) / 0.22));
    const submerged = down * (1 - up);
    return {
      rise: -0.42 * submerged,
      sway: 0,
      yaw: Math.PI * 2 * turn,
      pitch: 0.7 * Math.sin(Math.PI * clamp01((t - 0.34) / 0.3)) - 0.35 * Math.sin(Math.PI * up),
      roll: 0.18 * Math.sin(Math.PI * 2 * turn),
      depth: 1 - 0.45 * submerged,
    };
  },
};

/**
 * El cangrejo corretea: de un lado a otro, de lado como anda un cangrejo,
 * a saltitos y balanceándose. El clip Walk va al doble de velocidad a la vez.
 */
const SCUTTLE: Choreography = {
  duration: 2.1,
  splashes: [],
  pose(t) {
    const envelope = Math.sin(Math.PI * t);
    const steps = Math.PI * 2 * 3 * t;
    return {
      rise: Math.abs(Math.sin(steps * 2)) * 0.07 * envelope,
      sway: Math.sin(steps) * 0.3 * envelope,
      yaw: 0,
      pitch: 0,
      roll: Math.sin(steps) * 0.14 * envelope,
      depth: 1,
    };
  },
};

const CHOREOGRAPHIES: Partial<Record<TapMove, Choreography>> = {
  dive: DIVE,
  scuttle: SCUTTLE,
};

export class TapChoreography {
  private readonly choreography: Choreography | null;
  private elapsed = Infinity;
  private current: TapPose = REST_POSE;

  constructor(move: TapMove) {
    this.choreography = CHOREOGRAPHIES[move] ?? null;
  }

  start(): void {
    if (this.choreography === null) return;
    this.elapsed = 0;
  }

  /** Avanza y devuelve la fuerza del salpicón que toca en este fotograma, si toca. */
  advance(deltaSeconds: number): number | null {
    const choreography = this.choreography;
    if (choreography === null || this.elapsed >= choreography.duration) {
      this.current = REST_POSE;
      return null;
    }
    const before = this.elapsed / choreography.duration;
    this.elapsed = Math.min(choreography.duration, this.elapsed + deltaSeconds);
    const after = this.elapsed / choreography.duration;
    this.current = after >= 1 ? REST_POSE : choreography.pose(after);

    let splash: number | null = null;
    for (const [at, strength] of choreography.splashes) {
      if (before < at && after >= at) splash = Math.max(splash ?? 0, strength);
    }
    return splash;
  }

  get pose(): TapPose {
    return this.current;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
