import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * La cámara se ha acercado a un animal.
 *
 * Quien lo DETECTA es el adaptador de escena, porque la medida es
 * geométrica y solo él tiene las matrices. Lo que decide aquí es qué
 * significa acercarse: **descubrir** al animal —desbloquearlo para el resto
 * de la sesión—, ponerlo en primer plano y hacerlo sonar.
 *
 * Acercarse a uno ya descubierto vuelve a abrir su primer plano; para eso
 * está la histéresis de `Proximity`, que obliga a alejarse antes de que
 * vuelva a contar como una aproximación nueva. Sin ella, quedarse quieto
 * cerca de un animal reabriría la ficha sin parar.
 *
 * EL PRIMER PLANO ESTÁ BLOQUEADO. Con un animal en primer plano, acercarse
 * a otro no le quita el sitio: con la ballena abierta, pasar la cámara por
 * encima del cangrejo cambiaba de animal a mitad de la ficha y rompía la
 * experiencia. Lo único que cierra un primer plano es la X. Mientras tanto
 * se recuerda a qué animal está cerca la cámara, y al cerrar (`resume`) se
 * descubre ese si es OTRO: si ya estás junto al cangrejo, no hace falta
 * alejarse y volver. El que se acaba de cerrar no se reabre solo.
 */
export class DiscoverNearbyModel {
  /** El animal junto al que está la cámara ahora mismo, aunque esté bloqueado. */
  private nearby: string | null = null;

  constructor(
    private readonly scene: ScenePort,
    private readonly models: ModelRepository,
    private readonly sounds: AnimalSoundscape,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly update: (session: ArSession) => void,
  ) {}

  execute(rawModelId: string | null): void {
    this.nearby = rawModelId;
    // Alejarse no cierra nada: lo descubierto sigue descubierto y la ficha
    // solo se cierra con la X. Que el animal salga del alcance no es una
    // orden del usuario.
    if (rawModelId === null) return;

    const session = this.getSession();
    const id = ModelId.of(rawModelId);
    const focused = session.discovery.focused;
    if (focused !== null && !focused.equals(id)) return;

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

  /** Tras cerrar un primer plano: si la cámara ya está junto a OTRO animal, ahora sí cuenta. */
  resume(closed: ModelId): void {
    if (this.nearby !== null && this.nearby !== closed.value) this.execute(this.nearby);
  }
}
