import type { ArModel } from '@domain/entities/ArModel';
import type { ArSession, SessionStatus } from '@domain/entities/ArSession';

const HINTS: Record<SessionStatus, string> = {
  idle: 'Preparando la experiencia…',
  preparing: 'Preparando la escena…',
  searching: 'Apunta la cámara al mapa de Nuquí',
  tracking: 'Toca el animal para que suene',
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
 * Cuánto dura la guía la primera vez, sin que nadie la pida.
 *
 * Lo bastante para leer el rótulo y entender el marco, y lo bastante poco
 * para no estorbar a quien ya tiene el mapa delante.
 */
const GUIDE_AUTO_MS = 5500;

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
}

/**
 * Capa externa: solo pinta estado y emite intenciones.
 * No conoce MindAR, ni Three.js, ni las reglas de escala o rotación.
 *
 * Las guías se gobiernan aquí y no en el dominio a propósito: que un cartel
 * dure cinco segundos o quince es una decisión de presentación, no una
 * regla de la experiencia. La sesión no necesita saber que existen.
 *
 * Lo que sí viene del dominio es CUÁNDO toca cada una: `needsApproachHint`
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
  private readonly focusInfo: HTMLElement;
  private readonly focusClose: HTMLButtonElement;

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
  /** La guía automática se muestra una vez por sesión, no en cada recaída. */
  private guideAutoShown = false;

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
    this.focusInfo = this.require(root, '#focus-info');
    this.focusClose = this.require<HTMLButtonElement>(root, '#focus-close');

    this.focusClose.addEventListener('click', callbacks.onCloseFocus);

    // El «?» no es una intención de dominio: nada fuera de esta vista
    // necesita enterarse, así que no sale como callback.
    this.helpButton.addEventListener('click', () => this.showGuide(GUIDE_HELP_MS));

    this.menuButton.addEventListener('click', () => this.toggleMenu());

    // Las opciones todavía no llevan a ninguna parte: hoy solo cierran el
    // menú. Su `data-action` en el HTML es el gancho por el que entrarán
    // cuando se decida qué hace cada una.
    for (const item of this.menu.querySelectorAll('button')) {
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
    this.syncGuide(session);

    // Con una ficha abierta, el «?» sobra y además chocaría con la X: los
    // dos viven en la misma esquina.
    this.helpButton.hidden = !session.hasStarted || this.focusVisible;

    // El menú vive en la esquina de enfrente y sigue la misma regla. Si se
    // esconde, se cierra: un menú desplegado bajo un botón que ya no está
    // es un cartel huérfano en mitad de la cámara.
    this.menuButton.hidden = !session.hasStarted || this.focusVisible;
    if (this.menuButton.hidden) this.closeMenu();

    // Va al final para leer el estado ya actualizado, incluido el del menú.
    this.syncTransientHints(session);
  }

  /**
   * Los carteles que el menú tapa.
   *
   * Se recalculan también al abrir y cerrar el menú, no solo al cambiar la
   * sesión. El motivo es visual y se ve en el móvil: el menú es
   * semitransparente, así que "Acerca tu cámara a un animal" no quedaba
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
      this.focusInfo.textContent = model?.description ?? '';
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
      this.guideAutoShown = false;
      this.hideGuide();
      return;
    }

    // Encontrado el mapa, la guía sobra: le toca el turno al otro cartel.
    if (session.status === 'tracking') {
      this.hideGuide();
      return;
    }

    if (session.status === 'searching' && !this.guideAutoShown) {
      this.guideAutoShown = true;
      this.showGuide(GUIDE_AUTO_MS);
    }
  }

  /**
   * El segundo cartel: "acerca tu cámara a un animal".
   *
   * A diferencia de la guía, este no lleva temporizador. Se queda mientras
   * haga falta y desaparece solo cuando el usuario hace lo que pide, que es
   * el momento exacto en que la instrucción deja de tener sentido. Que la
   * condición venga del dominio (`needsApproachHint`) es lo que garantiza
   * que no se quede colgado.
   */
  private syncApproach(session: ArSession): void {
    const show =
      session.needsApproachHint &&
      !this.guideVisible &&
      !this.bootVisible &&
      !this.focusVisible &&
      !this.menuVisible;
    this.approach.dataset['visible'] = show ? 'true' : 'false';
    this.approach.setAttribute('aria-hidden', show ? 'false' : 'true');
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

  private showGuide(durationMs: number): void {
    this.clearGuideTimer();
    this.guide.dataset['visible'] = 'true';
    this.guide.setAttribute('aria-hidden', 'false');
    this.guideTimer = window.setTimeout(() => {
      this.hideGuide();
      this.repaintTransientHints();
    }, durationMs);
    this.repaintTransientHints();
  }

  private hideGuide(): void {
    this.clearGuideTimer();
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

  private get focusVisible(): boolean {
    return this.focus.dataset['visible'] === 'true';
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
