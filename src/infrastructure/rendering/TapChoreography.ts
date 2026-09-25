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
 *
 * Nunca cambia el TAMAÑO del animal: hubo un factor de "profundidad" que
 * encogía a la tortuga al hundirse, y un animal que cambia de tamaño al
 * tocarlo se pidió quitar.
 *
 * Cada movimiento está escrito con los principios de animación que pidieron
 * los animadores: arcos (el salto es una parábola, y el morro sigue su
 * tangente), entrada y salida suaves (nada arranca ni para en seco),
 * anticipación antes del salto y continuidad al caer (la velocidad con que
 * entra al agua se frena poco a poco, no contra un suelo).
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
}

export const REST_POSE: TapPose = Object.freeze({
  rise: 0, sway: 0, yaw: 0, pitch: 0, roll: 0,
});

interface Choreography {
  /** Momentos (0–1) en que salpica, y con qué fuerza. */
  readonly splashes: readonly (readonly [at: number, strength: number])[];
  /**
   * Salpica al CRUZAR la superficie del agua (su altura la pone quien crea
   * el gesto): poco al salir, más al volver a caer. Así el salpicón sale
   * donde está el agua y no a una hora fija.
   */
  readonly surfaceSplashes?: { readonly exit: number; readonly entry: number };
  /** `u`: progreso del gesto, de 0 a 1. */
  pose(u: number): TapPose;
}

/**
 * Tiempos del salto de la tortuga, en fracción del gesto: arranca desde su
 * profundidad de nado, y vuelve a ella en LEAP_ENTRY.
 */
const LEAP_TAKEOFF = 0.16;
const LEAP_PEAK = 0.3;
const LEAP_ENTRY = 0.44;
/**
 * Altura del salto y lo que baja de más después, en tamaños de animal. La
 * tortuga nada bajo la superficie (unos 0.2 por encima de su centro), así
 * que tiene que subir bastante más para asomar entera.
 */
const LEAP_HEIGHT = 0.62;
const LEAP_SINK = 0.18;

/**
 * La tortuga nada BAJO el agua. Se agacha un instante (anticipación), sube
 * y rompe la superficie con un salpicón pequeño, vuela en arco con el morro
 * siguiendo la curva, cae de cabeza con un salpicón mayor, sigue bajando
 * frenada por el agua y vuelve a su profundidad de nado.
 *
 * Sustituye a un gesto que daba una vuelta entera, se hundía, encogía y
 * salpicaba al volver a salir: el agua saltaba sin que nada hubiera caído
 * en ella, y no tenía lógica.
 */
const LEAP: Choreography = {
  splashes: [],
  surfaceSplashes: { exit: 0.3, entry: 0.65 },
  pose(u) {
    const half = LEAP_PEAK - LEAP_TAKEOFF;
    // Anticipación: baja un poco y agacha el morro justo antes de saltar.
    const crouch = bump(u, 0.04, LEAP_TAKEOFF + 0.03);
    let rise = -0.05 * crouch;
    // El morro empieza a subir justo antes del despegue, para llegar a él
    // ya apuntando hacia arriba (el arco de abajo empieza en −0.6).
    let pitch = 0.12 * crouch - 0.6 * smooth(clamp01((u - (LEAP_TAKEOFF - 0.08)) / 0.08));
    let roll = 0;

    if (u >= LEAP_TAKEOFF && u <= LEAP_ENTRY) {
      // Subida con entrada y salida suaves: arranca desde parada (sin
      // tirón al despegar), rompe la superficie en plena velocidad y se
      // detiene en la cima. Bajada en parábola: cae cada vez más rápido y
      // entra al agua con esa velocidad. El morro sigue la curva.
      const x = (u - LEAP_PEAK) / half;
      rise += x < 0 ? LEAP_HEIGHT * smooth(1 + x) : LEAP_HEIGHT * (1 - x * x);
      pitch = 0.12 * crouch + 0.6 * x;
      roll = 0.08 * Math.sin(Math.PI * (u - LEAP_TAKEOFF) / (LEAP_ENTRY - LEAP_TAKEOFF));
    } else if (u > LEAP_ENTRY) {
      // Bajo el agua: entra con la velocidad de la caída y el agua la frena
      // de forma exponencial —la misma pendiente a los dos lados del
      // salpicón, así que no hay "golpe"—; luego flota de vuelta.
      const entrySpeed = (2 * LEAP_HEIGHT) / half;
      const tau = LEAP_SINK / entrySpeed;
      const after = u - LEAP_ENTRY;
      const back = smooth(clamp01((u - (LEAP_ENTRY + 3 * tau)) / (0.96 - LEAP_ENTRY - 3 * tau)));
      rise = -LEAP_SINK * (1 - Math.exp(-after / tau)) * (1 - back);
      // El morro, que entró hacia abajo, se endereza; al subir, lo levanta un poco.
      pitch = 0.6 * Math.exp(-after / 0.08) - 0.15 * Math.sin(Math.PI * back);
    }
    return { rise, sway: 0, yaw: 0, pitch, roll };
  },
};

/**
 * El cangrejo corretea de lado —como anda un cangrejo—: va hacia un lado,
 * vuelve hacia el otro y regresa a su sitio, con pasitos suaves y
 * ladeándose hacia donde va. Arranca y para con suavidad (sin²).
 *
 * Antes eran tres idas y vueltas con saltos en |sin| —un rebote seco en
 * cada paso— y el clip Walk a 2.4×: se veía acelerado.
 */
const SCUTTLE: Choreography = {
  splashes: [],
  pose(u) {
    const envelope = Math.sin(Math.PI * u) ** 2;
    const across = Math.PI * 2 * u;
    return {
      rise: 0.025 * envelope * (0.5 - 0.5 * Math.cos(across * 4)),
      sway: 0.2 * Math.sin(across) * envelope,
      yaw: 0,
      pitch: 0,
      roll: -0.06 * Math.cos(across) * envelope,
    };
  },
};

const CHOREOGRAPHIES: Partial<Record<TapMove, Choreography>> = {
  leap: LEAP,
  scuttle: SCUTTLE,
};

export class TapChoreography {
  private readonly choreography: Choreography | null;
  private elapsed = Infinity;
  private current: TapPose = REST_POSE;

  /**
   * `durationSeconds`: lo que dura el gesto. Quien lo crea le pasa lo que
   * dura el clip de toque (sus vueltas, a su velocidad), para que el
   * movimiento del cuerpo y el del clip empiecen y acaben juntos.
   */
  /** `surface`: altura del agua sobre el centro del animal, en tamaños de animal. */
  constructor(
    move: TapMove,
    private readonly durationSeconds: number,
    private readonly surface = 0,
  ) {
    this.choreography = CHOREOGRAPHIES[move] ?? null;
  }

  start(): void {
    if (this.choreography === null) return;
    this.elapsed = 0;
  }

  /** Si está a mitad del gesto. */
  get isPlaying(): boolean {
    return this.choreography !== null && this.elapsed < this.durationSeconds;
  }

  /** Avanza y devuelve la fuerza del salpicón que toca en este fotograma, si toca. */
  advance(deltaSeconds: number): number | null {
    const choreography = this.choreography;
    if (choreography === null || this.elapsed >= this.durationSeconds) {
      this.current = REST_POSE;
      return null;
    }
    const before = this.elapsed / this.durationSeconds;
    this.elapsed = Math.min(this.durationSeconds, this.elapsed + deltaSeconds);
    const after = this.elapsed / this.durationSeconds;
    this.current = after >= 1 ? REST_POSE : choreography.pose(after);

    let splash: number | null = null;
    for (const [at, strength] of choreography.splashes) {
      if (before < at && after >= at) splash = Math.max(splash ?? 0, strength);
    }
    const crossing = choreography.surfaceSplashes;
    if (crossing !== undefined) {
      const was = choreography.pose(before).rise;
      const is = this.current.rise;
      if (was < this.surface && is >= this.surface) splash = Math.max(splash ?? 0, crossing.exit);
      if (was >= this.surface && is < this.surface) splash = Math.max(splash ?? 0, crossing.entry);
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

/** 0 fuera de [from, to]; sube y baja suave (sin²) dentro. */
function bump(u: number, from: number, to: number): number {
  if (u <= from || u >= to) return 0;
  return Math.sin((Math.PI * (u - from)) / (to - from)) ** 2;
}
