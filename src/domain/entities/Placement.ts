import { ModelId } from '../value-objects/ModelId';
import { Scale } from '../value-objects/Scale';
import { Vector3 } from '../value-objects/Vector3';

/**
 * Ajuste global de la capa de iconos sobre el mapa, más cuál está
 * seleccionado.
 *
 * OJO con `rotationY` y `scale`: NO mueven los iconos de su sitio. Cada
 * icono está clavado a su MarkerSpot; estos valores solo lo hacen girar
 * sobre sí mismo y cambiar de tamaño. Desplazar un icono de su animal
 * sería justamente el bug que hay que evitar.
 *
 * Inmutable: cada transformación devuelve una instancia nueva.
 */
export class Placement {
  private constructor(
    readonly modelId: ModelId,
    readonly offset: Vector3,
    readonly rotationY: number,
    readonly scale: Scale,
  ) {
    Object.freeze(this);
  }

  static initial(modelId: ModelId, scale: Scale): Placement {
    return new Placement(modelId, Vector3.zero(), 0, scale);
  }

  scaledBy(factor: number): Placement {
    return new Placement(this.modelId, this.offset, this.rotationY, this.scale.multipliedBy(factor));
  }

  rotatedBy(radians: number): Placement {
    const TAU = Math.PI * 2;
    const next = (((this.rotationY + radians) % TAU) + TAU) % TAU;
    return new Placement(this.modelId, this.offset, next, this.scale);
  }

  movedTo(offset: Vector3): Placement {
    return new Placement(this.modelId, offset, this.rotationY, this.scale);
  }
}
