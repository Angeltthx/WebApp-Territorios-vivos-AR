import type { ArSession } from '@domain/entities/ArSession';
import { Placement } from '@domain/entities/Placement';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { AudioPort } from '../ports/AudioPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import type { SessionListener } from './StartArExperience';

/**
 * Cambia el objeto visible. Como el catálogo completo se precargó en
 * scene.preload(), el cambio es instantáneo: no hay descarga en caliente.
 */
export class SwitchModel {
  constructor(
    private readonly scene: ScenePort,
    private readonly audio: AudioPort,
    private readonly models: ModelRepository,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly onSessionChange: SessionListener,
  ) {}

  async execute(rawModelId: string): Promise<void> {
    const session = this.getSession();
    const targetId = ModelId.of(rawModelId);

    if (session.activeModelId?.equals(targetId) === true) return;

    const model = await this.models.findById(targetId);
    if (model === null) return;

    this.scene.setActiveModel(model.id);

    // Conserva rotación y escala actuales: cambiar de objeto no debería
    // deshacer lo que el usuario ya ajustó a mano.
    const previous = session.placement;
    const placement =
      previous === null
        ? Placement.initial(model.id, model.defaultScale)
        : Placement.initial(model.id, previous.scale).rotatedBy(previous.rotationY);

    this.scene.applyPlacement(placement);
    this.audio.play(model.sound);
    this.analytics.track('model_switched', { modelId: model.id.value });
    this.onSessionChange(session.withPlacement(placement));
  }
}
