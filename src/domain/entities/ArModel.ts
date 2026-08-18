import { ModelId } from '../value-objects/ModelId';
import { ModelSource } from '../value-objects/ModelSource';
import { Scale } from '../value-objects/Scale';
import { SoundProfile, type SoundSnapshot } from '../value-objects/SoundProfile';

export interface ArModelSnapshot {
  readonly id: string;
  readonly name: string;
  readonly source: ModelSource;
  readonly sound: SoundSnapshot;
  readonly defaultScale?: number;
}

export class ArModel {
  private constructor(
    readonly id: ModelId,
    readonly name: string,
    readonly source: ModelSource,
    readonly sound: SoundProfile,
    readonly defaultScale: Scale,
  ) {
    Object.freeze(this);
  }

  static fromSnapshot(snapshot: ArModelSnapshot): ArModel {
    const name = snapshot.name.trim();
    if (name.length === 0) {
      throw new RangeError('ArModel requiere un nombre no vacío');
    }
    return new ArModel(
      ModelId.of(snapshot.id),
      name,
      snapshot.source,
      SoundProfile.of(snapshot.sound),
      Scale.of(snapshot.defaultScale ?? 1),
    );
  }
}
