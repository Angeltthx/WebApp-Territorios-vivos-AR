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
