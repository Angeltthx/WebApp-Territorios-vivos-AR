import type { Language } from './Language';

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
   * Fotos REALES del lugar del que habla el texto (de la grabación del
   * webdoc, ver `npm run make-photos`), como mucho tres: se ven encima del
   * texto en una tira que se desliza. Sustituyen a los dibujos del mapa
   * recortados sin fondo, que se veían mal recortados.
   */
  readonly photos?: readonly MapPhoto[];
  /**
   * El texto en inglés. Solo lo que cambia: los nombres propios (lugares,
   * negocios, la web) se quedan como están en el mapa. Sin él, en inglés se
   * enseña el español.
   */
  readonly english?: {
    readonly label?: string;
    readonly blocks: readonly MapTextBlock[];
  };
}

/** Una foto de un lugar: la imagen y lo que se ve en ella, en los dos idiomas. */
export interface MapPhoto {
  readonly src: string;
  readonly alt: string;
  readonly altEn?: string;
}

/** Como mucho, tantas fotos por texto: acompañan, no son una galería. */
export const MAX_PHOTOS = 3;

export class MapText {
  private constructor(
    readonly id: string,
    readonly label: string,
    readonly area: MapTextArea,
    readonly blocks: readonly MapTextBlock[],
    readonly ambience: string | null,
    readonly photos: readonly MapPhoto[],
    private readonly english: { readonly label: string; readonly blocks: readonly MapTextBlock[] } | null,
  ) {
    Object.freeze(this);
  }

  /** Lo que se lee en grande, en ese idioma. */
  blocksIn(language: Language): readonly MapTextBlock[] {
    return language === 'en' && this.english !== null ? this.english.blocks : this.blocks;
  }

  /** Lo que se ve en cada foto, en ese idioma (para lectores de pantalla). */
  photoAltIn(photo: MapPhoto, language: Language): string {
    return language === 'en' && photo.altEn !== undefined ? photo.altEn : photo.alt;
  }

  labelIn(language: Language): string {
    return language === 'en' && this.english !== null ? this.english.label : this.label;
  }

  static of(snapshot: MapTextSnapshot): MapText {
    const id = snapshot.id.trim();
    if (id.length === 0) throw new RangeError('Un texto del mapa necesita id');
    const { u0, v0, u1, v1 } = snapshot.area;
    const inside = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    if (![u0, v0, u1, v1].every(inside) || u0 >= u1 || v0 >= v1) {
      throw new RangeError(`Zona inválida para "${id}": debe ir de arriba-izquierda a abajo-derecha, en 0–1`);
    }
    checkBlocks(id, snapshot.blocks);
    if (snapshot.english !== undefined) checkBlocks(`${id} (inglés)`, snapshot.english.blocks);
    const photos = (snapshot.photos ?? []).map((photo) => Object.freeze({ ...photo, src: photo.src.trim() }));
    if (photos.length > MAX_PHOTOS) throw new RangeError(`"${id}": ${photos.length} fotos; el máximo es ${MAX_PHOTOS}`);
    if (photos.some((photo) => photo.src.length === 0 || photo.alt.trim().length === 0)) {
      throw new RangeError(`"${id}": cada foto necesita su imagen y su descripción`);
    }
    const label = snapshot.label.trim() || id;
    return new MapText(
      id,
      label,
      Object.freeze({ u0, v0, u1, v1 }),
      Object.freeze([...snapshot.blocks]),
      snapshot.ambience?.trim() || null,
      Object.freeze(photos),
      snapshot.english === undefined
        ? null
        : Object.freeze({
            label: snapshot.english.label?.trim() || label,
            blocks: Object.freeze([...snapshot.english.blocks]),
          }),
    );
  }

  /** Centro de la zona, en coordenadas de la imagen. */
  get center(): { readonly u: number; readonly v: number } {
    return { u: (this.area.u0 + this.area.u1) / 2, v: (this.area.v0 + this.area.v1) / 2 };
  }
}

function checkBlocks(id: string, blocks: readonly MapTextBlock[]): void {
  if (blocks.length === 0) throw new RangeError(`"${id}" no tiene texto`);
  const blank = (text: string) => text.trim().length === 0;
  for (const block of blocks) {
    const empty = block.kind === 'directory'
      ? block.entries.length === 0 || block.entries.some((entry) => blank(entry.name))
      : block.kind === 'species' ? blank(block.name) : blank(block.text);
    if (empty) throw new RangeError(`"${id}" tiene un bloque '${block.kind}' vacío`);
  }
}
