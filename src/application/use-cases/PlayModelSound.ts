import type { ArSession } from '@domain/entities/ArSession';
import { ModelId } from '@domain/value-objects/ModelId';
import type { AnalyticsPort } from '../ports/AnalyticsPort';
import type { ModelRepository } from '../ports/ModelRepository';
import type { ScenePort } from '../ports/ScenePort';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * Toque sobre un icono: suena y da realimentación visual sobre ESE icono.
 * El sonido lo define el dominio (SoundProfile); aquí solo se dispara.
 *
 * Desde que se quitó la barra de selección, el toque es la ÚNICA forma de
 * elegir un animal, así que además de sonar y dar el pulso deja el halo
 * encendido en el que se tocó. Sin eso no quedaría ninguna señal de cuál
 * fue el último.
 *
 * A propósito NO corta por "ya estaba seleccionado": tocar dos veces el
 * mismo animal tiene que sonar las dos veces.
 */
export class PlayModelSound {
  constructor(
    private readonly sounds: AnimalSoundscape,
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

    const model = await this.models.findById(ModelId.of(rawModelId));
    if (model === null) return;

    // Su grabación de toque (un soplido, un chapuzón…); sin grabaciones,
    // el timbre sintetizado de siempre.
    this.sounds.tapped(model);
    this.scene.setHighlightedModel(model.id);
    this.scene.pulse(model.id);
    this.analytics.track('model_tapped', { modelId: model.id.value });
  }
}
