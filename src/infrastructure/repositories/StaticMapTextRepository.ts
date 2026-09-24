import { MapText, type MapTextSnapshot } from '@domain/value-objects/MapText';
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
    illustration: '/illustrations/danza.webp',
    ambience: COAST,
  },
  {
    id: 'kipara',
    label: 'Etnoaldea Kipara Té',
    area: { u0: 0.735, v0: 0.0594, u1: 0.935, v1: 0.1362 },
    blocks: [{ kind: 'pin', text: 'Etnoaldea Kipara Té' }],
    illustration: '/illustrations/kipara.webp',
    ambience: FOREST,
  },
  {
    id: 'lobos',
    label: 'Lobos del Manglar',
    area: { u0: 0.688, v0: 0.3031, u1: 0.757, v1: 0.3282 },
    blocks: [{ kind: 'pin', text: 'Lobos del Manglar' }],
    ambience: MANGROVE,
  },
  {
    id: 'chachita',
    label: 'Posada ecoturistica Chachita',
    area: { u0: 0.388, v0: 0.6879, u1: 0.468, v1: 0.7214 },
    blocks: [{ kind: 'pin', text: 'Posada ecoturistica Chachita' }],
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
  {
    id: 'rana',
    label: 'Rana arlequín',
    area: { u0: 0.802, v0: 0.8122, u1: 0.94, v1: 0.8352 },
    blocks: [{ kind: 'species', name: 'Rana arlequín', scientific: 'Oophaga solanensis' }],
    illustration: '/illustrations/rana.webp',
    ambience: '/audio/frogs/ambience.mp3',
  },
  {
    id: 'oceano',
    label: 'Océano Pacífico',
    area: { u0: 0.072, v0: 0.5272, u1: 0.192, v1: 0.567 },
    blocks: [{ kind: 'sea', text: 'Océano Pacífico' }],
    ambience: SEA,
  },
  { id: 'jurubida', label: 'Jurubidá', area: { u0: 0.48, v0: 0.0433, u1: 0.605, v1: 0.0615 }, blocks: [{ kind: 'place', text: 'Jurubidá' }], ambience: COAST },
  { id: 'tribuga', label: 'Tribugá', area: { u0: 0.672, v0: 0.3527, u1: 0.8, v1: 0.3701 }, blocks: [{ kind: 'place', text: 'Tribugá' }], ambience: COAST },
  { id: 'nuqui', label: 'Nuquí', area: { u0: 0.51, v0: 0.618, u1: 0.605, v1: 0.6362 }, blocks: [{ kind: 'place', text: 'Nuquí' }], ambience: COAST },
  { id: 'pangui', label: 'Pangui', area: { u0: 0.378, v0: 0.7367, u1: 0.477, v1: 0.7556 }, blocks: [{ kind: 'place', text: 'Pangui' }], ambience: COAST },
  { id: 'coqui', label: 'Coqui', area: { u0: 0.118, v0: 0.8834, u1: 0.215, v1: 0.9015 }, blocks: [{ kind: 'place', text: 'Coqui' }], ambience: COAST },
];
