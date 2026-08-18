import type { ArSession } from '@domain/entities/ArSession';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { AudioPort } from '../ports/AudioPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';

/**
 * Toque sobre el objeto: suena y da realimentación visual.
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

  async execute(): Promise<void> {
    const session = this.getSession();
    if (!session.isInteractive) return;

    const modelId = session.activeModelId;
    if (modelId === null) return;

    const model = await this.models.findById(modelId);
    if (model === null) return;

    this.audio.play(model.sound);
    this.scene.pulse();
    this.analytics.track('model_tapped', { modelId: modelId.value });
  }
}
