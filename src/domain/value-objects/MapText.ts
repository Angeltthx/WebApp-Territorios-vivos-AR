/**
 * Un texto IMPRESO en el mapa que se puede abrir para leerlo en grande.
 *
 * El mapa está lleno de letra pequeña —el texto sobre el turismo, el
 * directorio de emprendimientos, las etiquetas de los lugares— que con el
 * teléfono en la mano cuesta leer. Cuando el usuario ha encontrado a todos
 * los animales, cada uno de estos textos se marca con destellos y, al
 * tocarlo, aparece en grande con el mismo aspecto que tiene en el papel.
 *
 * NO es una ficha ni una explicación: es el MISMO texto del mapa, palabra
 * por palabra, transcrito para poder componerlo grande y nítido (ampliar un
 * recorte de la imagen lo dejaría borroso: el mapa entero mide 1000 px).
 * Por eso los bloques describen CÓMO está escrito en el mapa, no qué dice:
 *
 *   'paragraph' párrafo en serif blanca sobre el mar
 *   'directory' nombre + usuario de redes en cápsula naranja
 *   'pin'       etiqueta fucsia de un lugar
 *   'place'     nombre de un pueblo en cápsula blanca
 *   'sea'       rótulo manuscrito del océano
 *   'species'   cápsula azul con nombre común y científico
 *   'link'      una dirección web
 *
 * `area` son las esquinas del texto sobre `map.jpg`, en las mismas
 * coordenadas normalizadas que el `spot` de un animal.
 */
export type MapTextBlock =
  | { readonly kind: 'paragraph' | 'pin' | 'place' | 'sea' | 'link'; readonly text: string }
  | { readonly kind: 'species'; readonly name: string; readonly scientific: string }
  | { readonly kind: 'directory'; readonly entries: readonly { readonly name: string; readonly handle: string }[] };

export interface MapTextArea {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface MapTextSnapshot {
  readonly id: string;
  /** Nombre corto para lectores de pantalla y analítica. */
  readonly label: string;
  readonly area: MapTextArea;
  readonly blocks: readonly MapTextBlock[];
  /** Sonido de fondo mientras se lee: el lugar del que habla el texto. */
  readonly ambience?: string;
  /**
   * El dibujo que acompaña al texto en el mapa, recortado sin fondo
   * (`npm run cut-illustrations`): la choza sobre «Etnoaldea Kipara Té»,
   * los bailarines junto a la danza. Se enseña en grande encima del texto.
   */
  readonly illustration?: string;
}

export class MapText {
  private constructor(
    readonly id: string,
    readonly label: string,
    readonly area: MapTextArea,
    readonly blocks: readonly MapTextBlock[],
    readonly ambience: string | null,
    readonly illustration: string | null,
  ) {
    Object.freeze(this);
  }

  static of(snapshot: MapTextSnapshot): MapText {
    const id = snapshot.id.trim();
    if (id.length === 0) throw new RangeError('Un texto del mapa necesita id');
    const { u0, v0, u1, v1 } = snapshot.area;
    const inside = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    if (![u0, v0, u1, v1].every(inside) || u0 >= u1 || v0 >= v1) {
      throw new RangeError(`Zona inválida para "${id}": debe ir de arriba-izquierda a abajo-derecha, en 0–1`);
    }
    if (snapshot.blocks.length === 0) throw new RangeError(`"${id}" no tiene texto`);
    const blank = (text: string) => text.trim().length === 0;
    for (const block of snapshot.blocks) {
      const empty = block.kind === 'directory'
        ? block.entries.length === 0 || block.entries.some((entry) => blank(entry.name))
        : block.kind === 'species' ? blank(block.name) : blank(block.text);
      if (empty) throw new RangeError(`"${id}" tiene un bloque '${block.kind}' vacío`);
    }
    return new MapText(
      id,
      snapshot.label.trim() || id,
      Object.freeze({ u0, v0, u1, v1 }),
      Object.freeze([...snapshot.blocks]),
      snapshot.ambience?.trim() || null,
      snapshot.illustration?.trim() || null,
    );
  }

  /** Centro de la zona, en coordenadas de la imagen. */
  get center(): { readonly u: number; readonly v: number } {
    return { u: (this.area.u0 + this.area.u1) / 2, v: (this.area.v0 + this.area.v1) / 2 };
  }
}
