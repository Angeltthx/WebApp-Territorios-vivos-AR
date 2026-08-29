import type { ArSession, SessionStatus } from '@domain/entities/ArSession';

const HINTS: Record<SessionStatus, string> = {
  idle: 'Pulsa Iniciar para activar la cámara',
  preparing: 'Preparando la escena…',
  searching: 'Apunta la cámara al mapa de Nuquí',
  tracking: 'Toca un animal para que suene',
  lost: 'Mapa fuera de encuadre. Vuelve a apuntar',
  error: 'Ocurrió un problema',
};

/**
 * Cuánto dura la guía la primera vez, sin que nadie la pida.
 *
 * Lo bastante para leer el rótulo y entender el marco, y lo bastante poco
 * para no estorbar a quien ya tiene el mapa delante. Quien la necesite más
 * tiempo la recupera con el botón «?», y esa sí se queda hasta que el mapa
 * aparezca.
 */
const GUIDE_AUTO_MS = 5500;

/** Cómo se pidió la guía, que es lo que decide cuándo se va. */
type GuideMode =
  /** Automática al empezar a buscar: se va sola a los pocos segundos. */
  | 'timed'
  /** Pedida con «?»: se queda hasta que el mapa entre en cuadro. */
  | 'until-found';

export interface ArViewCallbacks {
  onStart: () => void;
}

/**
 * Capa externa: solo pinta estado y emite intenciones.
 * No conoce MindAR, ni Three.js, ni las reglas de escala o rotación.
 *
 * La guía de encuadre se gobierna aquí y no en el dominio a propósito: que
 * un cartel dure cinco segundos o hasta que aparezca el marcador es una
 * decisión de presentación, no una regla de la experiencia. La sesión no
 * necesita saber que existe.
 */
export class ArView {
  private readonly hint: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly guide: HTMLElement;

  private guideTimer: number | null = null;
  /** La guía automática se muestra una vez por sesión, no en cada recaída. */
  private guideAutoShown = false;

  constructor(root: HTMLElement, callbacks: ArViewCallbacks) {
    this.hint = this.require(root, '#hint');
    this.startButton = this.require<HTMLButtonElement>(root, '#start');
    this.helpButton = this.require<HTMLButtonElement>(root, '#help');
    this.guide = this.require(root, '#guide');

    this.startButton.addEventListener('click', callbacks.onStart);
    // El «?» no es una intención de dominio: nada fuera de esta vista
    // necesita enterarse, así que no sale como callback.
    this.helpButton.addEventListener('click', () => this.showGuide('until-found'));
  }

  render(session: ArSession): void {
    this.hint.textContent = session.error?.message ?? HINTS[session.status];
    this.hint.dataset['tone'] = session.status === 'error' ? 'error' : 'normal';

    this.startButton.hidden = !session.canStart;
    this.startButton.textContent = session.status === 'error' ? 'Reintentar' : 'Iniciar AR';
    this.helpButton.hidden = !session.hasStarted;

    this.syncGuide(session);

    // La guía ya dice «Apunta al mapa de Nuquí» en grande; repetirlo en la
    // píldora de abajo sobra. Se calcula DESPUÉS de syncGuide para leer el
    // estado ya actualizado.
    this.hint.hidden = this.guideVisible;
  }

  private syncGuide(session: ArSession): void {
    if (!session.hasStarted) {
      this.guideAutoShown = false;
      this.hideGuide();
      return;
    }

    // Encontrado el mapa, la guía sobra: se va en los dos modos.
    if (session.status === 'tracking') {
      this.hideGuide();
      return;
    }

    if (session.status === 'searching' && !this.guideAutoShown) {
      this.guideAutoShown = true;
      this.showGuide('timed');
    }
  }

  private showGuide(mode: GuideMode): void {
    this.clearGuideTimer();
    this.guide.dataset['visible'] = 'true';
    this.guide.setAttribute('aria-hidden', 'false');

    if (mode === 'timed') {
      this.guideTimer = window.setTimeout(() => this.hideGuide(), GUIDE_AUTO_MS);
    }
  }

  private hideGuide(): void {
    this.clearGuideTimer();
    this.guide.dataset['visible'] = 'false';
    this.guide.setAttribute('aria-hidden', 'true');
  }

  private get guideVisible(): boolean {
    return this.guide.dataset['visible'] === 'true';
  }

  private clearGuideTimer(): void {
    if (this.guideTimer === null) return;
    window.clearTimeout(this.guideTimer);
    this.guideTimer = null;
  }

  /** Falla ruidosamente si el HTML y la vista se desincronizan. */
  private require<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`Falta el elemento "${selector}" en el HTML`);
    }
    return element;
  }
}
