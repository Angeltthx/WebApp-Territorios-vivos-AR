/**
 * Punto de interés sobre la imagen del marcador, en coordenadas
 * normalizadas 0–1 con origen en la ESQUINA SUPERIOR IZQUIERDA.
 *
 * Ese es el sistema en el que uno mide sobre el archivo de imagen (y el
 * que usa scripts/preview-spots.mjs para dibujar la verificación), así
 * que es el que se declara en el catálogo.
 *
 * Traducir esto a coordenadas del anchor 3D es trabajo de infraestructura:
 * depende de la convención de MindAR, no de una regla de negocio.
 */
export class MarkerSpot {
  private constructor(
    readonly u: number,
    readonly v: number,
  ) {
    Object.freeze(this);
  }

  static of(u: number, v: number): MarkerSpot {
    if (!isUnitRange(u) || !isUnitRange(v)) {
      throw new RangeError(
        `MarkerSpot fuera de la imagen: (${u}, ${v}). Ambos valores deben estar entre 0 y 1.`,
      );
    }
    return new MarkerSpot(u, v);
  }
}

function isUnitRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
