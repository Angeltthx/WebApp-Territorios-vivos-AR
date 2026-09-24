import type { ModelId } from './ModelId';

/**
 * Qué animales ha encontrado ya el usuario, y qué está mirando de cerca.
 *
 * Son dos ideas distintas y conviene no confundirlas:
 *
 *  - DESBLOQUEADO es para siempre. Acercarse a un animal lo saca de su
 *    contorno punteado y ya se queda sobre el mapa el resto de la sesión,
 *    aunque te alejes. Es el progreso: lo que el usuario ha descubierto.
 *  - ENFOCADO es momentáneo. Es el animal que se está mirando en grande,
 *    con su nombre y su ficha. Se cierra con la X y no se pierde nada.
 *
 * Y una tercera, que llega al final: LEYENDO. Cuando ya se encontraron
 * todos los animales, los textos del mapa se marcan con un punto y se
 * pueden tocar para leerlos en grande (ver `MapText`). Leer un texto ocupa
 * la pantalla igual que un animal enfocado, así que las dos cosas se
 * excluyen: mientras una está abierta la otra no puede abrirse (`isBusy`),
 * y la X cierra la que sea.
 *
 * Vive en el dominio porque "lo que ya encontraste no se vuelve a esconder"
 * y "lo que está abierto no te lo quita otra cosa" son reglas de la
 * experiencia, no detalles de cómo se pinta.
 */
export class Discovery {
  private constructor(
    private readonly unlockedIds: ReadonlySet<string>,
    /** El animal que se está mirando de cerca, o null. */
    readonly focused: ModelId | null,
    /** El texto del mapa que se está leyendo en grande, o null. */
    readonly reading: string | null,
  ) {
    Object.freeze(this);
  }

  static empty(): Discovery {
    return new Discovery(new Set(), null, null);
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
   * ¿Encontró ya a TODOS? Es lo que abre los textos del mapa: primero se
   * explora, y la lectura es la recompensa de haber explorado entero.
   */
  hasFoundAll(total: number): boolean {
    return total > 0 && this.unlockedIds.size >= total;
  }

  /** Hay algo abierto en grande —un animal o un texto— y no se le quita el sitio. */
  get isBusy(): boolean {
    return this.focused !== null || this.reading !== null;
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
    return new Discovery(next, id, null);
  }

  /** Abre o cierra el primer plano SIN tocar lo ya desbloqueado. Cerrar cierra también la lectura. */
  focus(id: ModelId | null): Discovery {
    if (id === null) {
      return this.focused === null && this.reading === null
        ? this
        : new Discovery(this.unlockedIds, null, null);
    }
    if (this.focused !== null && this.focused.equals(id) && this.reading === null) return this;
    return new Discovery(this.unlockedIds, id, null);
  }

  /**
   * Abre un texto para leerlo. Con otra cosa abierta, no hace nada. Que
   * ya se hayan encontrado todos los animales lo comprueba quien llama
   * (`hasFoundAll` necesita saber cuántos hay).
   */
  read(textId: string): Discovery {
    if (this.reading === textId || this.isBusy) return this;
    return new Discovery(this.unlockedIds, null, textId);
  }
}
