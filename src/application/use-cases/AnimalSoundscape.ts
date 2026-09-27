import type { ArModel } from '@domain/entities/ArModel';
import type { ArSession } from '@domain/entities/ArSession';
import type { MapText } from '@domain/value-objects/MapText';
import type { ModelId } from '@domain/value-objects/ModelId';
import { pickDifferent, type Narration, type NarrationCueSnapshot } from '@domain/value-objects/Soundscape';
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
/** La narración entra cuando se ha asentado el humo de la aparición. */
const NARRATION_START_MS = 700;
/** Tras la narración, un respiro antes de que el animal vuelva a llamar. */
const CALLS_AFTER_NARRATION_MS = 6_000;
/**
 * Si se detiene la narración a mano, el animal vuelve a sonar enseguida:
 * quien la para quiere oír el sitio, no un silencio.
 */
const CALLS_AFTER_STOP_MS = 1_500;

/** Lo que la ficha necesita saber para pintar el botón de la narración. */
export interface NarrationState {
  /** El animal en primer plano tiene narración. */
  readonly available: boolean;
  /** Está sonando (o a punto: en la pausa inicial o mientras el animal actúa). */
  readonly playing: boolean;
}

/**
 * Qué suena de cada animal y cuándo.
 *
 *   - Al abrir su primer plano: su ambiente (el mar, el manglar, la selva)
 *     y su NARRACIÓN, si la tiene. La narración va en trozos: entre uno y
 *     otro el animal actúa —canta, corretea, salta— y la voz espera a que
 *     acabe (ver `Narration`). Mientras habla no hay llamadas sueltas; al
 *     terminar, vuelven.
 *   - Sin narración: una de sus llamadas enseguida y, mientras siga
 *     abierto, otra distinta de vez en cuando. Una sola llamada y luego
 *     silencio hacía que el animal pareciera un adorno.
 *   - Al tocarlo: uno de sus toques, distinto de sus llamadas.
 *   - Al cerrar el primer plano: todo se apaga con un fundido.
 *
 * MIENTRAS NARRA, SOLO SUENA LA VOZ. El animal sigue respondiendo a los
 * toques —salta, corretea, canta—, pero sin su sonido: un soplido o un
 * chapuzón encima de una frase la tapaban, y quien escucha pierde el hilo.
 * Lo que sí suena es lo que pide la propia narración en sus pausas (la
 * ballena canta cuando la voz dice que canta). Tocar al animal NUNCA
 * detiene la narración; para eso está el botón.
 *
 * LA NARRACIÓN SUENA SOLA SOLO LA PRIMERA VEZ que se abre cada animal. Se
 * puede detener en cualquier momento (y entonces vuelven sus llamadas sobre
 * el ambiente); las siguientes veces la ficha ofrece un botón para
 * escucharla. Oír la misma voz entera cada vez que uno vuelve a un animal
 * convertía volver en un peaje. Lo "ya escuchado" dura lo que la página.
 *
 * Nunca la misma grabación dos veces seguidas (`pickDifferent`). Un animal
 * sin grabaciones cae al timbre sintetizado de siempre.
 */
export class AnimalSoundscape {
  private focusedId: string | null = null;
  private timer: unknown = null;
  private readonly lastCall = new Map<string, string>();
  private readonly lastTap = new Map<string, string>();
  /** Quién hace actuar al animal en una pausa de la narración: la escena. */
  private performer: ((id: ModelId) => boolean) | null = null;
  /**
   * Sube cada vez que se abre o se cierra algo. Un trozo de narración que
   * acaba —o una pausa que vence— con otro número pertenece a una ficha
   * que ya no está, y no sigue.
   */
  private narrationRun = 0;
  /** El animal en primer plano, para poder narrarlo a petición. */
  private focusedModel: ArModel | null = null;
  /** Animales cuya narración ya arrancó una vez: no vuelve a sonar sola. */
  private readonly narrated = new Set<string>();
  private narrating = false;
  /**
   * En la pausa de la narración en la que el animal actúa: ahí sí suenan su
   * gesto y su chapuzón, porque la voz los está esperando.
   */
  private inCue = false;
  private readonly narrationListeners: ((state: NarrationState) => void)[] = [];

  constructor(
    private readonly audio: AudioPort,
    private readonly getSession: () => ArSession,
    private readonly timers: Timers = browserTimers,
    private readonly random: () => number = Math.random,
  ) {}

  /** Lo conecta el compositor: en una pausa de la narración, el gesto del animal. */
  setPerformer(perform: (id: ModelId) => boolean): void {
    this.performer = perform;
  }

  /**
   * Quién se entera de si hay narración y de si está sonando: la ficha (su
   * botón) y el tutorial (que señala la ✕ cuando calla).
   */
  onNarrationChange(listener: (state: NarrationState) => void): void {
    this.narrationListeners.push(listener);
  }

  focusOpened(model: ArModel): void {
    // Ya está abierto: no se reabre. Reabrir cortaba la narración.
    if (this.focusedModel !== null && this.focusedModel.id.equals(model.id)) return;
    this.focusClosed();
    const soundscape = model.soundscape;
    if (soundscape === null) return;
    this.focusedId = model.id.value;
    this.focusedModel = model;
    if (soundscape.ambience !== null) this.audio.startAmbience(soundscape.ambience);
    if (soundscape.narration === null || this.narrated.has(model.id.value)) {
      this.scheduleCall(model, FIRST_CALL_MS);
      this.emitNarration();
      return;
    }
    this.startNarration(model, NARRATION_START_MS);
  }

  /** El botón de la ficha: escucharla si está callada, detenerla si suena. */
  toggleNarration(): void {
    if (this.narrating) this.stopNarration();
    else this.playNarration();
  }

  /** Narra el animal en primer plano desde el principio. */
  playNarration(): void {
    const model = this.focusedModel;
    if (model === null || this.narrating || model.soundscape?.narration == null) return;
    if (!this.isStillFocused(model)) return;
    this.clearTimer();
    this.startNarration(model, 0);
  }

  /**
   * Corta la narración y deja el sitio sonando: el ambiente sigue y el
   * animal vuelve a sus llamadas enseguida.
   */
  stopNarration(): void {
    const model = this.focusedModel;
    if (!this.narrating || model === null) return;
    this.clearTimer();
    this.narrationRun += 1;
    this.audio.stopVoice();
    this.narrating = false;
    this.inCue = false;
    this.emitNarration();
    this.scheduleCall(model, CALLS_AFTER_STOP_MS);
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
    this.clearTimer();
    this.narrationRun += 1;
    const wasNarrating = this.narrating;
    const hadModel = this.focusedModel !== null;
    this.narrating = false;
    this.inCue = false;
    this.focusedModel = null;
    if (wasNarrating || hadModel) this.emitNarration();
    if (this.focusedId === null) return;
    this.focusedId = null;
    this.audio.stopVoice();
    this.audio.stopAmbience();
  }

  /** Suena el toque. Sin grabaciones, el timbre sintetizado del catálogo. */
  tapped(model: ArModel): void {
    if (this.voiceHasTheFloor()) return;
    const taps = model.soundscape?.taps ?? [];
    const url = pickDifferent(taps, this.lastTap.get(model.id.value) ?? null, this.random);
    if (url === null) {
      this.audio.play(model.sound);
      return;
    }
    this.lastTap.set(model.id.value, url);
    this.audio.playClip(url);
  }

  /**
   * El chapuzón, en el instante en que el animal toca el agua. `strength`
   * (0–1) es la del salpicón que se ve: la ballena cae con 1, la tortuga
   * sale del agua con poco y cae con más. El volumen la sigue, con un
   * mínimo para que un salpicón pequeño no quede mudo.
   */
  splashed(model: ArModel, strength: number): void {
    const url = model.soundscape?.splash ?? null;
    if (url === null || this.voiceHasTheFloor()) return;
    this.audio.playClip(url, Math.min(1, Math.max(0.3, strength)));
  }

  /**
   * Un trozo de la narración y, al acabar, lo que va detrás: la acción del
   * animal y la espera antes del siguiente, o —tras el último— sus
   * llamadas de siempre. Si un trozo no se pudo cargar, la narración se
   * abandona y el animal vuelve a sus llamadas: mejor eso que quedarse mudo.
   */
  private startNarration(model: ArModel, delayMs: number): void {
    const narration = model.soundscape?.narration ?? null;
    if (narration === null) return;
    this.narrated.add(model.id.value);
    this.narrationRun += 1;
    const run = this.narrationRun;
    this.narrating = true;
    this.emitNarration();
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.narrate(model, narration, 0, run);
    }, delayMs);
  }

  private narrate(model: ArModel, narration: Narration, part: number, run: number): void {
    if (run !== this.narrationRun || !this.isStillFocused(model)) return;
    const url = narration.parts[part];
    if (url === undefined) return;
    this.inCue = false;
    void this.audio.playVoice(url).then((ended) => {
      if (run !== this.narrationRun || !this.isStillFocused(model)) return;
      // Con la misma ronda, un `false` no es que alguien la parara (parar o
      // cerrar cambian la ronda): es que el trozo no se pudo cargar. Si era
      // el primero, esta vez no cuenta como escuchada y la próxima vuelve a
      // sonar sola: la primera vez siempre tiene que narrar.
      if (!ended && part === 0) this.narrated.delete(model.id.value);
      const cue = narration.cues[part];
      if (!ended || cue === undefined) {
        this.narrating = false;
        this.inCue = false;
        this.emitNarration();
        this.scheduleCall(model, ended ? CALLS_AFTER_NARRATION_MS : FIRST_CALL_MS);
        return;
      }
      this.perform(model, cue);
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.narrate(model, narration, part + 1, run);
      }, cue.holdSeconds * 1000);
    });
  }

  /** Lo que hace el animal mientras la narración espera. */
  private perform(model: ArModel, cue: Readonly<NarrationCueSnapshot>): void {
    this.inCue = true;
    if (cue.action === 'gesture') {
      // Su gesto de toque, con su sonido en su momento (lo avisa la escena).
      this.performer?.(model.id);
      return;
    }
    const calls = model.soundscape?.calls ?? [];
    const url = cue.clip ?? pickDifferent(calls, this.lastCall.get(model.id.value) ?? null, this.random);
    if (url === null) return;
    this.lastCall.set(model.id.value, url);
    this.audio.playClip(url);
  }

  /** Narra y no está en una pausa suya: los sonidos del animal callan. */
  private voiceHasTheFloor(): boolean {
    return this.narrating && !this.inCue;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private emitNarration(): void {
    const state = {
      available: this.focusedModel?.soundscape?.narration != null,
      playing: this.narrating,
    };
    for (const listener of this.narrationListeners) listener(state);
  }

  private isStillFocused(model: ArModel): boolean {
    const focused = this.getSession().discovery.focused;
    return this.focusedId === model.id.value && focused !== null && focused.equals(model.id);
  }

  private scheduleCall(model: ArModel, ms: number): void {
    this.timer = this.timers.set(() => {
      this.timer = null;
      // Si mientras tanto se cerró —o la sesión entera se paró— no suena.
      if (!this.isStillFocused(model)) return;
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
  const voices: string[] = [];
  const rest: string[] = [];
  for (const model of models) {
    const soundscape = model.soundscape;
    if (soundscape === null) continue;
    if (soundscape.ambience !== null) first.push(soundscape.ambience);
    // El chapuzón suena segundos después del toque, a una hora exacta: si
    // no está ya descargado, llega tarde y se descarta.
    if (soundscape.splash !== null) first.push(soundscape.splash);
    const [call, ...others] = soundscape.calls;
    if (call !== undefined) first.push(call);
    // El PRIMER trozo de la narración, justo detrás: la primera vez que se
    // abre un animal siempre narra, y si el trozo no ha llegado la voz entra
    // tarde (una voz nunca se descarta por tardar, pero tampoco debe hacerse
    // esperar). El resto de trozos, al final: da tiempo mientras habla.
    const [opening, ...later] = soundscape.narration?.parts ?? [];
    if (opening !== undefined) voices.push(opening);
    rest.push(...soundscape.taps, ...others, ...later);
  }
  return [...first, ...voices, ...rest];
}
