import type { MapText, MapTextBlock } from '@domain/value-objects/MapText';
import type { ArModel } from '@domain/entities/ArModel';
import type { ArSession, SessionStatus } from '@domain/entities/ArSession';

const HINTS: Record<SessionStatus, string> = {
  idle: 'Preparando la experiencia…',
  preparing: 'Preparando la escena…',
  searching: 'Apunta la cámara al mapa de Nuquí',
  tracking: 'Toca un animal para conocerlo',
  lost: 'Mapa fuera de encuadre. Vuelve a apuntar',
  error: 'Ocurrió un problema',
};

/**
 * La pantalla inicial no se va sola: se va cuando alguien pulsa «Iniciar
 * experiencia AR».
 *
 * Hubo una versión sin botón, con la cámara pidiéndose sola a los cuatro
 * segundos. Se quitó al llegar el diseño de la pantalla de bienvenida, que
 * trae su botón dibujado, y de paso se recuperaron dos cosas que el
 * arranque automático había roto:
 *
 *  - **El permiso de cámara.** Uno que salta solo, sobre una pantalla que
 *    el usuario no ha pedido, se deniega; pulsando «Iniciar» se concede.
 *  - **El gesto de usuario.** iOS solo desbloquea el audio dentro de un
 *    toque real, y solo con uno delante deja de tratar el vídeo de la
 *    cámara como un reproductor con sus mandos.
 *
 * Mientras tanto no se pierde tiempo: los 3,3 MB de modelos se bajan desde
 * el primer instante (`onPrepare`), mientras se lee la pantalla.
 */

/**
 * La guía de la primera vez NO se va sola: se queda hasta que la cámara
 * encuentra el mapa. Antes duraba 5,5 s, y quien todavía no había sacado el
 * mapa se quedaba mirando la cámara sin saber qué buscar.
 *
 * Y si pasa este rato sin encontrarlo, el marco y el texto empiezan a
 * LATIR —crecen un poco con un brillo, vuelven, descansan—: una instrucción
 * que lleva un rato quieta en pantalla deja de leerse, y el movimiento la
 * vuelve a poner delante.
 */
const GUIDE_CALL_TO_ACTION_MS = 5000;

/**
 * Cuánto dura cuando la pide el botón «?».
 *
 * Antes se quedaba hasta que apareciera el mapa, y esa era exactamente la
 * trampa: quien pulsaba «?» sin el mapa delante —para leer la instrucción,
 * que es justo cuando se pulsa— se quedaba con el cartel puesto tapándole
 * la cámara, sin forma de quitarlo. Ahora se va sola, y rápido: quien la
 * pide ya sabe lo que busca, solo quiere recordar el encuadre.
 */
const GUIDE_HELP_MS = 5000;

export interface ArViewCallbacks {
  /** Empezar a bajar los modelos. Se dispara al instante, sin esperar. */
  onPrepare: () => void;
  /** Pedir la cámara y arrancar. Se dispara al acabar la bienvenida. */
  onStart: () => void;
  /** Cerrar la ficha del animal que se está mirando de cerca. */
  onCloseFocus: () => void;
  /** Escuchar la narración del animal, o detenerla si está sonando. */
  onToggleNarration: () => void;
  /**
   * El volumen general que debe sonar, 0–1 (0 si está silenciado). Se
   * dispara también al construir la vista, con el que se eligió la última
   * vez en este teléfono.
   */
  onVolumeChange: (level: number) => void;
}

/** Dónde se recuerda el volumen elegido, en este navegador. */
const VOLUME_KEY = 'territorios-vivos:volumen';
/** Al quitar el silencio con el nivel en 0, a cuánto vuelve. */
const UNMUTE_LEVEL = 0.6;

/** El paso del tutorial que tiene que escribir el cartel. */
export interface TutorialView {
  readonly step: 'off' | 'tapAnimal' | 'tapFocused' | 'closeFocus' | 'tapText' | 'explore';
  readonly urgent: boolean;
  /** Animales que faltan por conocer. */
  readonly remaining: number;
  /** Ya conoce alguno. */
  readonly returning: boolean;
}

/** Lo que la vista necesita saber de la narración para pintar su botón. */
export interface NarrationView {
  readonly available: boolean;
  readonly playing: boolean;
}

/**
 * Capa externa: solo pinta estado y emite intenciones.
 * No conoce MindAR, ni Three.js, ni las reglas de escala o rotación.
 *
 * Las guías se gobiernan aquí y no en el dominio a propósito: que un cartel
 * dure cinco segundos o quince es una decisión de presentación, no una
 * regla de la experiencia. La sesión no necesita saber que existen.
 *
 * Lo que sí viene del dominio es CUÁNDO toca cada una: `needsTapHint`
 * es una pregunta sobre el estado de la sesión, no sobre el HTML.
 */
export class ArView {
  private readonly hint: HTMLElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly guide: HTMLElement;
  private readonly approach: HTMLElement;
  private readonly boot: HTMLElement;
  private readonly bootStatus: HTMLElement;
  private readonly bootStatusText: HTMLElement;
  /** Los .glb ya estan en memoria. Cambia el cartel de la espera. */
  private modelsReady = false;
  private readonly focus: HTMLElement;
  private readonly focusName: HTMLElement;
  private readonly focusSpecies: HTMLElement;
  private readonly focusInfo: HTMLElement;
  private readonly focusClose: HTMLButtonElement;
  private readonly narrationButton: HTMLButtonElement;
  private readonly narrationLabel: HTMLElement;
  private readonly soundToggle: HTMLButtonElement;
  private readonly soundLevel: HTMLInputElement;
  private readonly onVolumeChange: (level: number) => void;
  /** Nivel elegido con la barra, 0–1, y si está silenciado encima. */
  private level = 1;
  private muted = false;
  private readonly reading: HTMLElement;
  private readonly readingCard: HTMLElement;
  private mapTexts: readonly MapText[] = [];
  /** El paso del tutorial (lo decide Tutorial, el mismo reloj que la mano). */
  private tutorial: TutorialView = { step: 'off', urgent: false, remaining: 0, returning: false };
  private readonly approachTitle: HTMLElement;
  private readonly approachSub: HTMLElement;

  /**
   * El catálogo, para poder escribir el nombre y la ficha del animal
   * enfocado. La sesión solo guarda su id: duplicar los textos dentro del
   * estado sería tener la misma verdad en dos sitios.
   */
  private catalog: readonly ArModel[] = [];

  /**
   * La última sesión pintada.
   *
   * El menú se abre y se cierra sin que el dominio cambie de estado, y aun
   * así mueve carteles. Guardar la sesión es lo que permite recalcularlos
   * en ese momento sin inventarse un estado que no existe.
   */
  private lastSession: ArSession | null = null;

  private guideTimer: number | null = null;
  /** Cuenta los 5 s de guía sin mapa antes del llamado a la acción. */
  private callTimer: number | null = null;
  /**
   * La cámara ya encontró el mapa alguna vez en esta sesión. Hasta entonces
   * la guía se queda puesta; después, perderlo lo avisa la píldora de abajo.
   */
  private mapFound = false;

  constructor(root: HTMLElement, callbacks: ArViewCallbacks) {
    this.hint = this.require(root, '#hint');
    this.helpButton = this.require<HTMLButtonElement>(root, '#help');
    this.menuButton = this.require<HTMLButtonElement>(root, '#menu-button');
    this.menu = this.require(root, '#menu');
    this.retryButton = this.require<HTMLButtonElement>(root, '#retry');
    this.startButton = this.require<HTMLButtonElement>(root, '#start');
    this.guide = this.require(root, '#guide');
    this.approach = this.require(root, '#approach');
    this.boot = this.require(root, '#boot');
    this.bootStatus = this.require(root, '#boot-status');
    this.bootStatusText = this.require(root, '#boot-status-text');
    this.focus = this.require(root, '#focus');
    this.focusName = this.require(root, '#focus-name');
    this.focusSpecies = this.require(root, '#focus-species');
    this.focusInfo = this.require(root, '#focus-info');
    this.focusClose = this.require<HTMLButtonElement>(root, '#focus-close');

    this.focusClose.addEventListener('click', callbacks.onCloseFocus);

    this.narrationButton = this.require<HTMLButtonElement>(root, '#focus-narration');
    this.narrationLabel = this.require(root, '#focus-narration-label');
    this.narrationButton.addEventListener('click', callbacks.onToggleNarration);

    // El volumen, en el menú. El altavoz silencia sin olvidar el nivel; la
    // barra lo mueve (y llevarla a 0 es silenciar). Se recuerda en este
    // navegador: quien lo bajó en un museo no quiere que vuelva a sonar a
    // todo volumen al recargar.
    this.soundToggle = this.require<HTMLButtonElement>(root, '#sound-toggle');
    this.soundLevel = this.require<HTMLInputElement>(root, '#sound-level');
    this.onVolumeChange = callbacks.onVolumeChange;
    this.restoreVolume();
    this.soundToggle.addEventListener('click', () => {
      if (this.muted || this.level === 0) {
        this.muted = false;
        if (this.level === 0) this.level = UNMUTE_LEVEL;
      } else {
        this.muted = true;
      }
      this.applyVolume();
    });
    this.soundLevel.addEventListener('input', () => {
      this.level = Number(this.soundLevel.value) / 100;
      this.muted = this.level === 0;
      this.applyVolume();
    });

    this.reading = this.require(root, '#reading');
    this.readingCard = this.require(root, '#reading-card');
    this.approachTitle = this.require(root, '#approach-title');
    this.approachSub = this.require(root, '#approach-sub');
    this.require<HTMLButtonElement>(root, '#reading-close').addEventListener('click', callbacks.onCloseFocus);
    // Tocar fuera de la tarjeta también la cierra: es un texto, no hay nada
    // que girar detrás, y es el gesto que cualquiera prueba primero.
    this.reading.addEventListener('click', (event) => {
      if (event.target === this.reading) callbacks.onCloseFocus();
    });

    // El «?» no es una intención de dominio: nada fuera de esta vista
    // necesita enterarse, así que no sale como callback.
    this.helpButton.addEventListener('click', () => this.showGuide(GUIDE_HELP_MS));

    this.menuButton.addEventListener('click', () => this.toggleMenu());

    // Las opciones todavía no llevan a ninguna parte: hoy solo cierran el
    // menú. Su `data-action` en el HTML es el gancho por el que entrarán
    // cuando se decida qué hace cada una.
    // Solo las opciones: el control de volumen se usa con el menú abierto.
    for (const item of this.menu.querySelectorAll('button[data-action]')) {
      item.addEventListener('click', () => this.closeMenu());
    }

    // Tocar fuera cierra, que es lo primero que intenta cualquiera. Se
    // escucha en captura y SIN `preventDefault`: el toque tiene que seguir
    // su camino hasta el canvas, o cerrar el menú impediría tocar al animal
    // que hay debajo.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.menuVisible) return;
        const target = event.target;
        if (target instanceof Node && this.insideMenu(target)) return;
        this.closeMenu();
      },
      true,
    );

    // Reintentar SÍ vuelve a arrancar la sesión. Es el único botón que
    // queda capaz de hacerlo, y solo se ve si algo falló: sin él, denegar
    // la cámara por accidente dejaba la app muerta hasta recargar.
    this.retryButton.addEventListener('click', () => {
      this.retryButton.hidden = true;
      callbacks.onStart();
    });

    // Iniciar: el único gesto de la experiencia, y el que dispara la
    // cámara.
    //
    // La portada NO se retira aquí, y ese cambio es el arreglo de los
    // "siete segundos en negro": el permiso, el calentamiento de MindAR y
    // lo que falte por bajar pasan DESPUÉS de este toque, y retirarla
    // dejaba todo ese rato una pantalla negra que se lee como un cuelgue.
    // Se queda puesta, con su cartel de en qué paso va, y se va sola
    // cuando la cámara ya está dando imagen (`cameraReady`).
    //
    // Antes se retiraba antes de tiempo para que el permiso del sistema
    // saliera sobre la cámara y no sobre la bienvenida. No hacía falta:
    // el permiso sale igual, y sobre la portada se entiende mejor de qué
    // va lo que se está concediendo.
    this.startButton.addEventListener('click', () => {
      this.boot.dataset['starting'] = 'true';
      this.bootStatus.hidden = false;
      this.bootStatusText.textContent = this.modelsReady
        ? 'Encendiendo la cámara…'
        : 'Cargando los animales…';
      callbacks.onStart();
    });

    // La descarga arranca YA, no al pulsar: los cuatro modelos tardan más
    // que lo que nadie mira una pantalla de bienvenida, así que solaparlos
    // es la diferencia entre esperar una vez o esperar dos.
    callbacks.onPrepare();
  }

  /**
   * El botón de la narración, en la ficha. La primera vez que se abre un
   * animal la voz arranca sola y el botón ofrece DETENERLA (para quedarse
   * con el sonido del sitio); después ofrece escucharla. Mientras suena,
   * unas barras se mueven al ritmo de una voz: el botón dice qué está
   * pasando, no solo qué hace.
   */
  setNarration(state: NarrationView): void {
    this.narrationButton.hidden = !state.available;
    this.narrationButton.dataset['playing'] = state.playing ? 'true' : 'false';
    this.narrationButton.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    this.narrationLabel.textContent = state.playing ? 'Detener narración' : 'Escuchar narración';
  }

  private applyVolume(): void {
    this.soundLevel.value = String(Math.round((this.muted ? 0 : this.level) * 100));
    this.soundToggle.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
    this.soundToggle.setAttribute('aria-label', this.muted ? 'Activar el sonido' : 'Silenciar');
    this.onVolumeChange(this.muted ? 0 : this.level);
    try {
      window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ level: this.level, muted: this.muted }));
    } catch {
      // Sin almacenamiento (modo privado): se olvida al recargar, nada más.
    }
  }

  private restoreVolume(): void {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(VOLUME_KEY) ?? 'null');
      if (saved !== null && typeof saved === 'object') {
        const { level, muted } = saved as { level?: unknown; muted?: unknown };
        if (typeof level === 'number' && level >= 0 && level <= 1) this.level = level;
        this.muted = muted === true;
      }
    } catch {
      // Nada guardado o no se puede leer: volumen entero.
    }
    this.applyVolume();
  }

  /** El paso del tutorial: qué pide el cartel, y si insiste. */
  setTutorial(state: TutorialView): void {
    this.tutorial = state;
    this.writeTutorial();
    if (this.lastSession !== null) this.syncTransientHints(this.lastSession);
  }

  /** Los textos del mapa que se pueden abrir en grande. */
  setMapTexts(texts: readonly MapText[]): void {
    this.mapTexts = texts;
  }

  /** Se llama una vez, cuando el catálogo termina de cargar. */
  setCatalog(catalog: readonly ArModel[]): void {
    this.catalog = catalog;
    this.modelsReady = true;
    // Si ya se pulsó Iniciar, el cartel pasa al paso siguiente. Eso le
    // dice a quien espera que la barra avanza, y a quien depura DÓNDE se
    // está yendo el tiempo: el mensaje que se queda puesto es el culpable.
    if (this.bootStatus.hidden) return;
    this.bootStatusText.textContent = 'Encendiendo la cámara…';
  }

  /**
   * La cámara ya está dando imagen: se puede retirar la portada.
   *
   * Lo llama `main.ts` cuando `execute` termina, que es el primer momento
   * en que hay algo que enseñar detrás. Si algo falló, no llega hasta aquí
   * — de eso se encarga `render`, que retira la portada al ver el error
   * para que el mensaje no se quede debajo.
   */
  cameraReady(): void {
    this.hideBoot();
    if (this.lastSession !== null) this.render(this.lastSession);
  }

  render(session: ArSession): void {
    this.lastSession = session;
    this.hint.textContent = session.error?.message ?? HINTS[session.status];
    this.hint.dataset['tone'] = session.status === 'error' ? 'error' : 'normal';

    // Un error puede llegar antes de que termine la bienvenida (por ejemplo
    // si el navegador no soporta la cámara). En ese caso la pantalla negra
    // sobra: lo que hay que enseñar es el problema.
    if (session.status === 'error') this.hideBoot();

    this.retryButton.hidden = session.status !== 'error';

    this.syncFocus(session);
    this.syncReading(session);
    this.syncGuide(session);

    // Con una ficha abierta, el «?» sobra y además chocaría con la X: los
    // dos viven en la misma esquina.
    this.helpButton.hidden = !session.hasStarted || this.focusVisible;

    // El menú vive en la esquina de enfrente y sigue la misma regla. Si se
    // esconde, se cierra: un menú desplegado bajo un botón que ya no está
    // es un cartel huérfano en mitad de la cámara.
    //
    // Con una excepción: con la ficha de un animal abierta el ☰ SE QUEDA,
    // porque dentro está el volumen y es justo cuando suena la narración
    // cuando uno quiere bajarlo. No choca con nada: la X vive en la otra
    // esquina. Con un texto abierto sí se va (su tarjeta ocupa la pantalla).
    this.menuButton.hidden = !session.hasStarted || session.discovery.reading !== null;
    if (this.menuButton.hidden) this.closeMenu();

    // Va al final para leer el estado ya actualizado, incluido el del menú.
    this.syncTransientHints(session);
  }

  /**
   * Los carteles que el menú tapa.
   *
   * Se recalculan también al abrir y cerrar el menú, no solo al cambiar la
   * sesión. El motivo es visual y se ve en el móvil: el menú es
   * semitransparente, así que "Toca un animal" no quedaba
   * detrás sino ATRAVESÁNDOLO, con las letras encima de las opciones. Que
   * el menú gane por z-index no basta cuando se le ve el fondo; lo que
   * hace falta es que el cartel se aparte mientras el menú está abierto, y
   * vuelva al cerrarlo.
   */
  private syncTransientHints(session: ArSession): void {
    this.syncApproach(session);

    // Cualquier cartel a pantalla completa ya lleva su propio texto en
    // grande; repetirlo en la píldora de abajo sobra.
    this.hint.hidden =
      this.bootVisible ||
      this.guideVisible ||
      this.approachVisible ||
      this.focusVisible ||
      this.menuVisible;
  }

  /**
   * La ficha del animal en primer plano.
   *
   * Solo escribe los textos cuando CAMBIA el animal: repintarlos en cada
   * fotograma reiniciaría la selección de texto y haría parpadear el
   * renderizado en algunos navegadores.
   */
  private syncFocus(session: ArSession): void {
    const focused = session.discovery.focused;
    const show = focused !== null;

    if (focused !== null && this.focus.dataset['modelId'] !== focused.value) {
      this.focus.dataset['modelId'] = focused.value;
      const model = this.catalog.find((candidate) => candidate.id.equals(focused));
      this.focusName.textContent = model?.name ?? '';
      this.focusSpecies.textContent = model?.species ?? '';
      // Un <p> por párrafo, con textContent: el texto del catálogo nunca se
      // interpreta como HTML.
      this.focusInfo.replaceChildren(...(model?.paragraphs ?? []).map((text) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        return paragraph;
      }));
      this.focusInfo.scrollTop = 0;
    }

    this.focus.dataset['visible'] = show ? 'true' : 'false';
    this.focus.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  // --------------------------------------------------------------- privado

  private syncGuide(session: ArSession): void {
    if (this.bootVisible) return;
    // Con un animal en primer plano no hay nada que encuadrar.
    if (this.focusVisible) {
      this.hideGuide();
      return;
    }

    if (!session.hasStarted) {
      this.mapFound = false;
      this.hideGuide();
      return;
    }

    // Encontrado el mapa, la guía sobra: le toca el turno al otro cartel.
    if (session.status === 'tracking') {
      this.mapFound = true;
      this.hideGuide();
      return;
    }

    // Todavía sin mapa: la guía se queda. El menú abierto la aparta (se
    // leería a través de él); al cerrarlo, vuelve.
    if (this.guidePinned(session) && !this.menuVisible) this.pinGuide();
  }

  /** Buscando el mapa sin haberlo encontrado nunca: la guía no se va. */
  private guidePinned(session: ArSession): boolean {
    return session.hasStarted && session.status === 'searching' && !this.mapFound;
  }

  /**
   * Pone la guía sin fecha de caducidad y, si en 5 s no aparece el mapa,
   * enciende su llamado a la acción. Llamarlo con la guía ya fijada no hace
   * nada: `render` se llama a menudo y reiniciaría la cuenta.
   */
  private pinGuide(): void {
    if (this.guideVisible && this.guideTimer === null) return;
    this.showGuide(null);
    if (this.callTimer !== null || this.guide.dataset['call'] === 'true') return;
    this.callTimer = window.setTimeout(() => {
      this.callTimer = null;
      this.guide.dataset['call'] = 'true';
    }, GUIDE_CALL_TO_ACTION_MS);
  }

  /**
   * El cartel del tutorial, arriba: «Toca un animal», «Tócalo dos veces»,
   * «Toca otro animal», «Toca los puntos amarillos».
   *
   * Qué paso toca y cuándo insiste (`data-urgent`, a los 6 s) lo decide
   * Tutorial, que es el mismo reloj que mueve la mano sobre el mapa: el
   * cartel y la mano van a la vez. Solo con el mapa a la vista: sin él, la
   * mano no se ve y el cartel pediría algo imposible.
   */
  private syncApproach(session: ArSession): void {
    const show =
      this.tutorial.step !== 'off' &&
      session.status === 'tracking' &&
      !this.guideVisible &&
      !this.bootVisible &&
      !this.focusVisible &&
      !this.menuVisible;
    this.approach.dataset['visible'] = show ? 'true' : 'false';
    this.approach.setAttribute('aria-hidden', show ? 'false' : 'true');
    this.approach.dataset['urgent'] = this.tutorial.urgent ? 'true' : 'false';
    // En la ficha: la mano que toca al animal (la primera vez) y la que
    // señala la ✕ al callar la narración.
    this.focus.dataset['tapHint'] = this.tutorial.step === 'tapFocused' && this.focusVisible ? 'true' : 'false';
    this.focus.dataset['closeHint'] = this.tutorial.step === 'closeFocus' && this.focusVisible ? 'true' : 'false';
    this.focus.dataset['urgent'] = this.tutorial.urgent ? 'true' : 'false';
  }

  /** Escribe el paso del tutorial. Solo cuando cambia: no en cada pintado. */
  private writeTutorial(): void {
    const { step, remaining, returning } = this.tutorial;
    const [title, before, strong, after] =
      step === 'tapText'
        ? ['Toca un punto amarillo', 'Cada uno cuenta algo del ', 'Chocó', '']
        : step === 'explore'
          ? ['Explora el resto de Nuquí', 'Toca los ', 'puntos amarillos', ' que quieras']
          : returning
            ? ['Toca otro animal', remaining === 1 ? 'Te falta ' : 'Te faltan ', `${remaining}`, ' por conocer']
            : ['Toca un animal', 'Toca la ', 'silueta dorada', ' para conocerlo'];
    if (step === 'off') return;
    this.approachTitle.textContent = title;
    const emphasis = document.createElement('strong');
    emphasis.textContent = strong;
    this.approachSub.replaceChildren(before, emphasis, after);
  }

  private toggleMenu(): void {
    if (this.menuVisible) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    this.menu.dataset['visible'] = 'true';
    this.menu.setAttribute('aria-hidden', 'false');
    this.menuButton.setAttribute('aria-expanded', 'true');

    // La guía se retira por lo mismo que el cartel de acercarse: su rótulo
    // en grande se leería a través del menú. Quien acaba de abrir el menú
    // ya no está mirando el encuadre.
    this.hideGuide();
    this.repaintTransientHints();
  }

  private closeMenu(): void {
    if (!this.menuVisible) return;
    this.menu.dataset['visible'] = 'false';
    this.menu.setAttribute('aria-hidden', 'true');
    this.menuButton.setAttribute('aria-expanded', 'false');
    // Si todavía no se ha encontrado el mapa, la guía vuelve.
    if (this.lastSession !== null) this.syncGuide(this.lastSession);
    this.repaintTransientHints();
  }

  private repaintTransientHints(): void {
    if (this.lastSession === null) return;
    this.syncTransientHints(this.lastSession);
  }

  private insideMenu(target: Node): boolean {
    return this.menu.contains(target) || this.menuButton.contains(target);
  }

  private get menuVisible(): boolean {
    return this.menu.dataset['visible'] === 'true';
  }

  /** `null`: sin caducidad (la guía de la primera vez). */
  private showGuide(durationMs: number | null): void {
    this.clearGuideTimer();
    this.guide.dataset['visible'] = 'true';
    this.guide.setAttribute('aria-hidden', 'false');
    if (durationMs !== null) {
      this.guideTimer = window.setTimeout(() => {
        this.guideTimer = null;
        // Pedida con «?» cuando aún no hay mapa: no se va, se queda fija.
        if (this.lastSession !== null && this.guidePinned(this.lastSession)) {
          this.pinGuide();
          return;
        }
        this.hideGuide();
        this.repaintTransientHints();
      }, durationMs);
    }
    this.repaintTransientHints();
  }

  private hideGuide(): void {
    this.clearGuideTimer();
    if (this.callTimer !== null) window.clearTimeout(this.callTimer);
    this.callTimer = null;
    delete this.guide.dataset['call'];
    this.guide.dataset['visible'] = 'false';
    this.guide.setAttribute('aria-hidden', 'true');
  }

  private hideBoot(): void {
    this.boot.dataset['visible'] = 'false';
    this.boot.setAttribute('aria-hidden', 'true');
    this.bootStatus.hidden = true;
    // Por si se vuelve con "Reintentar": el botón tiene que poder tocarse
    // otra vez y el halo tiene que volver a invitar.
    delete this.boot.dataset['starting'];
  }

  private get guideVisible(): boolean {
    return this.guide.dataset['visible'] === 'true';
  }

  private get approachVisible(): boolean {
    return this.approach.dataset['visible'] === 'true';
  }

  private get bootVisible(): boolean {
    return this.boot.dataset['visible'] === 'true';
  }

  /**
   * Hay algo abierto a pantalla completa: la ficha de un animal O un texto
   * del mapa. Todo lo que se aparta ante una ficha se aparta igual ante un
   * texto (el «?», el menú, los carteles).
   */
  private get focusVisible(): boolean {
    return this.focus.dataset['visible'] === 'true' || this.reading.dataset['visible'] === 'true';
  }

  /**
   * El texto del mapa que se está leyendo, compuesto con el aspecto que
   * tiene en el papel. Solo se reescribe al CAMBIAR de texto, y siempre
   * con textContent: el catálogo nunca se interpreta como HTML.
   */
  private syncReading(session: ArSession): void {
    const id = session.discovery.reading;
    if (id !== null && this.reading.dataset['textId'] !== id) {
      this.reading.dataset['textId'] = id;
      const text = this.mapTexts.find((candidate) => candidate.id === id);
      // Un solo rótulo (un pueblo, el océano, una especie) va centrado; los
      // párrafos y las listas se leen mejor alineados a la izquierda.
      const lone = text !== undefined && text.blocks.length === 1 && text.blocks[0]!.kind !== 'paragraph'
        && text.blocks[0]!.kind !== 'directory' && text.blocks[0]!.kind !== 'pin';
      this.readingCard.dataset['centered'] = lone ? 'true' : 'false';
      const blocks = (text?.blocks ?? []).map(renderBlock);
      if (text?.illustration) {
        // El dibujo del mapa, recortado sin fondo, encima de su texto.
        const image = document.createElement('img');
        image.className = 'rt-illustration';
        image.src = text.illustration;
        image.alt = '';
        image.decoding = 'async';
        blocks.unshift(image);
      }
      this.readingCard.replaceChildren(...blocks);
      this.readingCard.scrollTop = 0;
      this.reading.setAttribute('aria-label', text?.label ?? 'Texto del mapa');
    }
    if (id === null) delete this.reading.dataset['textId'];
    const show = id !== null;
    this.reading.dataset['visible'] = show ? 'true' : 'false';
    this.reading.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  /**
   * Al encontrar al último animal, los textos del mapa se encienden. Se
   * avisa una vez, cuando se cierra su ficha —con la ficha abierta el aviso
   * quedaría debajo— y de paso se piden las tipografías de lectura.
   */
  /**
   * La invitación «¿Quieres conocer más del Chocó?», con todos los
   * animales encontrados. No es un botón: los puntos ya están en el mapa y
   * esto solo cuenta que se pueden tocar.
   *
   * Sale al quedar el mapa libre (cerrada la ficha del último animal), se
   * va sola a los 15 s o en cuanto se abre algo —tocar un punto es
   * justamente lo que pide—, y si pasa un rato sin que se abra nada vuelve
   * a salir: quien no la vio o no la entendió tiene otra oportunidad.
   */


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

/** Un bloque de texto del mapa, con el aspecto que tiene impreso. */
function renderBlock(block: MapTextBlock): HTMLElement {
  const element = (tag: string, className: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  switch (block.kind) {
    case 'paragraph':
      return element('p', 'rt-paragraph', block.text);
    case 'pin': {
      const pin = element('p', 'rt-pin');
      pin.append(element('span', '', block.text));
      return pin;
    }
    case 'place':
      return element('p', 'rt-place', block.text);
    case 'sea':
      return element('p', 'rt-sea', block.text);
    case 'link':
      return element('p', 'rt-link', block.text);
    case 'species': {
      const species = element('p', 'rt-species');
      species.append(element('span', '', block.name), element('span', '', block.scientific));
      return species;
    }
    case 'directory': {
      const list = element('ul', 'rt-directory');
      for (const entry of block.entries) {
        const item = element('li', '', `${entry.name} `);
        item.append(element('span', 'rt-handle', entry.handle));
        list.append(item);
      }
      return list;
    }
  }
}
