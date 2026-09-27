import { ModelId } from '../value-objects/ModelId';
import { Scale } from '../value-objects/Scale';
import { Vector3 } from '../value-objects/Vector3';

/**
 * Cómo ha girado el usuario UN animal con el dedo: hacia los lados (`yaw`,
 * sobre su propio eje vertical) y hacia arriba o abajo (`pitch`, sobre el
 * eje horizontal de la pantalla).
 */
export interface Orientation {
  readonly yaw: number;
  readonly pitch: number;
}

const UPRIGHT: Orientation = Object.freeze({ yaw: 0, pitch: 0 });

/**
 * Cuánto se deja inclinar un animal hacia arriba o abajo: unos 70°. Más allá
 * queda patas arriba, y un arrastre vertical largo —el que se hace sin
 * querer al girarlo de lado— lo dejaría así sin forma fácil de volver.
 */
export const MAX_PITCH = 1.22;

/**
 * Ajuste global de la capa de iconos sobre el mapa, más cómo ha girado el
 * usuario cada animal.
 *
 * El giro es POR ANIMAL. Hubo un solo `rotationY` para los cuatro: arrastrar
 * la ballena giraba también la pava, el cangrejo y la tortuga, y el gesto
 * dejaba de ser "manipular este animal" para ser "girar el mapa entero".
 *
 * OJO: ni el giro ni `scale` mueven los iconos de su sitio. Cada icono
 * está clavado a su MarkerSpot; estos valores solo lo hacen girar sobre sí
 * mismo y cambiar de tamaño. Desplazar un icono de su animal sería
 * justamente el bug que hay que evitar.
 *
 * Inmutable: cada transformación devuelve una instancia nueva.
 */
export class Placement {
  private constructor(
    readonly modelId: ModelId,
    readonly offset: Vector3,
    readonly scale: Scale,
    private readonly orientations: ReadonlyMap<string, Orientation>,
  ) {
    Object.freeze(this);
  }

  static initial(modelId: ModelId, scale: Scale): Placement {
    return new Placement(modelId, Vector3.zero(), scale, new Map());
  }

  /** Cómo está girado un animal; sin tocar, de frente y derecho. */
  orientationOf(id: ModelId): Orientation {
    return this.orientations.get(id.value) ?? UPRIGHT;
  }

  scaledBy(factor: number): Placement {
    return new Placement(this.modelId, this.offset, this.scale.multipliedBy(factor), this.orientations);
  }

  /**
   * Gira UN animal. El giro lateral da vueltas completas; la inclinación se
   * topa en ±`MAX_PITCH`.
   */
  rotatedBy(id: ModelId, yawRadians: number, pitchRadians = 0): Placement {
    const TAU = Math.PI * 2;
    const current = this.orientationOf(id);
    const yaw = (((current.yaw + yawRadians) % TAU) + TAU) % TAU;
    const pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, current.pitch + pitchRadians));
    const orientations = new Map(this.orientations);
    orientations.set(id.value, Object.freeze({ yaw, pitch }));
    return new Placement(this.modelId, this.offset, this.scale, orientations);
  }

  movedTo(offset: Vector3): Placement {
    return new Placement(this.modelId, offset, this.scale, this.orientations);
  }
}
