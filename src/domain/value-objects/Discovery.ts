import type { ModelId } from './ModelId';

/**
 * Qué animales ha encontrado ya el usuario, y qué está mirando de cerca.
 *
 * Son dos ideas distintas y conviene no confundirlas:
 *
 *  - DESBLOQUEADO (revelado) es para siempre. Tocar un animal lo saca de
 *    su contorno punteado y ya se queda sobre el mapa el resto de la
 *    sesión, moviéndose.
 *  - CONOCIDO es haberlo abierto al menos una vez (doble toque): haber
 *    visto su ficha y oído su historia. ESE es el progreso que cuenta —el
 *    que abre los textos del mapa y el que sigue el tutorial—; tocarlo una
 *    vez solo lo despierta.
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
    /** Los que se han abierto alguna vez en primer plano. */
    private readonly openedIds: ReadonlySet<string>,
    /** El animal que se está mirando de cerca, o null. */
    readonly focused: ModelId | null,
    /** El texto del mapa que se está leyendo en grande, o null. */
    readonly reading: string | null,
  ) {
    Object.freeze(this);
  }

  static empty(): Discovery {
    return new Discovery(new Set(), new Set(), null, null);
  }

  isUnlocked(id: ModelId): boolean {
    return this.unlockedIds.has(id.value);
  }

  /** ¿Lo ha abierto ya alguna vez (ha visto su ficha)? */
  isOpened(id: ModelId | string): boolean {
    return this.openedIds.has(typeof id === 'string' ? id : id.value);
  }

  get openedCount(): number {
    return this.openedIds.size;
  }

  /** ¿Ha revelado ya alguno? */
  get hasAny(): boolean {
    return this.unlockedIds.size > 0;
  }

  get unlockedCount(): number {
    return this.unlockedIds.size;
  }

  /**
   * ¿CONOCE ya a TODOS (los ha abierto)? Es lo que abre los textos del
   * mapa: primero se explora, y la lectura es la recompensa de haber
   * explorado entero. Revelarlos con un toque no basta.
   */
  hasFoundAll(total: number): boolean {
    return total > 0 && this.openedIds.size >= total;
  }

  /** Hay algo abierto en grande —un animal o un texto— y no se le quita el sitio. */
  get isBusy(): boolean {
    return this.focused !== null || this.reading !== null;
  }

  /**
   * Un toque: saca al animal de su contorno (y se queda fuera para
   * siempre), sin abrir nada. Ya revelado, no cambia nada.
   */
  reveal(id: ModelId): Discovery {
    if (this.unlockedIds.has(id.value)) return this;
    const next = new Set(this.unlockedIds);
    next.add(id.value);
    return new Discovery(next, this.openedIds, this.focused, this.reading);
  }

  /**
   * Abre un animal en primer plano: lo revela, lo pone delante y cuenta
   * como CONOCIDO.
   */
  unlock(id: ModelId): Discovery {
    const unlocked = new Set(this.unlockedIds);
    unlocked.add(id.value);
    const opened = new Set(this.openedIds);
    opened.add(id.value);
    return new Discovery(unlocked, opened, id, null);
  }

  /** Abre o cierra el primer plano SIN tocar lo ya desbloqueado. Cerrar cierra también la lectura. */
  focus(id: ModelId | null): Discovery {
    if (id === null) {
      return this.focused === null && this.reading === null
        ? this
        : new Discovery(this.unlockedIds, this.openedIds, null, null);
    }
    if (this.focused !== null && this.focused.equals(id) && this.reading === null) return this;
    return new Discovery(this.unlockedIds, this.openedIds, id, null);
  }

  /**
   * Abre un texto para leerlo. Con otra cosa abierta, no hace nada. Que
   * ya se hayan encontrado todos los animales lo comprueba quien llama
   * (`hasFoundAll` necesita saber cuántos hay).
   */
  read(textId: string): Discovery {
    if (this.reading === textId || this.isBusy) return this;
    return new Discovery(this.unlockedIds, this.openedIds, null, textId);
  }
}
