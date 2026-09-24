import type { ArModel } from '@domain/entities/ArModel';
import type { ArSession } from '@domain/entities/ArSession';
import type { MapText } from '@domain/value-objects/MapText';
import { pickDifferent } from '@domain/value-objects/Soundscape';
import type { AudioPort } from '../ports/AudioPort';

/** Temporizadores inyectables: las pruebas avanzan el tiempo a mano. */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** La primera llamada entra un momento después del humo, no encima. */
const FIRST_CALL_MS = 400;
/** Entre una llamada y la siguiente, mientras siga en primer plano. */
const CALL_EVERY_MIN_MS = 10_000;
const CALL_EVERY_MAX_MS = 16_000;

/**
 * Qué suena de cada animal y cuándo.
 *
 *   - Al abrir su primer plano: su ambiente (el mar, el manglar, la selva)
 *     y, enseguida, una de sus llamadas; mientras siga abierto, otra
 *     distinta de vez en cuando. Una sola llamada y luego silencio hacía
 *     que el animal pareciera un adorno.
 *   - Al tocarlo: uno de sus toques, distinto de sus llamadas.
 *   - Al cerrar el primer plano: todo se apaga con un fundido.
 *
 * Nunca la misma grabación dos veces seguidas (`pickDifferent`). Un animal
 * sin grabaciones cae al timbre sintetizado de siempre.
 */
export class AnimalSoundscape {
  private focusedId: string | null = null;
  private timer: unknown = null;
  private readonly lastCall = new Map<string, string>();
  private readonly lastTap = new Map<string, string>();

  constructor(
    private readonly audio: AudioPort,
    private readonly getSession: () => ArSession,
    private readonly timers: Timers = browserTimers,
    private readonly random: () => number = Math.random,
  ) {}

  focusOpened(model: ArModel): void {
    this.focusClosed();
    const soundscape = model.soundscape;
    if (soundscape === null) return;
    this.focusedId = model.id.value;
    if (soundscape.ambience !== null) this.audio.startAmbience(soundscape.ambience);
    this.scheduleCall(model, FIRST_CALL_MS);
  }

  /**
   * Un texto del mapa abierto para leer: solo su ambiente, sin voces. Un
   * texto se lee; una llamada de animal cada pocos segundos distraería.
   */
  textOpened(text: MapText): void {
    this.focusClosed();
    if (text.ambience === null) return;
    this.focusedId = `text:${text.id}`;
    this.audio.startAmbience(text.ambience);
  }

  /** Cierra lo que haya abierto —animal o texto— y apaga su sonido. */
  focusClosed(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.focusedId === null) return;
    this.focusedId = null;
    this.audio.stopAmbience();
  }

  /** Suena el toque. Sin grabaciones, el timbre sintetizado del catálogo. */
  tapped(model: ArModel): void {
    const taps = model.soundscape?.taps ?? [];
    const url = pickDifferent(taps, this.lastTap.get(model.id.value) ?? null, this.random);
    if (url === null) {
      this.audio.play(model.sound);
      return;
    }
    this.lastTap.set(model.id.value, url);
    this.audio.playClip(url);
  }

  private scheduleCall(model: ArModel, ms: number): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      // Si mientras tanto se cerró —o la sesión entera se paró— no suena.
      const focused = this.getSession().discovery.focused;
      if (this.focusedId !== model.id.value || focused === null || !focused.equals(model.id)) return;
      const calls = model.soundscape?.calls ?? [];
      const url = pickDifferent(calls, this.lastCall.get(model.id.value) ?? null, this.random);
      if (url !== null) {
        this.lastCall.set(model.id.value, url);
        this.audio.playClip(url);
      }
      const gap = CALL_EVERY_MIN_MS + this.random() * (CALL_EVERY_MAX_MS - CALL_EVERY_MIN_MS);
      this.scheduleCall(model, gap);
    }, ms);
  }
}

/**
 * En qué orden descargar las grabaciones: primero lo que suena NADA MÁS
 * abrir un primer plano —el ambiente y una llamada de cada animal—, luego
 * el resto. Así, aunque la red vaya lenta, el primer descubrimiento ya
 * tiene con qué sonar.
 */
export function soundPreloadOrder(models: readonly ArModel[]): readonly string[] {
  const first: string[] = [];
  const rest: string[] = [];
  for (const model of models) {
    const soundscape = model.soundscape;
    if (soundscape === null) continue;
    if (soundscape.ambience !== null) first.push(soundscape.ambience);
    const [call, ...others] = soundscape.calls;
    if (call !== undefined) first.push(call);
    rest.push(...soundscape.taps, ...others);
  }
  return [...first, ...rest];
}
