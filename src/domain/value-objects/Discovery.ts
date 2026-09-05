import type { ModelId } from './ModelId';

/**
 * Qué animales ha encontrado ya el usuario, y cuál está mirando de cerca.
 *
 * Son dos ideas distintas y conviene no confundirlas:
 *
 *  - DESBLOQUEADO es para siempre. Acercarse a un animal lo saca de su
 *    contorno punteado y ya se queda sobre el mapa el resto de la sesión,
 *    aunque te alejes. Es el progreso: lo que el usuario ha descubierto.
 *  - ENFOCADO es momentáneo. Es el animal que se está mirando en grande,
 *    con su nombre y su ficha. Se cierra con la X y no se pierde nada.
 *
 * Vive en el dominio porque "lo que ya encontraste no se vuelve a esconder"
 * es una regla de la experiencia, no un detalle de cómo se pinta.
 */
export class Discovery {
  private constructor(
    private readonly unlockedIds: ReadonlySet<string>,
    /** El animal que se está mirando de cerca, o null. */
    readonly focused: ModelId | null,
  ) {
    Object.freeze(this);
  }

  static empty(): Discovery {
    return new Discovery(new Set(), null);
  }

  isUnlocked(id: ModelId): boolean {
    return this.unlockedIds.has(id.value);
  }

  /** ¿Ha encontrado ya alguno? Decide si sigue haciendo falta la instrucción. */
  get hasAny(): boolean {
    return this.unlockedIds.size > 0;
  }

  get unlockedCount(): number {
    return this.unlockedIds.size;
  }

  /**
   * Descubre un animal: lo desbloquea Y lo pone en primer plano.
   *
   * Las dos cosas van juntas a propósito. Encontrar algo y que no pase nada
   * no es un hallazgo; el enfoque es la recompensa por haberse acercado.
   */
  unlock(id: ModelId): Discovery {
    const next = new Set(this.unlockedIds);
    next.add(id.value);
    return new Discovery(next, id);
  }

  /** Abre o cierra el primer plano SIN tocar lo ya desbloqueado. */
  focus(id: ModelId | null): Discovery {
    if (this.sameFocus(id)) return this;
    return new Discovery(this.unlockedIds, id);
  }

  private sameFocus(id: ModelId | null): boolean {
    if (this.focused === null) return id === null;
    return id !== null && this.focused.equals(id);
  }
}
