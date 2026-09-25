import { ModelId } from '@domain/value-objects/ModelId';
import type { ModelRepository } from '../ports/ModelRepository';
import type { AnimalSoundscape } from './AnimalSoundscape';

/**
 * El chapuzón de la ballena o de la tortuga, en el mismo fotograma en que
 * se ve el salpicón. La escena dice CUÁNDO (solo ella conoce el fotograma
 * de la animación); qué suena lo dice el catálogo.
 */
export class PlaySplashSound {
  constructor(
    private readonly sounds: AnimalSoundscape,
    private readonly models: ModelRepository,
  ) {}

  async execute(rawModelId: string, strength: number): Promise<void> {
    const model = await this.models.findById(ModelId.of(rawModelId));
    if (model === null) return;
    this.sounds.splashed(model, strength);
  }
}
