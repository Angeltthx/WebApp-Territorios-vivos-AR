/**
 * Value object inmutable. Deliberadamente NO usa THREE.Vector3:
 * el dominio no debe conocer la librería de render.
 */
export class Vector3 {
  private constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {
    Object.freeze(this);
  }

  static of(x: number, y: number, z: number): Vector3 {
    if (![x, y, z].every(Number.isFinite)) {
      throw new RangeError('Vector3 requiere componentes finitas');
    }
    return new Vector3(x, y, z);
  }

  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }

  equals(other: Vector3): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }
}
