import { MarkerSpot } from '../value-objects/MarkerSpot';
import { ModelId } from '../value-objects/ModelId';
import { ModelSource } from '../value-objects/ModelSource';
import { Scale } from '../value-objects/Scale';
import { SoundProfile, type SoundSnapshot } from '../value-objects/SoundProfile';

export interface ArModelSnapshot {
  readonly id: string;
  readonly name: string;
  readonly source: ModelSource;
  readonly sound: SoundSnapshot;
  /** Dónde vive este modelo sobre la imagen del marcador (u, v en 0–1). */
  readonly spot: { readonly u: number; readonly v: number };
  readonly defaultScale?: number;
}

export class ArModel {
  private constructor(
    readonly id: ModelId,
    readonly name: string,
    readonly source: ModelSource,
    readonly sound: SoundProfile,
    readonly spot: MarkerSpot,
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
      MarkerSpot.of(snapshot.spot.u, snapshot.spot.v),
      Scale.of(snapshot.defaultScale ?? 1),
    );
  }
}
