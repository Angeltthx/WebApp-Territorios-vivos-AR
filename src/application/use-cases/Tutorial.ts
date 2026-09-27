import type { ArSession } from '@domain/entities/ArSession';
import type { HintSpec } from '../ports/ScenePort';
import type { Timers } from './AnimalSoundscape';

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Tras mostrar un paso, cuánto espera en calma antes de insistir. */
export const TUTORIAL_URGENT_AFTER_MS = 6_000;
/** Lo que dura en pantalla el «Explora el resto de Nuquí» final. */
export const TUTORIAL_FAREWELL_MS = 5_000;

export type TutorialStep = 'off' | 'tapAnimal' | 'doubleTap' | 'closeFocus' | 'tapText' | 'explore';

/** Lo que la vista necesita para escribir el cartel. */
export interface TutorialState {
  readonly step: TutorialStep;
  /** Lleva un rato sin hacerle caso: la mano y el cartel insisten. */
  readonly urgent: boolean;
  /** Animales que faltan por conocer (abrir en primer plano). */
  readonly remaining: number;
  /** Ya conoce alguno: «Toca otro animal» en vez de «Toca un animal». */
  readonly returning: boolean;
  /** Lo que dibuja la escena (la mano), o null. */
  readonly hint: HintSpec | null;
}

/**
 * El tutorial: acompaña, animal por animal, hasta el final. Para cada uno
 * que falte por conocer, el mismo ciclo:
 *
 *  1. `tapAnimal` — una mano toca un animal («Toca un animal»; la primera
 *     vez, siempre la BALLENA, aunque se puede tocar cualquiera). Un toque
 *     lo despierta y lo hace moverse.
 *  2. `doubleTap` — la mano toca DOS VECES ese mismo animal: «Tócalo dos
 *     veces». El doble toque abre su ficha y su narración.
 *  3. Mientras narra, silencio: nada tapa la ficha.
 *  4. `closeFocus` — al acabar (o al detenerla), una mano señala la ✕:
 *     «Toca la ✕ para cerrar».
 *  5. Al cerrar, enseguida, vuelta al paso 1 con otro que falte.
 *
 * Conocidos los cuatro, `tapText`: la mano toca UN punto amarillo de los
 * textos. Al cerrar ese primer texto, `explore`: «Explora el resto de
 * Nuquí» durante 5 s, y el tutorial se acaba. Guiar texto por texto era
 * demasiado —hay una docena— y quitaba lo mejor del final: explorar a su
 * aire.
 *
 * Cada paso insiste a los 6 s sin respuesta (`urgent`).
 *
 * Vive en la aplicación porque lo oyen DOS —la escena, que dibuja la mano
 * sobre el animal o el punto, y la vista, que escribe el cartel— y tienen
 * que ir con el mismo reloj.
 */
export class Tutorial {
  private step: TutorialStep = 'off';
  private urgent = false;
  /** El animal al que se le enseña el doble toque. */
  private target: string | null = null;
  /** La cámara ya encontró el mapa en esta sesión. */
  private started = false;
  /** Hay una ficha o un texto abiertos. */
  private busy = false;
  /** Ya se despidió: a partir de aquí, exploración libre. */
  private finished = false;
  /** El animal abierto ahora, si lo hay. */
  private focusedAnimal: string | null = null;
  private narrating = false;
  /** Animales en cuya ficha ya se señaló la ✕ (una vez por animal). */
  private readonly closeTaught = new Set<string>();
  private readonly opened = new Set<string>();
  private readonly read = new Set<string>();
  private urgentTimer: unknown = null;
  private idleTimer: unknown = null;
  private readonly listeners: ((state: TutorialState) => void)[] = [];

  constructor(
    private readonly animals: readonly string[],
    private readonly texts: readonly string[],
    private readonly timers: Timers = browserTimers,
    /** La primera sugerencia: la ballena, el animal más grande y reconocible. */
    private readonly firstAnimal = 'whale',
  ) {}

  onChange(listener: (state: TutorialState) => void): void {
    this.listeners.push(listener);
    listener(this.state);
  }

  get state(): TutorialState {
    return {
      step: this.step,
      urgent: this.urgent,
      remaining: this.animals.filter((id) => !this.opened.has(id)).length,
      returning: this.opened.size > 0,
      hint: this.hint(),
    };
  }

  /** Se llama con cada cambio de sesión. */
  update(session: ArSession): void {
    if (!session.hasStarted) {
      if (this.started || this.step !== 'off') this.reset();
      return;
    }
    const discovery = session.discovery;
    if (discovery.focused !== null) this.opened.add(discovery.focused.value);
    if (discovery.reading !== null) this.read.add(discovery.reading);

    if (discovery.isBusy) {
      if (!this.busy) {
        this.busy = true;
        this.focusedAnimal = discovery.focused?.value ?? null;
        // Mientras narra, nada tapa la ficha (la ✕ llega al callar).
        if (this.step !== 'closeFocus') this.hide();
      }
      return;
    }
    if (this.busy) {
      const closedAnimal = this.focusedAnimal !== null;
      this.busy = false;
      this.focusedAnimal = null;
      this.narrating = false;
      // Al cerrar un animal, enseguida el siguiente (o el primer punto, si
      // era el último). Al cerrar el primer texto, la despedida: libre.
      if (closedAnimal) this.showNext();
      else if (!this.finished) this.farewell();
      return;
    }
    if (!this.started && session.status === 'tracking') {
      this.started = true;
      this.showNext();
    }
  }

  /** Un toque (no doble) sobre un animal del mapa. */
  animalTapped(id: string): void {
    if (this.busy || !this.started) return;
    // Uno que falta por conocer: ahora, el doble toque en ESE. Uno ya
    // conocido no cambia nada (la mano sigue sobre los que faltan).
    if ((this.step === 'tapAnimal' || this.step === 'doubleTap') && !this.opened.has(id)) {
      this.show('doubleTap', id);
    }
  }

  /**
   * La narración de la ficha abierta cambió. Cuando CALLA —acabó, o la
   * detuvo—, la mano señala la ✕. Una vez por animal: la primera vez que
   * se abre, que es cuando narra solo.
   */
  narrationChanged(playing: boolean): void {
    const wasPlaying = this.narrating;
    this.narrating = playing;
    if (!this.busy || this.focusedAnimal === null || !wasPlaying || playing) return;
    if (this.closeTaught.has(this.focusedAnimal)) return;
    this.closeTaught.add(this.focusedAnimal);
    this.show('closeFocus', null);
  }

  private showNext(): void {
    if (this.animals.some((id) => !this.opened.has(id))) this.show('tapAnimal', null);
    else if (!this.finished && this.read.size === 0 && this.texts.length > 0) this.show('tapText', null);
    else this.hide();
  }

  /** «Explora el resto de Nuquí», un momento, y el tutorial termina. */
  private farewell(): void {
    this.clearTimers();
    this.finished = true;
    this.step = 'explore';
    this.target = null;
    this.urgent = false;
    this.emit();
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      this.hide();
    }, TUTORIAL_FAREWELL_MS);
  }

  private show(step: TutorialStep, target: string | null): void {
    this.clearTimers();
    this.step = step;
    this.target = target;
    this.urgent = false;
    this.emit();
    this.urgentTimer = this.timers.set(() => {
      this.urgentTimer = null;
      this.urgent = true;
      this.emit();
    }, TUTORIAL_URGENT_AFTER_MS);
  }

  private hide(): void {
    this.clearTimers();
    if (this.step === 'off') return;
    this.step = 'off';
    this.target = null;
    this.urgent = false;
    this.emit();
  }

  private reset(): void {
    this.clearTimers();
    this.started = false;
    this.busy = false;
    this.finished = false;
    this.opened.clear();
    this.read.clear();
    this.closeTaught.clear();
    this.focusedAnimal = null;
    this.narrating = false;
    this.step = 'off';
    this.target = null;
    this.urgent = false;
    this.emit();
  }

  private clearTimers(): void {
    for (const timer of [this.urgentTimer, this.idleTimer]) {
      if (timer !== null) this.timers.clear(timer);
    }
    this.urgentTimer = null;
    this.idleTimer = null;
  }

  private hint(): HintSpec | null {
    switch (this.step) {
      case 'tapAnimal': {
        const candidates = this.animals.filter((id) => !this.opened.has(id));
        return {
          kind: 'animal',
          gesture: 'tap',
          urgent: this.urgent,
          // La primera vez, la ballena; después, el que quede más a mano.
          preferred: this.opened.size === 0 && candidates.includes(this.firstAnimal) ? this.firstAnimal : null,
          candidates,
        };
      }
      case 'doubleTap':
        return {
          kind: 'animal',
          gesture: 'double',
          urgent: this.urgent,
          preferred: this.target,
          candidates: this.target === null ? [] : [this.target],
        };
      case 'tapText':
        return {
          kind: 'text',
          gesture: 'tap',
          urgent: this.urgent,
          preferred: null,
          candidates: this.texts.filter((id) => !this.read.has(id)),
        };
      default:
        return null;
    }
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}
