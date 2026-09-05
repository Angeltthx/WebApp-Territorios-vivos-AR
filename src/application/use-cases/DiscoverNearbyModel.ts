import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ScenePort } from '../ports/ScenePort';

/**
 * La cámara se ha acercado a un animal.
 *
 * Quien lo DETECTA es el adaptador de escena, porque la medida es
 * geométrica y solo él tiene las matrices. Lo que decide aquí es qué
 * significa acercarse: **descubrir** al animal —desbloquearlo para el resto
 * de la sesión— y ponerlo en primer plano.
 *
 * Acercarse a uno ya descubierto vuelve a abrir su primer plano; para eso
 * está la histéresis de `Proximity`, que obliga a alejarse antes de que
 * vuelva a contar como una aproximación nueva. Sin ella, quedarse quieto
 * cerca de un animal reabriría la ficha sin parar.
 */
export class DiscoverNearbyModel {
  constructor(
    private readonly scene: ScenePort,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly update: (session: ArSession) => void,
  ) {}

  execute(rawModelId: string | null): void {
    // Alejarse no cierra nada: lo descubierto sigue descubierto y la ficha
    // solo se cierra con la X. Que el animal salga del alcance no es una
    // orden del usuario.
    if (rawModelId === null) return;

    const session = this.getSession();
    const id = ModelId.of(rawModelId);
    const already = session.discovery.isUnlocked(id);

    const discovery = session.discovery.unlock(id);
    const updated = session.withDiscovery(discovery);
    if (updated === session) return;

    this.scene.applyDiscovery(discovery);
    this.update(updated);

    this.analytics.track(already ? 'model_refocused' : 'model_discovered', {
      modelId: id.value,
      total: discovery.unlockedCount,
    });
  }
}
