export class ModelId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(value: string): ModelId {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new RangeError('ModelId no puede estar vacío');
    }
    return new ModelId(trimmed);
  }

  equals(other: ModelId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
