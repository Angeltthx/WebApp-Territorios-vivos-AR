/**
 * Lo que se OYE de un animal, con grabaciones reales (ver
 * `public/audio/CREDITOS.md`), frente a `SoundProfile`, que es un timbre
 * sintetizado y queda como respaldo cuando no hay grabaciones.
 *
 *   - `calls`: su voz. Suena al abrir su primer plano y, mientras siga
 *     abierto, de vez en cuando otra distinta.
 *   - `taps`: lo que suena al tocarlo —un soplido, un chapuzón, un
 *     correteo—, distinto de sus llamadas para que tocar se note.
 *   - `splash`: el chapuzón de los que caen al agua (ballena, tortuga).
 *     Suena en el fotograma exacto en que el salpicón toca el agua, con
 *     más o menos volumen según lo fuerte que sea.
 *   - `narration`: la voz que lo cuenta al abrir su ficha (ver Narration).
 *   - `ambience`: el lugar donde vive (el mar, el manglar, la selva), en
 *     bucle y bajito mientras está en primer plano.
 *
 * Como mucho CINCO por lista: con más, nadie los distingue y solo pesan.
 */
export interface SoundscapeSnapshot {
  readonly calls: readonly string[];
  readonly taps?: readonly string[];
  readonly ambience?: string;
  readonly splash?: string;
  readonly narration?: NarrationSnapshot;
}

/**
 * Lo que hace el animal en una pausa de la narración:
 *   - 'gesture': su gesto de toque (canta, corretea, salta), con su sonido
 *     en su momento, igual que si lo hubieran tocado;
 *   - 'call': suena una de sus llamadas (o `clip`, si se dice cuál), sin
 *     gesto. La ballena canta así: su gesto es un salto, no un canto.
 */
export type NarrationCueAction = 'gesture' | 'call';

export interface NarrationCueSnapshot {
  readonly action: NarrationCueAction;
  /** Cuánto espera la narración antes de seguir, en segundos. */
  readonly holdSeconds: number;
  readonly clip?: string;
}

export interface NarrationSnapshot {
  /** La narración, cortada en trozos por los momentos en que el animal actúa. */
  readonly parts: readonly string[];
  /** Lo que pasa ENTRE un trozo y el siguiente: uno menos que trozos. */
  readonly cues: readonly NarrationCueSnapshot[];
}

/**
 * La voz que cuenta al animal, sincronizada con él: cuando dice «el macho
 * puede pasar horas cantando», la narración calla, la ballena canta, y
 * sigue. Va en trozos —cortados en los silencios entre frases por
 * `build-audio`— en vez de pausar y reanudar un solo audio: encadenar
 * archivos es lo fiable en Safari de iPhone.
 */
export class Narration {
  private constructor(
    readonly parts: readonly string[],
    readonly cues: readonly Readonly<NarrationCueSnapshot>[],
  ) {
    Object.freeze(this.parts);
    Object.freeze(this.cues);
    Object.freeze(this);
  }

  static of(snapshot: NarrationSnapshot): Narration {
    const parts = snapshot.parts.map((url) => url.trim());
    if (parts.length === 0 || parts.some((url) => url.length === 0)) {
      throw new RangeError('Narración: hace falta al menos un trozo, sin rutas vacías');
    }
    if (snapshot.cues.length !== parts.length - 1) {
      throw new RangeError(`Narración: ${parts.length} trozos necesitan ${parts.length - 1} pausas, no ${snapshot.cues.length}`);
    }
    const cues = snapshot.cues.map((cue) => {
      if (cue.action !== 'gesture' && cue.action !== 'call') {
        throw new RangeError(`Narración: acción desconocida ${String(cue.action)}`);
      }
      if (!Number.isFinite(cue.holdSeconds) || cue.holdSeconds < 0 || cue.holdSeconds > 20) {
        throw new RangeError(`Narración: pausa inválida ${cue.holdSeconds}`);
      }
      return Object.freeze({ ...cue });
    });
    return new Narration(parts, cues);
  }
}

const MAX_VARIANTS = 5;

export class Soundscape {
  private constructor(
    readonly calls: readonly string[],
    readonly taps: readonly string[],
    readonly ambience: string | null,
    readonly splash: string | null,
    readonly narration: Narration | null,
  ) {
    Object.freeze(this.calls);
    Object.freeze(this.taps);
    Object.freeze(this);
  }

  static of(snapshot: SoundscapeSnapshot): Soundscape {
    const clean = (list: readonly string[], label: string): readonly string[] => {
      const urls = list.map((url) => url.trim());
      if (urls.some((url) => url.length === 0)) throw new RangeError(`${label}: hay una ruta vacía`);
      if (urls.length > MAX_VARIANTS) {
        throw new RangeError(`${label}: ${urls.length} sonidos; el máximo es ${MAX_VARIANTS}`);
      }
      return urls;
    };
    const calls = clean(snapshot.calls, 'Llamadas');
    if (calls.length === 0) throw new RangeError('Un paisaje sonoro necesita al menos una llamada');
    const ambience = snapshot.ambience?.trim() ?? null;
    if (ambience !== null && ambience.length === 0) throw new RangeError('Ambiente: ruta vacía');
    const splash = snapshot.splash?.trim() ?? null;
    if (splash !== null && splash.length === 0) throw new RangeError('Salpicón: ruta vacía');
    const narration = snapshot.narration === undefined ? null : Narration.of(snapshot.narration);
    return new Soundscape(calls, clean(snapshot.taps ?? [], 'Toques'), ambience, splash, narration);
  }

  /** Todas las rutas, para descargarlas por adelantado. */
  get urls(): readonly string[] {
    return [
      ...this.calls,
      ...this.taps,
      ...(this.ambience === null ? [] : [this.ambience]),
      ...(this.splash === null ? [] : [this.splash]),
      ...(this.narration?.parts ?? []),
    ];
  }
}

/**
 * Elige al azar un elemento DISTINTO del anterior: la misma llamada dos
 * veces seguidas suena a grabación, no a animal. Con un solo elemento no
 * hay otro remedio que repetirlo.
 */
export function pickDifferent<T>(
  options: readonly T[],
  previous: T | null,
  random: () => number = Math.random,
): T | null {
  if (options.length === 0) return null;
  const pool = options.length > 1 ? options.filter((option) => option !== previous) : options;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null;
}
