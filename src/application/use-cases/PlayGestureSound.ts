import { ModelId } from '@domain/value-objects/ModelId';
import type { ModelRepository } from '../ports/ModelRepository';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * Los sonidos de un gesto, cada uno en su fotograma: el del toque (las
 * patitas del cangrejo, el canto de la pava, el soplido de la ballena…) y
 * el chapuzón de quien cae al agua. La escena dice CUÁNDO —solo ella sabe
 * por dónde va la animación—; qué suena lo dice el catálogo.
 */
export class PlayGestureSound {
  constructor(
    private readonly sounds: AnimalSoundscape,
    private readonly models: ModelRepository,
  ) {}

  async tapped(rawModelId: string): Promise<void> {
    const model = await this.models.findById(ModelId.of(rawModelId));
    if (model !== null) this.sounds.tapped(model);
  }

  async splashed(rawModelId: string, strength: number): Promise<void> {
    const model = await this.models.findById(ModelId.of(rawModelId));
    if (model !== null) this.sounds.splashed(model, strength);
  }
}
