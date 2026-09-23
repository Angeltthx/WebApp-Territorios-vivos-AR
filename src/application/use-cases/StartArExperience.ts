import { ArSession } from '@domain/entities/ArSession';
import type { ArModel } from '@domain/entities/ArModel';
import { Placement } from '@domain/entities/Placement';
import { ModelId } from '@domain/value-objects/ModelId';
import type { Stabilization } from '@domain/value-objects/Stabilization';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { AudioPort } from '../ports/AudioPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import { CameraPermissionDeniedError, type TrackingPort, type Unsubscribe } from '../ports/TrackingPort';

export type SessionListener = (session: ArSession) => void;

/** El catálogo llegó vacío. Se distingue para dar un mensaje concreto. */
class EmptyCatalogError extends Error {}

/** Lo que deja lista `prepare`: el catálogo entero y con cuál se empieza. */
export interface PreparedScene {
  readonly catalog: readonly ArModel[];
  readonly initial: ArModel;
}

/**
 * Orquesta el arranque completo. No sabe qué es MindAR, ni Three.js,
 * ni el DOM. Solo habla con puertos, por lo que es testeable sin navegador.
 */
export class StartArExperience {
  private session = ArSession.idle();
  private subscriptions: Unsubscribe[] = [];
  /** La descarga de modelos en curso, para no lanzarla dos veces. */
  private preparation: Promise<PreparedScene> | null = null;
  private starting: Promise<ArSession> | null = null;
  private stopping: Promise<void> | null = null;
  private generation = 0;

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

  /**
   * Baja y monta los modelos, SIN tocar la camara.
   *
   * Se lanza en cuanto se abre la pagina, mientras se ve la pantalla de
   * bienvenida: son 3,3 MB de .glb y esperar a que termine el saludo para
   * empezar a pedirlos regala varios segundos de pantalla en blanco. Cuando
   * `execute` llega, casi siempre esto ya esta hecho.
   *
   * Es idempotente: llamarlo dos veces devuelve la misma promesa.
   */
  prepare(initialModelId: string): Promise<PreparedScene> {
    if (this.preparation !== null) return this.preparation;

    this.preparation = this.loadScene(initialModelId).catch((error: unknown) => {
      // Si falla, se olvida: asi el boton de reintentar puede volver a
      // intentarlo en vez de heredar para siempre una promesa rechazada.
      this.preparation = null;
      throw error;
    });
    return this.preparation;
  }

  private async loadScene(initialModelId: string): Promise<PreparedScene> {
    // Que el motor vaya bajando lo suyo mientras se lee la bienvenida. No
    // se espera: es una mejora de tiempos, no un requisito para arrancar.
    this.tracking.prewarm();

    this.emit(this.session.preparing());

    const catalog = await this.models.findAll();
    if (catalog.length === 0) {
      throw new EmptyCatalogError();
    }

    const requested = ModelId.of(initialModelId);
    const initial = catalog.find((model) => model.id.equals(requested)) ?? catalog[0]!;

    await this.scene.preload(catalog);
    this.scene.setHighlightedModel(initial.id);
    this.scene.setStabilization(this.session.stabilization);

    return { catalog, initial };
  }

  execute(initialModelId: string): Promise<ArSession> {
    // Empieza dentro del clic, incluso al reintentar o usar teclado en iOS.
    void this.audio.unlock().catch(() => {});
    if (this.stopping !== null) return this.stopping.then(() => this.execute(initialModelId));
    if (this.starting !== null) return this.starting;
    if (this.session.hasStarted) return Promise.resolve(this.session);
    this.starting = this.start(initialModelId, this.generation).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(initialModelId: string, generation: number): Promise<ArSession> {
    // `canStart` no vale como guarda: tras `prepare` la sesion ya esta en
    // 'preparing'. Lo que hay que impedir es arrancar dos veces la camara.
    if (this.session.hasStarted) return this.session;

    try {
      const supported = await this.tracking.isSupported();
      if (generation !== this.generation) return ArSession.idle();
      if (!supported) {
        return this.emit(
          this.session.failed(
            'unsupported-device',
            'Este navegador no soporta la experiencia AR. En iPhone usa Safari; en Android, Chrome.',
          ),
        );
      }

      const { initial } = await this.prepare(initialModelId);
      if (generation !== this.generation) return ArSession.idle();

      const placement = Placement.initial(initial.id, initial.defaultScale);
      this.scene.applyPlacement(placement);
      this.emit(this.session.searching(placement));

      this.subscriptions.push(
        this.tracking.on('anchor-found', () => this.emit(this.session.tracking())),
        this.tracking.on('anchor-lost', () => this.emit(this.session.lost())),
      );

      await this.tracking.start();
      if (generation !== this.generation) return ArSession.idle();
      this.analytics.track('ar_session_started', { modelId: initial.id.value });

      return this.session;
    } catch (error) {
      this.unsubscribe();
      await this.tracking.stop().catch(() => {});
      if (generation !== this.generation) return ArSession.idle();
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

  stop(): Promise<void> {
    if (this.stopping !== null) return this.stopping;
    this.generation += 1;
    this.stopping = this.finishStop().finally(() => { this.stopping = null; });
    return this.stopping;
  }

  private unsubscribe(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
  }

  private async finishStop(): Promise<void> {
    this.unsubscribe();
    await this.starting;
    await this.preparation?.catch(() => {});
    this.unsubscribe();
    await this.tracking.stop().catch(() => {});
    this.scene.clear();
    this.preparation = null;
    this.audio.dispose();
    this.emit(ArSession.idle());
  }

  private toFailure(error: unknown): ArSession {
    if (error instanceof EmptyCatalogError) {
      this.analytics.track('ar_session_failed', { code: 'model-not-found' });
      return this.session.failed('model-not-found', 'El catálogo está vacío');
    }
    if (error instanceof CameraPermissionDeniedError) {
      this.analytics.track('ar_session_failed', { code: 'camera-denied' });
      return this.session.failed(
        'camera-denied',
        'Sin acceso a la cámara. Actívalo en los ajustes del navegador y pulsa Reintentar.',
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
