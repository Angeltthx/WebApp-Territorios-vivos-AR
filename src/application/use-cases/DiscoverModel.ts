import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * El usuario ha TOCADO un animal del mapa: se abre en primer plano.
 *
 * Hubo una versión en la que se abría al ACERCAR el teléfono (con una
 * distancia y una histéresis que había que calibrar con el mapa impreso).
 * Se cambió al toque: acercarse era poco práctico —muy cerca, MindAR pierde
 * el mapa— y poco intuitivo, porque nadie espera que un gesto de cámara
 * abra nada; tocar lo que se ve, sí.
 *
 * Lo que decide aquí es qué significa tocarlo: **descubrirlo** —
 * desbloquearlo para el resto de la sesión—, ponerlo en primer plano y
 * hacerlo sonar. Tocar uno ya descubierto vuelve a abrir su ficha.
 *
 * EL PRIMER PLANO ESTÁ BLOQUEADO: con un animal abierto (o un texto), tocar
 * otro no le quita el sitio. Lo único que cierra es la X.
 */
export class DiscoverModel {
  constructor(
    private readonly scene: ScenePort,
    private readonly models: ModelRepository,
    private readonly sounds: AnimalSoundscape,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly update: (session: ArSession) => void,
  ) {}

  execute(rawModelId: string): void {
    const session = this.getSession();
    if (!session.isInteractive || session.discovery.isBusy) return;

    const id = ModelId.of(rawModelId);
    const already = session.discovery.isUnlocked(id);
    const discovery = session.discovery.unlock(id);
    const updated = session.withDiscovery(discovery);
    if (updated === session) return;

    this.scene.applyDiscovery(discovery);
    this.update(updated);
    void this.models.findById(id).then((model) => {
      if (model !== null && this.getSession().discovery.focused?.equals(id) === true) {
        this.sounds.focusOpened(model);
      }
    });
    this.analytics.track(already ? 'model_refocused' : 'model_discovered', {
      modelId: id.value,
      total: discovery.unlockedCount,
    });
  }
}
