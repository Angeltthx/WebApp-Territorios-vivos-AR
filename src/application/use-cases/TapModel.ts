import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';

/**
 * Toque sobre un animal: lanza su gesto (el salto, el canto, el correteo).
 *
 * Aquí NO suena nada. Cada sonido suena en SU momento de la animación —la
 * pava canta al estirar el cuello, la ballena resopla al volver a
 * respirar—, y ese momento solo lo conoce la escena, que avisa y
 * PlayGestureSound lo hace sonar. Antes el sonido salía en el instante del
 * toque, y los clientes pidieron sincronizarlo con la animación.
 *
 * A mitad de un gesto, tocarlo otra vez no hace nada (la escena devuelve
 * false): ni lo reinicia ni suena.
 */
export class TapModel {
  constructor(
    private readonly scene: ScenePort,
    private readonly models: ModelRepository,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
  ) {}

  async execute(rawModelId: string): Promise<void> {
    const session = this.getSession();
    const id = ModelId.of(rawModelId);
    const focused = session.discovery.focused?.equals(id) === true;
    if ((!session.isInteractive && !focused) || !session.discovery.isUnlocked(id)) return;

    const model = await this.models.findById(id);
    if (model === null) return;
    if (!this.scene.pulse(model.id)) return;
    this.analytics.track('model_tapped', { modelId: model.id.value });
  }
}
