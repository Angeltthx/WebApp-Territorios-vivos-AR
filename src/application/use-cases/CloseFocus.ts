import type { ArSession } from '@domain/entities/ArSession';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ScenePort } from '../ports/ScenePort';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * Cerrar el primer plano de un animal.
 *
 * Cierra la ficha, apaga su sonido y devuelve el modelo a su sitio sobre el
 * mapa. NO lo vuelve a esconder: lo que se descubrió sigue descubierto, que
 * es justamente lo que hace que explorar el mapa avance en vez de repetirse.
 *
 * `afterClose` avisa de qué animal se cerró: mientras estuvo abierto, el
 * primer plano estaba bloqueado y acercarse a otro no contaba (ver
 * DiscoverNearbyModel.resume).
 */
export class CloseFocus {
  constructor(
    private readonly scene: ScenePort,
    private readonly sounds: AnimalSoundscape,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly update: (session: ArSession) => void,
    private readonly afterClose: (closed: ModelId) => void = () => {},
  ) {}

  execute(): void {
    const session = this.getSession();
    const closing = session.discovery.focused;
    if (closing === null) return;

    const discovery = session.discovery.focus(null);
    this.scene.applyDiscovery(discovery);
    this.update(session.withDiscovery(discovery));
    this.sounds.focusClosed();
    this.analytics.track('focus_closed', { modelId: closing.value });
    this.afterClose(closing);
  }
}
