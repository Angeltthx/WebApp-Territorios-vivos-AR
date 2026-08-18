import { ArSession } from '@domain/entities/ArSession';
import { Placement } from '@domain/entities/Placement';
import { ModelId } from '@domain/value-objects/ModelId';
import type { Stabilization } from '@domain/value-objects/Stabilization';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { AudioPort } from '../ports/AudioPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import { CameraPermissionDeniedError, type TrackingPort, type Unsubscribe } from '../ports/TrackingPort';

export type SessionListener = (session: ArSession) => void;

/**
 * Orquesta el arranque completo. No sabe qué es MindAR, ni Three.js,
 * ni el DOM. Solo habla con puertos, por lo que es testeable sin navegador.
 */
export class StartArExperience {
  private session = ArSession.idle();
  private subscriptions: Unsubscribe[] = [];

  constructor(
    private readonly tracking: TrackingPort,
    private readonly scene: ScenePort,
    private readonly audio: AudioPort,
    private readonly models: ModelRepository,
    private readonly analytics: AnalyticsPort,
    private readonly onSessionChange: SessionListener,
  ) {}

  get current(): ArSession {
    return this.session;
  }

  async execute(initialModelId: string): Promise<ArSession> {
    if (!this.session.canStart) return this.session;

    try {
      if (!(await this.tracking.isSupported())) {
        return this.emit(
          this.session.failed(
            'unsupported-device',
            'Este navegador no soporta la experiencia AR. En iPhone usa Safari; en Android, Chrome.',
          ),
        );
      }

      this.emit(this.session.preparing());

      // Debe ocurrir dentro del gesto del usuario que disparó execute(),
      // o iOS deja el AudioContext suspendido para siempre.
      await this.audio.unlock();

      const catalog = await this.models.findAll();
      if (catalog.length === 0) {
        return this.emit(this.session.failed('model-not-found', 'El catálogo está vacío'));
      }

      const requested = ModelId.of(initialModelId);
      const initial = catalog.find((model) => model.id.equals(requested)) ?? catalog[0]!;

      await this.scene.preload(catalog);
      this.scene.setActiveModel(initial.id);
      this.scene.setStabilization(this.session.stabilization);

      const placement = Placement.initial(initial.id, initial.defaultScale);
      this.scene.applyPlacement(placement);
      this.emit(this.session.searching(placement));

      this.subscriptions.push(
        this.tracking.on('anchor-found', () => this.emit(this.session.tracking())),
        this.tracking.on('anchor-lost', () => this.emit(this.session.lost())),
      );

      await this.tracking.start();
      this.analytics.track('ar_session_started', { modelId: initial.id.value });

      return this.session;
    } catch (error) {
      return this.emit(this.toFailure(error));
    }
  }

  applyStabilization(stabilization: Stabilization): ArSession {
    this.scene.setStabilization(stabilization);
    this.analytics.track('stabilization_changed', { level: stabilization.level });
    return this.emit(this.session.withStabilization(stabilization));
  }

  update(session: ArSession): void {
    this.emit(session);
  }

  async stop(): Promise<void> {
    if (!this.session.hasStarted) return;
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
    await this.tracking.stop();
    this.scene.clear();
    this.audio.dispose();
    this.emit(ArSession.idle());
  }

  private toFailure(error: unknown): ArSession {
    if (error instanceof CameraPermissionDeniedError) {
      this.analytics.track('ar_session_failed', { code: 'camera-denied' });
      return this.session.failed(
        'camera-denied',
        'Sin acceso a la cámara. Actívalo en los ajustes del navegador y recarga la página.',
      );
    }
    const message = error instanceof Error ? error.message : 'Error desconocido';
    this.analytics.track('ar_session_failed', { code: 'unknown', message });
    return this.session.failed('unknown', message);
  }

  private emit(next: ArSession): ArSession {
    this.session = next;
    this.onSessionChange(next);
    return next;
  }
}
