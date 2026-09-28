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

export type TutorialStep = 'off' | 'tapAnimal' | 'tapFocused' | 'closeFocus' | 'tapText' | 'explore';

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
 *     lo abre: su ficha y su narración.
 *  2. `tapFocused` — ya en primer plano, una mano toca al animal: «Tócalo
 *     para ver su animación». Se va en cuanto lo toca (su gesto). Solo la
 *     primera vez que se abre cada animal.
 *  3. `closeFocus` — al acabar la narración (o al detenerla), una mano
 *     señala la ✕: «Toca la ✕ para cerrar». UNA sola vez, con el primer
 *     animal: al principio salía con cada uno, y a la tercera se hacía
 *     pesado —cerrar ya se aprendió—.
 *  4. Al cerrar, enseguida, vuelta al paso 1 con otro que falte.
 *
 * (Hubo un paso de doble toque entre el 1 y el 2, cuando un toque solo
 * despertaba al animal y hacían falta dos para abrirlo. Se quitó con el
 * doble toque.)
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
  /** La cámara ya encontró el mapa en esta sesión. */
  private started = false;
  /** Hay una ficha o un texto abiertos. */
  private busy = false;
  /** Ya se despidió: a partir de aquí, exploración libre. */
  private finished = false;
  /** El animal abierto ahora, si lo hay. */
  private focusedAnimal: string | null = null;
  private narrating = false;
  /** Ya se señaló la ✕ una vez (con el primer animal): no se repite. */
  private closeTaught = false;
  /** Animales a los que ya se enseñó a tocar en primer plano (una vez por animal). */
  private readonly gestureTaught = new Set<string>();
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
        // La primera vez que se abre cada animal: «tócalo para ver su
        // animación». Las demás, nada tapa la ficha.
        const animal = this.focusedAnimal;
        if (animal !== null && !this.gestureTaught.has(animal)) {
          this.gestureTaught.add(animal);
          this.show('tapFocused');
        } else if (this.step !== 'closeFocus') {
          this.hide();
        }
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

  /** Tocó al animal que está en primer plano (y este hizo su gesto). */
  focusedAnimalTapped(): void {
    if (this.step === 'tapFocused') this.hide();
  }

  /**
   * La narración de la ficha abierta cambió. Cuando CALLA —acabó, o la
   * detuvo—, la mano señala la ✕, una sola vez en toda la sesión.
   */
  narrationChanged(playing: boolean): void {
    const wasPlaying = this.narrating;
    this.narrating = playing;
    if (!this.busy || this.focusedAnimal === null || !wasPlaying || playing) return;
    if (this.closeTaught) return;
    this.closeTaught = true;
    this.show('closeFocus');
  }

  private showNext(): void {
    if (this.animals.some((id) => !this.opened.has(id))) this.show('tapAnimal');
    else if (!this.finished && this.read.size === 0 && this.texts.length > 0) this.show('tapText');
    else this.hide();
  }

  /** «Explora el resto de Nuquí», un momento, y el tutorial termina. */
  private farewell(): void {
    this.clearTimers();
    this.finished = true;
    this.step = 'explore';
    this.urgent = false;
    this.emit();
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      this.hide();
    }, TUTORIAL_FAREWELL_MS);
  }

  private show(step: TutorialStep): void {
    this.clearTimers();
    this.step = step;
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
    this.closeTaught = false;
    this.gestureTaught.clear();
    this.focusedAnimal = null;
    this.narrating = false;
    this.step = 'off';
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
          urgent: this.urgent,
          // La primera vez, la ballena; después, el que quede más a mano.
          preferred: this.opened.size === 0 && candidates.includes(this.firstAnimal) ? this.firstAnimal : null,
          candidates,
        };
      }
      case 'tapText':
        return {
          kind: 'text',
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
