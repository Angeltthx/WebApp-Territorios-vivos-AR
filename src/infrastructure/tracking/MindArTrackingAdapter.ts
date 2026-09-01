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

    try {
      await mindar.start();
    } catch (error) {
      if (this.isPermissionError(error)) throw new CameraPermissionDeniedError();
      throw error;
    }

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
