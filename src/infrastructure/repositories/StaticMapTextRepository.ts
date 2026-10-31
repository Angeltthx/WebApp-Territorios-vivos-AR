import { MapText, type MapPhoto, type MapTextSnapshot } from '@domain/value-objects/MapText';
import type { MapTextRepository } from '@application/ports/MapTextRepository';

export class StaticMapTextRepository implements MapTextRepository {
  /** Lectura síncrona para quien los necesita al construirse (la escena). */
  readonly all: readonly MapText[];
  private readonly texts: readonly MapText[];

  constructor(snapshots: readonly MapTextSnapshot[]) {
    this.texts = snapshots.map(MapText.of);
    this.all = this.texts;
    const ids = new Set(this.texts.map((text) => text.id));
    if (ids.size !== this.texts.length) throw new RangeError('Hay textos del mapa con el id repetido');
  }

  async findAll(): Promise<readonly MapText[]> {
    return this.texts;
  }

  async findById(id: string): Promise<MapText | null> {
    return this.texts.find((text) => text.id === id) ?? null;
  }
}

/** Costa: el mar por delante y la selva del Chocó detrás. Es Nuquí. */
const COAST = '/audio/coast/ambience.mp3';
/** Selva del Chocó, grabada allí. */
const FOREST = '/audio/bird/ambience.mp3';

/**
 * Fotos REALES de los lugares, de la grabación del webdoc (ver
 * `npm run make-photos` y photos-src/photos.json, que dice de qué foto
 * original sale cada una). Como mucho tres por texto, y SOLO en los tres que
 * pidió el cliente: la posada de Chachita (lleva el delantal de su posada),
 * la compañía de danza de Orfelina Marmolejo (la del directorio,
 * @orfelinamarmolejo) y la Etnoaldea Kipará Té. Hubo también en Lobos del
 * Manglar, Nuquí, Panguí y el texto de turismo: se quitaron.
 */
const PHOTOS: Record<string, readonly MapPhoto[]> = {
  danza: [
    { src: '/photos/danza-1.webp', alt: 'El grupo de danza tradicional con sus trajes, alrededor de Orfelina Marmolejo', altEn: 'The traditional dance group in costume, around Orfelina Marmolejo' },
    { src: '/photos/danza-2.webp', alt: 'Una bailarina de amarillo sonríe junto a su pareja de baile', altEn: 'A dancer in yellow smiles next to her dance partner' },
    { src: '/photos/danza-3.webp', alt: 'Bailarinas con flores rojas en el cabello', altEn: 'Dancers with red flowers in their hair' },
  ],
  kipara: [
    { src: '/photos/kipara-1.webp', alt: 'Tambos embera con techo de palma, unidos por pasarelas de madera', altEn: 'Emberá tambos with palm-thatched roofs, joined by wooden walkways' },
    { src: '/photos/kipara-2.webp', alt: 'Danza embera de noche bajo el techo de un tambo', altEn: 'An Emberá dance at night under the roof of a tambo' },
    { src: '/photos/kipara-3.webp', alt: 'Mujeres y niñas embera con su vestimenta tradicional', altEn: 'Emberá women and girls in traditional dress' },
  ],
  chachita: [
    { src: '/photos/chachita-1.webp', alt: 'Chachita sonríe con el delantal de su posada ecoturística', altEn: 'Chachita smiles in the apron of her eco-lodge' },
    { src: '/photos/chachita-2.webp', alt: 'Chachita en la playa, con frutas y platos de la región', altEn: 'Chachita on the beach, with fruit and local dishes' },
    { src: '/photos/chachita-3.webp', alt: 'Chachita con plantas de su huerta junto al mar', altEn: 'Chachita with plants from her garden by the sea' },
  ],
};

/**
 * Los textos del mapa de Nuquí que se pueden leer en grande.
 *
 * SOLO CUATRO, a pedido del cliente (octubre de 2026): la Etnoaldea, la
 * posada de Chachita, la Fundación Serranías del Porvenir y el directorio
 * turístico (para abrir el Instagram de cada emprendimiento). Los demás
 * —el párrafo de turismo, la web, Lobos del Manglar, las etiquetas rosadas
 * de Nuquí, Posada Sonona, el océano y los nombres de los pueblos— tuvieron
 * su punto amarillo y se quitaron.
 *
 * TRANSCRITOS DEL MAPA tal cual (el texto sale del propio PDF de la
 * diseñadora, `Mapa-de-Nuquí-Final.pdf`): lo que se enseña es el mapa, no
 * una corrección de él. Si el mapa cambia, estos textos y sus zonas cambian
 * con él, igual que los `spot` de los animales.
 *
 * Las zonas están en coordenadas de `public/targets/map.jpg` (1000×1437):
 * las cajas del texto del PDF pasadas a la imagen, más el pin o el dibujo
 * que acompaña a cada etiqueta, y comprobadas dibujándolas encima.
 *
 * EN INGLÉS (`english`), solo lo que se traduce. Los nombres propios
 * —lugares, negocios— se quedan como en el mapa; un texto que solo lleva
 * nombres propios no necesita versión inglesa.
 *
 * El sonido es el del LUGAR del que habla cada texto. No hay grabaciones
 * abiertas de marimba de chonta ni de currulao, así que la fundación de
 * danza y el directorio suenan a costa.
 */
export const NUQUI_MAP_TEXTS: readonly MapTextSnapshot[] = [
  {
    id: 'directorio',
    label: 'Directorio de turismo local',
    area: { u0: 0.092, v0: 0.6145, u1: 0.364, v1: 0.7285 },
    blocks: [
      {
        kind: 'directory',
        entries: [
          { name: 'Etnoaldea Kipara Té', handle: '@kiparatenuqui' },
          { name: 'Lobos del Manglar', handle: '@lobosdelmanglar' },
          { name: 'Vientos de Yubarta', handle: '@vientosdeyubarta' },
          { name: 'Carlitours Nuquí', handle: '@carlitours.nuqui' },
          { name: 'Museo Melelé', handle: '@museo_melele' },
          { name: 'Escombros del Mar', handle: '@escombrosdelmarhostal' },
          { name: 'Posada ecoturística Chachita', handle: '@posadaecoturisticachachita' },
          { name: 'Posada Sonona', handle: '@sononaecolodge' },
          { name: 'Posada Nativa Jara', handle: '@posadanativajara.jovi' },
          { name: 'Grupo de Danza Cultural Serranías del Porvenir', handle: '@fundacionserraniasdelporvenir' },
        ],
      },
    ],
    // Los negocios conservan su nombre; solo el grupo de danza se describe.
    english: {
      label: 'Local tourism directory',
      blocks: [
        {
          kind: 'directory',
          entries: [
            { name: 'Etnoaldea Kipara Té', handle: '@kiparatenuqui' },
            { name: 'Lobos del Manglar', handle: '@lobosdelmanglar' },
            { name: 'Vientos de Yubarta', handle: '@vientosdeyubarta' },
            { name: 'Carlitours Nuquí', handle: '@carlitours.nuqui' },
            { name: 'Museo Melelé', handle: '@museo_melele' },
            { name: 'Escombros del Mar', handle: '@escombrosdelmarhostal' },
            { name: 'Posada ecoturística Chachita', handle: '@posadaecoturisticachachita' },
            { name: 'Posada Sonona', handle: '@sononaecolodge' },
            { name: 'Posada Nativa Jara', handle: '@posadanativajara.jovi' },
            { name: 'Serranías del Porvenir cultural dance group', handle: '@fundacionserraniasdelporvenir' },
          ],
        },
      ],
    },
    ambience: COAST,
  },
  // La compañía de danza de Orfelina Marmolejo: en el mapa nuevo su etiqueta
  // rosada es la de la fundación, y su Instagram el de la fundación (antes
  // @orfelinamarmolejo). El id sigue siendo 'danza' por sus fotos.
  {
    id: 'danza',
    label: 'Fundación Cultural y Ambiental Serranías del Porvenir',
    // La etiqueta, de tres líneas, y su pin a la izquierda.
    area: { u0: 0.672, v0: 0.505, u1: 0.81, v1: 0.536 },
    blocks: [{ kind: 'pin', text: 'Fundación Cultural y Ambiental Serranías del Porvenir' }],
    english: {
      label: 'Serranías del Porvenir Cultural and Environmental Foundation',
      blocks: [{ kind: 'pin', text: 'Serranías del Porvenir Cultural and Environmental Foundation' }],
    },
    photos: PHOTOS['danza']!,
    ambience: COAST,
  },
  {
    id: 'kipara',
    label: 'Etnoaldea Kipara Té',
    // Los tambos dibujados y su etiqueta.
    area: { u0: 0.735, v0: 0.055, u1: 0.935, v1: 0.152 },
    blocks: [{ kind: 'pin', text: 'Etnoaldea Kipara Té' }],
    photos: PHOTOS['kipara']!,
    ambience: FOREST,
  },
  {
    id: 'chachita',
    label: 'Posada Ecoturística Chachita',
    // La etiqueta y su pin, encima. Empieza justo donde acaba el directorio.
    area: { u0: 0.365, v0: 0.693, u1: 0.478, v1: 0.737 },
    blocks: [{ kind: 'pin', text: 'Posada Ecoturística Chachita' }],
    photos: PHOTOS['chachita']!,
    ambience: FOREST,
  },
];
