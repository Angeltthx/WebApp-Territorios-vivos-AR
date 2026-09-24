/**
 * Fondo de cámara SINCRONIZADO con la pose: se ve exactamente el fotograma
 * con el que MindAR calculó dónde está el mapa.
 *
 * EL PROBLEMA. MindAR pinta la cámara con un <video> en vivo, pero la pose
 * de los animales sale de analizar un fotograma que el vídeo ya dejó atrás:
 * en un teléfono de gama media, entre 50 y 100 ms. Quieto no se nota; al
 * mover el teléfono de golpe, el mapa del vídeo se va y los animales llegan
 * tarde —"van a destiempo con la imagen"—. Ningún suavizado lo arregla: el
 * retraso está en qué imagen se enseña, no en la pose.
 *
 * LA SOLUCIÓN, la misma que usan ARKit y ARCore: mientras el mapa está
 * siendo seguido, el fondo NO es el vídeo sino una copia del fotograma que
 * se acaba de analizar, y se cambia justo cuando llega su pose. Imagen y
 * animales avanzan juntos, así que por brusco que sea el movimiento los
 * animales siguen clavados en su sitio del mapa. El coste es que ese fondo
 * va al ritmo del seguimiento, no de la cámara; sin mapa a la vista se
 * vuelve al vídeo en vivo.
 *
 * LA COPIA ES GRATIS: MindAR ya pinta cada fotograma en un canvas propio
 * para subirlo a la GPU (`InputLoader.loadInput`). Se envuelve ese método y
 * se copia ese canvas —canvas a canvas, en GPU— a uno de los dos de aquí,
 * que se turnan (doble búfer) para no copiar dos veces.
 *
 * FOTOGRAMAS PERDIDOS. Cuando un tirón emborrona la imagen, MindAR pierde el
 * seguimiento pero sigue declarando el mapa "visible" durante
 * `missTolerance` fotogramas con la ÚLTIMA pose conocida: con el vídeo en
 * vivo moviéndose debajo, eso eran animales flotando en un sitio que ya no
 * es el suyo. Ahora, durante unos pocos fotogramas fallidos el fondo se
 * congela con la última imagen buena —los animales siguen en su sitio
 * sobre ella— y si el fallo dura más, se vuelve al vídeo y los animales se
 * ocultan (`isStale`) hasta que se reencuentra el mapa. Mejor un instante
 * sin animales que animales en el sitio equivocado.
 *
 * DESACTIVADO POR DEFECTO (`lockBackground: false`). Probado en iPhone, el
 * fondo sincronizado VIBRABA: se renueva al ritmo del seguimiento —menos
 * fotogramas por segundo que la cámara— y se congela en cada fotograma
 * perdido, así que el pulso natural de la mano se veía como una imagen que
 * tiembla a saltos debajo de unos animales quietos. Se pidió explícitamente
 * lo contrario: una imagen "fija, quieta y tranquila". Sin el fondo, esta
 * clase sigue haciendo lo que sí se queda: vigilar los fotogramas perdidos
 * y marcar `isStale` para que los animales no floten en una pose vieja.
 * Con `lockBackground: true` vuelve a sincronizar el fondo, por si algún
 * día merece la pena en un dispositivo concreto.
 *
 * Todo esto toca el interior de MindAR (`controller.inputLoader`,
 * `controller.onUpdate`, `controller.trackingStates`), verificado en
 * mind-ar@1.2.5: `src/image-target/controller.js` e `input-loader.js`. Si
 * algo no está donde se espera, `install` devuelve false y la app sigue
 * con el vídeo en vivo de siempre.
 */

/** Fotogramas fallidos que se aguantan con el fondo congelado antes de soltar. */
const MAX_FROZEN_MISSES = 3;
/**
 * Lo mismo con el vídeo en vivo. Algo más de margen: aquí no hay imagen
 * congelada que justifique soltar pronto, y un fallo suelto con el teléfono
 * quieto no debe hacer parpadear a los animales.
 */
const MAX_LIVE_MISSES = 5;

export interface PoseSyncOptions {
  /** Sustituir el vídeo en vivo por el fotograma analizado. Ver arriba: vibra. */
  readonly lockBackground: boolean;
}

interface InputLoaderLike {
  context: CanvasRenderingContext2D;
  loadInput(input: unknown): unknown;
}

interface ControllerLike {
  inputLoader?: InputLoaderLike;
  onUpdate?: ((data: { type: string }) => void) | null;
  trackingStates?: readonly { showing: boolean; isTracking: boolean }[];
}

export class FrameLockedBackground {
  private readonly buffers: HTMLCanvasElement[] = [];
  private back = 0;
  private misses = 0;
  private stale = false;
  private locked = false;
  private restore: (() => void) | null = null;
  private lockBackground = false;

  /**
   * Engancha el fondo sincronizado. Llamar DESPUÉS de `mindar.start()`: el
   * controlador y su bucle ya existen, y ambos métodos se leen de nuevo en
   * cada vuelta del bucle, así que envolverlos ahora surte efecto.
   */
  install(
    controller: unknown,
    video: HTMLVideoElement,
    container: HTMLElement,
    options: PoseSyncOptions = { lockBackground: false },
  ): boolean {
    this.uninstall();
    const target = controller as ControllerLike | undefined;
    const onUpdate = target?.onUpdate;
    if (target === undefined || typeof onUpdate !== 'function') return false;

    this.lockBackground = options.lockBackground;
    if (!options.lockBackground) {
      // Solo vigilar: el vídeo en vivo sigue siendo el fondo.
      target.onUpdate = (data) => {
        onUpdate(data);
        if (data.type === 'processDone') this.onProcessed(target, video);
      };
      this.restore = () => { target.onUpdate = onUpdate; };
      return true;
    }

    const loader = target.inputLoader;
    const source = loader?.context?.canvas;
    if (loader === undefined || source === undefined) return false;
    // Con el teléfono girado MindAR rota la imagen al copiarla, y esa copia
    // ya no se puede superponer al vídeo tal cual. Caso raro: vídeo en vivo.
    if (source.width !== video.videoWidth || source.height !== video.videoHeight) return false;

    const contexts: CanvasRenderingContext2D[] = [];
    for (let i = 0; i < 2; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.style.position = 'absolute';
      // Encima del vídeo (-2) y debajo del lienzo de three.
      canvas.style.zIndex = '-1';
      canvas.style.pointerEvents = 'none';
      canvas.style.visibility = 'hidden';
      canvas.setAttribute('aria-hidden', 'true');
      const context = canvas.getContext('2d', { alpha: false });
      if (context === null) {
        this.uninstall();
        return false;
      }
      contexts.push(context);
      this.buffers.push(canvas);
      container.appendChild(canvas);
    }

    const originalLoad = loader.loadInput;
    loader.loadInput = (input: unknown) => {
      const result = originalLoad.call(loader, input);
      contexts[this.back]!.drawImage(source, 0, 0);
      return result;
    };
    target.onUpdate = (data) => {
      onUpdate(data);
      if (data.type === 'processDone') this.onProcessed(target, video);
    };

    this.restore = () => {
      loader.loadInput = originalLoad;
      target.onUpdate = onUpdate;
      video.style.opacity = '';
    };
    return true;
  }

  /**
   * Si la pose del mapa ya no corresponde a lo que se ve. Mientras lo sea,
   * los animales no deben pintarse aunque MindAR diga que el mapa sigue ahí.
   */
  get isStale(): boolean {
    return this.stale;
  }

  uninstall(): void {
    this.restore?.();
    this.restore = null;
    for (const canvas of this.buffers) canvas.remove();
    this.buffers.length = 0;
    this.locked = false;
    this.stale = false;
    this.misses = 0;
  }

  private onProcessed(controller: ControllerLike, video: HTMLVideoElement): void {
    const state = controller.trackingStates?.[0];
    if (state === undefined || !state.showing) {
      this.misses = 0;
      this.stale = false;
      this.showLive(video);
      return;
    }
    if (state.isTracking) {
      this.misses = 0;
      this.stale = false;
      if (this.lockBackground) this.present(video);
      return;
    }
    // Fallo con el mapa aún "visible": se aguanta un momento (con el fondo
    // sincronizado, congelado en el último fotograma bueno); si no vuelve,
    // se suelta y los animales se ocultan.
    this.misses += 1;
    if (this.misses > (this.lockBackground ? MAX_FROZEN_MISSES : MAX_LIVE_MISSES)) {
      this.stale = true;
      this.showLive(video);
    }
  }

  private present(video: HTMLVideoElement): void {
    const shown = this.buffers[this.back];
    const hidden = this.buffers[1 - this.back];
    if (shown === undefined || hidden === undefined) return;
    // Mismo encuadre que el vídeo: MindAR lo recoloca al girar o
    // redimensionar, así que se copia cada vez (cuatro propiedades).
    const { top, left, width, height } = video.style;
    Object.assign(shown.style, { top, left, width, height, visibility: 'visible' });
    hidden.style.visibility = 'hidden';
    this.back = 1 - this.back;
    if (!this.locked) {
      // Transparente, no oculto: iOS pausa un <video> con display:none.
      video.style.opacity = '0';
      this.locked = true;
    }
  }

  private showLive(video: HTMLVideoElement): void {
    if (!this.locked) return;
    for (const canvas of this.buffers) canvas.style.visibility = 'hidden';
    video.style.opacity = '';
    this.locked = false;
  }
}
