import {
  CameraPermissionDeniedError,
  type TrackingEvent,
  type TrackingPort,
  type Unsubscribe,
} from '@application/ports/TrackingPort';
import type { MindArRuntime } from '../mindar/MindArRuntime';

export class MindArTrackingAdapter implements TrackingPort {
  private readonly handlers = new Map<TrackingEvent, Set<() => void>>();

  constructor(private readonly runtime: MindArRuntime) {}

  async isSupported(): Promise<boolean> {
    // MindAR no usa WebXR: corre sobre getUserMedia + WebGL + WebAssembly,
    // que es exactamente por qué SÍ funciona en Safari/iOS.
    const hasCamera = typeof navigator.mediaDevices?.getUserMedia === 'function';
    const hasWebGL = (() => {
      try {
        const canvas = document.createElement('canvas');
        return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
      } catch {
        return false;
      }
    })();
    return hasCamera && hasWebGL && typeof WebAssembly === 'object';
  }

  prewarm(): void {
    this.runtime.prefetchTarget();
  }

  async start(): Promise<void> {
    const mindar = this.runtime.init();
    const anchor = this.runtime.anchor;

    anchor.onTargetFound = () => {
      this.runtime.setAnchorVisible(true);
      this.dispatch('anchor-found');
    };
    anchor.onTargetLost = () => {
      this.runtime.setAnchorVisible(false);
      this.dispatch('anchor-lost');
    };

    // El <video> se silencia ANTES de esperar a `start()`, y ese orden es
    // el arreglo entero: ver `silenceVideoChrome`. La cámara se pide con
    // más resolución por la misma rendija: ver `withSharperCamera`.
    const starting = this.withSharperCamera(() => mindar.start());
    const early = mindar.video as HTMLVideoElement | undefined;
    if (early !== undefined) this.silenceVideoChrome(early);

    try {
      await starting;
    } catch (error) {
      if (this.isPermissionError(error)) throw new CameraPermissionDeniedError();
      throw error;
    }

    // Otra vez con el stream ya puesto: barato, y deshace cualquier atributo
    // que MindAR haya reescrito por el camino (al llegar los metadatos
    // reescribe `width` y `height`).
    this.silenceVideoChrome(mindar.video);
    this.resumePlayback(mindar.video);
    this.tuneCamera(mindar.video);
    this.runtime.startLoop();
  }

  async stop(): Promise<void> {
    if (!this.runtime.isInitialized) return;
    this.runtime.setAnchorVisible(false);
    this.runtime.stopLoop();
    this.runtime.mindar.stop();
  }

  on(event: TrackingEvent, handler: () => void): Unsubscribe {
    const set = this.handlers.get(event) ?? new Set<() => void>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  confirmAnchor(): void {
    // No-op deliberado: en image tracking el anchor ya está atado al target.
    // Un ZapparTrackingAdapter implementaría aquí el "Place" real.
  }

  private dispatch(event: TrackingEvent): void {
    this.handlers.get(event)?.forEach((handler) => handler());
  }

  /**
   * Pide la cámara con más resolución de la que MindAR pediría.
   *
   * MindAR llama a `getUserMedia` con `{facingMode:'environment'}` y nada
   * más (three.js:109-125), y no expone ninguna forma de añadir nada. Sin
   * pedir tamaño, Safari en iOS entrega **640x480**, y de ahí sale el
   * `inputWidth` del detector, porque el Controller se construye con
   * `video.videoWidth` (three.js:146-147). El mapa es una ilustración
   * llena de detalle fino: a 640 px de ancho, el fotograma no conserva
   * rasgos suficientes y el emparejamiento tarda varios intentos en salir.
   *
   * Medido con `npm run bench-detection` sobre este mismo `.mind`, subiendo
   * solo el ancho del fotograma: 640 px → 7/12 fotogramas y 252 inliers;
   * 960 px → 9/12 y 321; 1280 px → 10/12 y 399. Detectar a la primera es
   * lo que se nota como "reconoce rápido", así que se pide 1280x720.
   *
   * Por qué un parche temporal a `getUserMedia` y no `applyConstraints`
   * después: para cuando el stream existe, MindAR ya creó el Controller
   * con el tamaño viejo, y cambiar la resolución entonces descuadra la
   * proyección. Hay que llegar antes de la llamada, no después.
   *
   * El parche dura lo que dura el tramo SÍNCRONO de `mindar.start()`, que
   * es justo donde `_startVideo` llama a `getUserMedia`; al volver se
   * restaura el original pase lo que pase. `ideal` y no `exact` a
   * propósito: una cámara que no pueda dar 720p entrega lo que tenga en
   * vez de fallar.
   */
  private withSharperCamera<T>(run: () => T): T {
    const media = navigator.mediaDevices;
    const original = media?.getUserMedia;
    if (media === undefined || original === undefined) return run();

    media.getUserMedia = (constraints?: MediaStreamConstraints) => {
      const video = constraints?.video;
      const enriched: MediaStreamConstraints =
        typeof video === 'object'
          ? { ...constraints, video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...video } }
          : (constraints ?? {});
      return original.call(media, enriched);
    };

    try {
      return run();
    } finally {
      media.getUserMedia = original;
    }
  }

  /**
   * Quita los mandos de reproducción del vídeo de la cámara.
   *
   * MindAR crea el `<video>` poniendo `muted` y `autoplay` como ATRIBUTOS
   * (three.js:92-96). Con `muted` no basta: el atributo solo alimenta
   * `defaultMuted`, y `defaultMuted` únicamente decide el estado del
   * elemento en el momento de CREARLO. Puesto después, como hace MindAR, la
   * propiedad `muted` se queda en `false` y el vídeo se reproduce sin
   * silenciar aunque el HTML diga lo contrario.
   *
   * Para Safari eso es un vídeo grande, sin silenciar y que arranca solo:
   * exactamente el caso para el que enseña sus mandos, y de ahí el botón de
   * pausa en mitad de la pantalla. El CSS no lo tapa —los mandos modernos de
   * iOS ya no atienden a los pseudoelementos `::-webkit-media-controls-*`—,
   * así que el arreglo tiene que llegar antes que el problema.
   *
   * **Por eso esto se llama ANTES de esperar a `mindar.start()`.** MindAR
   * crea el elemento y lo mete en el DOM nada más entrar en `_startVideo`, y
   * solo DESPUÉS pide la cámara; entre esas dos cosas hay un hueco asíncrono
   * —el permiso, el hardware— y ahí es donde el vídeo todavía no se está
   * reproduciendo. Silenciarlo al terminar `start()` llega tarde: para
   * entonces ya empezó a sonar sin silenciar y Safari ya le enganchó los
   * mandos, que no suelta por mucho que se le ponga `muted` después.
   */
  private silenceVideoChrome(video: HTMLVideoElement): void {
    video.muted = true;
    video.defaultMuted = true;
    video.controls = false;
    video.removeAttribute('controls');
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.disablePictureInPicture = true;
    video.setAttribute('disableRemotePlayback', '');
    // Solo lo entiende Chrome; en Safari es un atributo desconocido y ya.
    video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate');
  }

  /**
   * Arranca la reproducción a mano.
   *
   * El `autoplay` del atributo pudo quedarse bloqueado si el navegador
   * evaluó el vídeo antes de que contara como silenciado. Con el stream ya
   * puesto y el elemento en silencio, este `play()` sí sale adelante.
   */
  private resumePlayback(video: HTMLVideoElement): void {
    void video.play().catch(() => {
      // Si el navegador se niega, el fotograma congelado ya se ve igual.
    });
  }

  /**
   * Enfoque y exposición continuos, SI el navegador los expone.
   *
   * MindAR pide la cámara con `{facingMode:'environment'}` y nada más, así
   * que hereda lo que decida el navegador. Leyendo un mapa a poca
   * distancia eso se nota: con un reflejo encima, el autoenfoque de
   * disparo único suele quedarse clavado en el brillo especular y deja el
   * dibujo borroso, que es justo cuando el detector se queda sin rasgos
   * que emparejar. Pedir modo continuo hace que la cámara se recupere sola
   * en cuanto el reflejo se mueve.
   *
   * Todo esto es best-effort a propósito:
   *  - Solo se piden las capacidades que el propio track declara soportar.
   *  - `focusMode`/`exposureMode` vienen de la spec de Image Capture, que
   *    Chrome en Android implementa y Safari en iOS no. Donde no existan,
   *    esto no hace nada — no es un fallback, es una mejora si toca.
   *  - Cualquier error se traga: la sesión de AR ya está en marcha y no se
   *    va a tirar abajo por no haber podido pedir un modo de enfoque.
   */
  private tuneCamera(video: HTMLVideoElement): void {
    const stream = video.srcObject;
    if (!(stream instanceof MediaStream)) return;

    const track = stream.getVideoTracks()[0];
    if (track === undefined || typeof track.getCapabilities !== 'function') return;

    // Estas dos no están en los tipos del DOM: pertenecen a Image Capture,
    // que TypeScript no incluye en lib.dom. Se declaran aquí, acotadas.
    type ContinuousCapabilities = { focusMode?: string[]; exposureMode?: string[] };
    type ContinuousConstraints = { focusMode?: string; exposureMode?: string };

    let capabilities: ContinuousCapabilities;
    try {
      capabilities = track.getCapabilities() as ContinuousCapabilities;
    } catch {
      return;
    }

    const advanced: ContinuousConstraints[] = [];
    if (capabilities.focusMode?.includes('continuous') === true) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (capabilities.exposureMode?.includes('continuous') === true) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (advanced.length === 0) return;

    void track
      .applyConstraints({ advanced } as MediaTrackConstraints)
      .catch((error: unknown) => {
        console.info('[MindArTrackingAdapter] Cámara sin ajuste continuo', error);
      });
  }

  private isPermissionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // Safari y Chrome usan nombres distintos para lo mismo.
    return (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError' ||
      error.name === 'SecurityError'
    );
  }
}
