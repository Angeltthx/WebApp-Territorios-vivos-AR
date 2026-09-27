import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';

/**
 * Un toque sobre un animal. Qué hace depende de dónde esté:
 *
 *   - SOBRE EL MAPA lo abre en primer plano (`open`, que es DiscoverModel),
 *     esté todavía dormido tras su contorno dorado o ya despierto.
 *   - EN PRIMER PLANO lanza su gesto (el salto, el canto, el correteo). Solo
 *     responde el que está delante.
 *
 * Hubo una versión con DOBLE toque: uno despertaba al animal y lo hacía
 * moverse, dos lo abrían. Se quitó: nadie espera un doble toque en una
 * web, y el tutorial tenía que gastar un paso entero en enseñarlo. El
 * gesto sigue a un toque de distancia, dentro del primer plano.
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
    private readonly open: (modelId: string) => void,
    /** Avisa (al tutorial) de que tocó al animal en primer plano. */
    private readonly gestured: () => void = () => {},
  ) {}

  async execute(rawModelId: string): Promise<void> {
    const session = this.getSession();
    const id = ModelId.of(rawModelId);
    const focused = session.discovery.focused;
    // Sobre el mapa: abrirlo. Con un texto abierto o sin el mapa a la
    // vista, DiscoverModel no hace nada.
    if (focused === null) {
      this.open(rawModelId);
      return;
    }
    // En primer plano solo cuenta el que está delante.
    if (!focused.equals(id)) return;

    const model = await this.models.findById(id);
    if (model === null) return;
    if (!this.scene.pulse(model.id)) return;
    this.gestured();
    this.analytics.track('model_tapped', { modelId: model.id.value });
  }
}
