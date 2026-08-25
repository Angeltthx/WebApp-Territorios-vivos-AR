import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { AudioPort } from '../ports/AudioPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';

/**
 * Toque sobre un icono: suena y da realimentación visual sobre ESE icono.
 * El sonido lo define el dominio (SoundProfile); aquí solo se dispara.
 */
export class PlayModelSound {
  constructor(
    private readonly audio: AudioPort,
    private readonly scene: ScenePort,
    private readonly models: ModelRepository,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
  ) {}

  async execute(rawModelId: string): Promise<void> {
    const session = this.getSession();
    if (!session.isInteractive) return;

    const model = await this.models.findById(ModelId.of(rawModelId));
    if (model === null) return;

    this.audio.play(model.sound);
    this.scene.pulse(model.id);
    this.analytics.track('model_tapped', { modelId: model.id.value });
  }
}
