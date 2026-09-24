import { IconPose, type IconView } from '../value-objects/IconPose';
import { MarkerSpot } from '../value-objects/MarkerSpot';
import { ModelId } from '../value-objects/ModelId';
import { ModelSource } from '../value-objects/ModelSource';
import { Scale } from '../value-objects/Scale';
import { SoundProfile, type SoundSnapshot } from '../value-objects/SoundProfile';
import { Soundscape, type SoundscapeSnapshot } from '../value-objects/Soundscape';
import {
  AnimationSequence,
  type AnimationSequenceSnapshot,
} from '../value-objects/AnimationSequence';

export interface ArModelSnapshot {
  readonly id: string;
  readonly name: string;
  /**
   * Ficha que se lee en el primer plano, bajo el modelo: un párrafo o
   * varios. Con varios se muestran todos, uno debajo de otro.
   */
  readonly description: string | readonly string[];
  /** Nombre científico y nombre común, bajo el título de la ficha. */
  readonly species?: string;
  readonly source: ModelSource;
  /** Timbre sintetizado: respaldo si el animal no tiene `soundscape`. */
  readonly sound: SoundSnapshot;
  /** Grabaciones reales: su voz, lo que suena al tocarlo y dónde vive. */
  readonly soundscape?: SoundscapeSnapshot;
  /** Clips del GLB y cuántas vueltas da cada uno antes de pasar al siguiente. */
  readonly animation?: AnimationSequenceSnapshot;
  /** Dónde vive este modelo sobre la imagen del marcador (u, v en 0–1). */
  readonly spot: { readonly u: number; readonly v: number };
  /**
   * Contorno CALCADO DEL DIBUJO, en las mismas coordenadas que `spot`.
   *
   * Opcional: sin él, el contorno punteado se deduce de la silueta del .glb,
   * que es lo que hacen tres de los cuatro. Se pone cuando el dibujo está en
   * una pose que ninguna proyección del modelo reproduce.
   */
  readonly outlineShape?: readonly { readonly u: number; readonly v: number }[];
  /** Desde qué cara se mira el icono. Por defecto 'front' (de frente). */
  readonly view?: IconView;
  /** Tamaño del icono respecto al base. Por defecto 1. */
  readonly iconSize?: number;
  /** Hacia dónde mira, en grados sobre su eje vertical. Por defecto 0. */
  readonly facing?: number;
  /** Tamaño en primer plano respecto a lo que cabe en pantalla (≤ 1). Por defecto 1. */
  readonly focusSize?: number;
  /**
   * Desde qué cara se calca el CONTORNO punteado. Por defecto, la misma
   * desde la que se mira el icono; se separa porque el dibujo del mapa y el
   * modelo 3D no tienen por qué estar vistos desde el mismo sitio.
   */
  readonly outlineView?: IconView;
  /** Giro del contorno para cuadrarlo con el dibujo, en grados. */
  readonly outlineSpin?: number;
  /**
   * Si el contorno va espejado: el dibujo del mapa mira hacia el otro lado
   * que el modelo. Por defecto no.
   */
  readonly outlineMirror?: boolean;
  readonly defaultScale?: number;
}

export class ArModel {
  private constructor(
    readonly id: ModelId,
    readonly name: string,
    /** Párrafos de la ficha, en orden. Al menos uno. */
    readonly paragraphs: readonly string[],
    readonly species: string | null,
    readonly source: ModelSource,
    readonly sound: SoundProfile,
    readonly soundscape: Soundscape | null,
    readonly animation: AnimationSequence | null,
    readonly spot: MarkerSpot,
    /** Vacío si el contorno se deduce del modelo. */
    readonly outlineShape: readonly MarkerSpot[],
    readonly pose: IconPose,
    readonly defaultScale: Scale,
  ) {
    Object.freeze(this);
  }

  static fromSnapshot(snapshot: ArModelSnapshot): ArModel {
    const name = snapshot.name.trim();
    if (name.length === 0) {
      throw new RangeError('ArModel requiere un nombre no vacío');
    }
    const view = snapshot.view ?? 'front';
    const paragraphs = (typeof snapshot.description === 'string' ? [snapshot.description] : snapshot.description)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);
    if (paragraphs.length === 0) {
      throw new RangeError(`"${name}" necesita al menos un párrafo de descripción`);
    }
    const species = snapshot.species?.trim() || null;
    return new ArModel(
      ModelId.of(snapshot.id),
      name,
      Object.freeze(paragraphs),
      species,
      snapshot.source,
      SoundProfile.of(snapshot.sound),
      snapshot.soundscape === undefined ? null : Soundscape.of(snapshot.soundscape),
      snapshot.animation === undefined ? null : AnimationSequence.of(snapshot.animation),
      MarkerSpot.of(snapshot.spot.u, snapshot.spot.v),
      (snapshot.outlineShape ?? []).map((point) => MarkerSpot.of(point.u, point.v)),
      IconPose.of(
        view,
        snapshot.iconSize ?? 1,
        snapshot.facing ?? 0,
        snapshot.outlineView ?? view,
        snapshot.outlineSpin ?? 0,
        snapshot.outlineMirror ?? false,
        snapshot.focusSize ?? 1,
      ),
      Scale.of(snapshot.defaultScale ?? 1),
    );
  }
}
