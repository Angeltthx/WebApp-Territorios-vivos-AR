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

/** Mar abierto (olas). */
const SEA = '/audio/whale/ambience.mp3';
/** Costa: el mar por delante y la selva del Chocó detrás. Es Nuquí. */
const COAST = '/audio/coast/ambience.mp3';
/** Selva del Chocó, grabada allí. */
const FOREST = '/audio/bird/ambience.mp3';
/** Playa con manglar. */
const MANGROVE = '/audio/crab/ambience.mp3';

/**
 * Fotos REALES de los lugares, de la grabación del webdoc (ver
 * `npm run make-photos` y photos-src/photos.json, que dice de qué foto
 * original sale cada una). Como mucho tres por texto. La danza es la de
 * Orfelina Marmolejo, la misma compañía del directorio (@orfelinamarmolejo);
 * Chachita lleva el delantal de su posada.
 *
 * Kipará Té, Lobos del Manglar y Panguí llevan fotos de las estaciones del
 * webdoc que el equipo situó en una comunidad embera y en el manglar de
 * Panguí: hay que confirmar con el equipo que cada una es de ESE lugar.
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
  lobos: [
    { src: '/photos/lobos-1.webp', alt: 'Una mujer camina por un túnel de raíces de manglar', altEn: 'A woman walks through a tunnel of mangrove roots' },
    { src: '/photos/lobos-2.webp', alt: 'El manglar reflejado en el agua, con garzas', altEn: 'The mangrove reflected in the water, with herons' },
  ],
  nuqui: [
    { src: '/photos/nuqui-1.webp', alt: 'Un pescador rema en su canoa frente a una isla', altEn: 'A fisherman paddles his canoe in front of an island' },
    { src: '/photos/nuqui-2.webp', alt: 'Una calle de Nuquí después de la lluvia', altEn: 'A street in Nuquí after the rain' },
  ],
  pangui: [
    { src: '/photos/pangui-1.webp', alt: 'El río y la selva de Panguí desde el aire', altEn: 'The river and the forest of Panguí from the air' },
    { src: '/photos/pangui-2.webp', alt: 'Una mujer toca las ramas del manglar', altEn: 'A woman touches the branches of the mangrove' },
    { src: '/photos/pangui-3.webp', alt: 'Una mujer camina hacia el mar al atardecer', altEn: 'A woman walks into the sea at sunset' },
  ],
  turismo: [
    { src: '/photos/turismo-1.webp', alt: 'Un pescador sonríe con su red al hombro', altEn: 'A fisherman smiles with his net over his shoulder' },
    { src: '/photos/turismo-2.webp', alt: 'Un pescador camina por la playa junto a una canoa', altEn: 'A fisherman walks along the beach next to a canoe' },
    { src: '/photos/turismo-3.webp', alt: 'Atardecer sobre el Pacífico, entre rocas y selva', altEn: 'Sunset over the Pacific, between rocks and forest' },
  ],
};

/**
 * Los textos del mapa de Nuquí que se pueden leer en grande.
 *
 * TRANSCRITOS DEL MAPA tal cual, incluidas sus diferencias —la etiqueta
 * rosada dice «Las Serranía» y el directorio «Las Serranías»—: lo que se
 * enseña es el mapa, no una corrección de él. Si el mapa cambia, estos
 * textos y sus zonas cambian con él, igual que los `spot` de los animales.
 *
 * Las zonas se midieron en píxeles sobre `public/targets/map.jpg`
 * (1000×1432) y se comprobaron dibujándolas encima; aquí van divididas
 * entre 1000 y 1432.
 *
 * EN INGLÉS (`english`), solo lo que se traduce: los párrafos, las
 * descripciones y los nombres comunes. Los nombres propios —lugares,
 * negocios, la web— se quedan como en el mapa; un texto que solo lleva
 * nombres propios no necesita versión inglesa.
 *
 * El sonido es el del LUGAR del que habla cada texto. No hay grabaciones
 * abiertas de marimba de chonta ni de currulao, así que la danza y el
 * directorio suenan a costa; si se consigue una grabación (Las Serranías
 * está en el propio mapa), es cambiar una línea.
 */
export const NUQUI_MAP_TEXTS: readonly MapTextSnapshot[] = [
  {
    id: 'turismo',
    label: 'Turismo responsable',
    area: { u0: 0.092, v0: 0.3631, u1: 0.5, v1: 0.4714 },
    blocks: [
      {
        kind: 'paragraph',
        text:
          'Cuando eliges un turismo responsable, el océano sigue siendo refugio de las ' +
          'ballenas, la selva continúa respirando y las comunidades pueden seguir ' +
          'contando su propia historia.',
      },
      {
        kind: 'paragraph',
        text:
          'El turismo sustentable convierte cada visita en un acto de conservación, cada ' +
          'experiencia en un aprendizaje y cada encuentro en una oportunidad para ' +
          'fortalecer a las comunidades locales, sus saberes y su cultura.',
      },
    ],
    english: {
      label: 'Responsible tourism',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'When you choose responsible tourism, the ocean remains a refuge for whales, ' +
            'the forest keeps breathing and communities can go on telling their own story.',
        },
        {
          kind: 'paragraph',
          text:
            'Sustainable tourism turns every visit into an act of conservation, every ' +
            'experience into learning and every encounter into a chance to strengthen ' +
            'local communities, their knowledge and their culture.',
        },
      ],
    },
    photos: PHOTOS['turismo']!,
    ambience: COAST,
  },
  {
    id: 'web',
    label: 'Territorios Vivos',
    area: { u0: 0.152, v0: 0.3394, u1: 0.336, v1: 0.3513 },
    blocks: [{ kind: 'link', text: 'www.territoriosvivos.com.co' }],
    ambience: COAST,
  },
  {
    id: 'directorio',
    label: 'Directorio de turismo local',
    area: { u0: 0.092, v0: 0.6145, u1: 0.368, v1: 0.7193 },
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
          { name: 'Posada ecoturistica Chachita', handle: '@posadaecoturisticachachita' },
          { name: 'Posada Sonona', handle: '@sononaecolodge' },
          { name: 'Posada Nativa Jara', handle: '@posadanativajara.jovi' },
          { name: 'Danza tradicional Las Serranías', handle: '@orfelinamarmolejo' },
        ],
      },
    ],
    // Los negocios conservan su nombre; solo la danza se describe.
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
            { name: 'Posada ecoturistica Chachita', handle: '@posadaecoturisticachachita' },
            { name: 'Posada Sonona', handle: '@sononaecolodge' },
            { name: 'Posada Nativa Jara', handle: '@posadanativajara.jovi' },
            { name: 'Las Serranías traditional dance', handle: '@orfelinamarmolejo' },
          ],
        },
      ],
    },
    ambience: COAST,
  },
  {
    id: 'danza',
    label: 'Lugares de Nuquí y danza tradicional',
    area: { u0: 0.59, v0: 0.5251, u1: 0.77, v1: 0.6061 },
    blocks: [
      { kind: 'pin', text: 'Vientos de Yubarta' },
      { kind: 'pin', text: 'Carlitours Nuquí' },
      { kind: 'pin', text: 'Museo Melelé' },
      { kind: 'pin', text: 'Escombros del Mar' },
      { kind: 'pin', text: 'Compañía de danza tradicional Las Serranía' },
    ],
    english: {
      label: 'Places in Nuquí and traditional dance',
      blocks: [
        { kind: 'pin', text: 'Vientos de Yubarta' },
        { kind: 'pin', text: 'Carlitours Nuquí' },
        { kind: 'pin', text: 'Museo Melelé' },
        { kind: 'pin', text: 'Escombros del Mar' },
        { kind: 'pin', text: 'Las Serranía traditional dance company' },
      ],
    },
    photos: PHOTOS['danza']!,
    ambience: COAST,
  },
  {
    id: 'kipara',
    label: 'Etnoaldea Kipara Té',
    area: { u0: 0.735, v0: 0.0594, u1: 0.935, v1: 0.1362 },
    blocks: [{ kind: 'pin', text: 'Etnoaldea Kipara Té' }],
    photos: PHOTOS['kipara']!,
    ambience: FOREST,
  },
  {
    id: 'lobos',
    label: 'Lobos del Manglar',
    area: { u0: 0.688, v0: 0.3031, u1: 0.757, v1: 0.3282 },
    blocks: [{ kind: 'pin', text: 'Lobos del Manglar' }],
    photos: PHOTOS['lobos']!,
    ambience: MANGROVE,
  },
  {
    id: 'chachita',
    label: 'Posada ecoturistica Chachita',
    area: { u0: 0.388, v0: 0.6879, u1: 0.468, v1: 0.7214 },
    blocks: [{ kind: 'pin', text: 'Posada ecoturistica Chachita' }],
    photos: PHOTOS['chachita']!,
    ambience: FOREST,
  },
  {
    id: 'sur',
    label: 'Escombros del Mar y Posada Sonona',
    area: { u0: 0.058, v0: 0.8296, u1: 0.15, v1: 0.8603 },
    blocks: [
      { kind: 'pin', text: 'Escombros del Mar' },
      { kind: 'pin', text: 'Posada Sonona' },
    ],
    ambience: SEA,
  },
  // La etiqueta «RANA ARLEQUÍN / Oophaga solanensis» fue un texto de aquí
  // hasta que la rana pasó a ser el quinto animal: ahora es su ficha.
  {
    id: 'oceano',
    label: 'Océano Pacífico',
    area: { u0: 0.072, v0: 0.5272, u1: 0.192, v1: 0.567 },
    blocks: [{ kind: 'sea', text: 'Océano Pacífico' }],
    english: { label: 'Pacific Ocean', blocks: [{ kind: 'sea', text: 'Pacific Ocean' }] },
    ambience: SEA,
  },
  { id: 'jurubida', label: 'Jurubidá', area: { u0: 0.48, v0: 0.0433, u1: 0.605, v1: 0.0615 }, blocks: [{ kind: 'place', text: 'Jurubidá' }], ambience: COAST },
  { id: 'tribuga', label: 'Tribugá', area: { u0: 0.672, v0: 0.3527, u1: 0.8, v1: 0.3701 }, blocks: [{ kind: 'place', text: 'Tribugá' }], ambience: COAST },
  { id: 'nuqui', label: 'Nuquí', area: { u0: 0.51, v0: 0.618, u1: 0.605, v1: 0.6362 }, blocks: [{ kind: 'place', text: 'Nuquí' }], photos: PHOTOS['nuqui']!, ambience: COAST },
  { id: 'pangui', label: 'Pangui', area: { u0: 0.378, v0: 0.7367, u1: 0.477, v1: 0.7556 }, blocks: [{ kind: 'place', text: 'Pangui' }], photos: PHOTOS['pangui']!, ambience: COAST },
  { id: 'coqui', label: 'Coqui', area: { u0: 0.118, v0: 0.8834, u1: 0.215, v1: 0.9015 }, blocks: [{ kind: 'place', text: 'Coqui' }], ambience: COAST },
];
