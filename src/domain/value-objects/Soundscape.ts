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
}

const MAX_VARIANTS = 5;

export class Soundscape {
  private constructor(
    readonly calls: readonly string[],
    readonly taps: readonly string[],
    readonly ambience: string | null,
    readonly splash: string | null,
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
    return new Soundscape(calls, clean(snapshot.taps ?? [], 'Toques'), ambience, splash);
  }

  /** Todas las rutas, para descargarlas por adelantado. */
  get urls(): readonly string[] {
    return [
      ...this.calls,
      ...this.taps,
      ...(this.ambience === null ? [] : [this.ambience]),
      ...(this.splash === null ? [] : [this.splash]),
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
