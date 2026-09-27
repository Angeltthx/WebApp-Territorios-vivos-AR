import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';

/**
 * UN toque sobre un animal: su gesto (el salto, el canto, el correteo).
 *
 *   - SOBRE EL MAPA, si todavía es un contorno dorado, primero lo despierta
 *     (`Discovery.reveal`: sale con su humo y se queda para siempre) y
 *     enseguida hace su gesto. Abrirlo es otra cosa: el DOBLE toque
 *     (DiscoverModel). Hubo una versión en la que un toque ya abría la
 *     ficha, y se perdía algo que gustaba: tocar un animal y verlo moverse.
 *   - EN PRIMER PLANO, solo responde el que está delante.
 *
 * `tapped` avisa al tutorial de que tocó un animal del mapa.
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
    private readonly update: (session: ArSession) => void,
    private readonly tapped: (modelId: string) => void = () => {},
  ) {}

  async execute(rawModelId: string): Promise<void> {
    const session = this.getSession();
    const id = ModelId.of(rawModelId);
    const focused = session.discovery.focused;
    if (focused !== null) {
      // En primer plano solo cuenta el que está delante.
      if (!focused.equals(id)) return;
    } else {
      // Sobre el mapa: con un texto abierto o sin el mapa a la vista, nada.
      if (session.discovery.reading !== null || !session.isInteractive) return;
      if (!session.discovery.isUnlocked(id)) {
        const discovery = session.discovery.reveal(id);
        this.scene.applyDiscovery(discovery);
        this.update(session.withDiscovery(discovery));
      }
      this.tapped(rawModelId);
    }

    const model = await this.models.findById(id);
    if (model === null) return;
    if (!this.scene.pulse(model.id)) return;
    this.analytics.track('model_tapped', { modelId: model.id.value });
  }
}
