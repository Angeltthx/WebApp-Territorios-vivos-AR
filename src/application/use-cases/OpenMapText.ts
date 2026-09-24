import type { ArSession } from '@domain/entities/ArSession';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { MapTextRepository } from '../ports/MapTextRepository';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * El usuario ha tocado un texto del mapa: abrirlo en grande para leerlo.
 *
 * Solo cuando ya encontró a TODOS los animales: los destellos sobre los
 * textos son la recompensa de haber explorado el mapa entero, y antes de
 * eso competirían con los contornos de los animales por la atención. Con
 * algo ya abierto —un animal o otro texto— no hace nada: lo abierto no se
 * cambia por otra cosa, se cierra con la X (ver Discovery.isBusy).
 */
export class OpenMapText {
  constructor(
    private readonly scene: ScenePort,
    private readonly texts: MapTextRepository,
    private readonly models: ModelRepository,
    private readonly sounds: AnimalSoundscape,
    private readonly analytics: AnalyticsPort,
    private readonly getSession: () => ArSession,
    private readonly update: (session: ArSession) => void,
  ) {}

  async execute(textId: string): Promise<void> {
    const [text, catalog] = await Promise.all([this.texts.findById(textId), this.models.findAll()]);
    if (text === null) return;

    // Se relee la sesión DESPUÉS de esperar: pudo cambiar mientras tanto.
    const session = this.getSession();
    if (!session.isInteractive || !session.discovery.hasFoundAll(catalog.length)) return;
    const discovery = session.discovery.read(text.id);
    if (discovery === session.discovery) return;

    this.scene.applyDiscovery(discovery);
    this.update(session.withDiscovery(discovery));
    this.sounds.textOpened(text);
    this.analytics.track('map_text_opened', { textId: text.id });
  }
}
