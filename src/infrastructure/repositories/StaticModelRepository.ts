import { ArModel, type ArModelSnapshot } from '@domain/entities/ArModel';
import { ModelSource } from '@domain/value-objects/ModelSource';
import type { ModelId } from '@domain/value-objects/ModelId';
import type { ModelRepository } from '@application/ports/ModelRepository';

/**
 * Fase 1: catálogo en memoria.
 * Fase 2: creas HttpModelRepository implementando la MISMA interfaz y
 * cambias una línea en container.ts. Nada más se toca.
 */
export class StaticModelRepository implements ModelRepository {
  private readonly models: readonly ArModel[];

  constructor(snapshots: readonly ArModelSnapshot[]) {
    if (snapshots.length === 0) {
      throw new RangeError('El catálogo no puede estar vacío');
    }
    this.models = snapshots.map(ArModel.fromSnapshot);
  }

  async findById(id: ModelId): Promise<ArModel | null> {
    return this.models.find((model) => model.id.equals(id)) ?? null;
  }

  async findAll(): Promise<readonly ArModel[]> {
    return this.models;
  }
}

/**
 * Fauna del mapa de Nuquí (Chocó).
 *
 * Cada `spot` es la posición del animal sobre `public/targets/map.jpg`, en
 * coordenadas normalizadas 0–1 desde la esquina SUPERIOR IZQUIERDA. Están
 * medidos sobre la imagen de 880×1280 y verificados dibujando una mira
 * encima:
 *
 *     node scripts/preview-spots.mjs \
 *       '[{"u":0.262,"v":0.220},{"u":0.884,"v":0.264}]' salida.jpg
 *
 * Si algún día se reemplaza el mapa, hay que volver a medir estos cuatro
 * valores y recompilar el target — son solidarios con esa imagen concreta.
 *
 * Los timbres son deliberadamente distintos para que se reconozcan de oído
 * sin mirar la pantalla.
 *
 * `description` es la ficha que se lee en el primer plano, bajo el modelo.
 * Está escrita para leerse de un vistazo con el teléfono en la mano: dos
 * frases, sin cifras que nadie va a retener. REVÍSALA con quien conozca el
 * territorio antes de enseñarla — la escribió alguien que no ha estado allí.
 *
 * `outlineShape` es el contorno punteado que se pinta antes de revelar al
 * animal, CALCADO DEL DIBUJO del mapa con `scripts/trace-outline.mjs` y en
 * las mismas coordenadas que `spot`. Los cuatro lo llevan, y es lo que se
 * usa cuando está: el dibujo es lo que la persona tiene delante, así que un
 * contorno sacado de él acierta siempre, mientras que uno deducido del .glb
 * depende de que la pose del modelo coincida con la del ilustrador —y no
 * coincide. La ballena del mapa bucea con la cola alzada, la tortuga nada
 * en diagonal con las aletas abiertas: ninguna proyección rígida del modelo
 * da eso. Si algún día cambia el mapa hay que volver a calcarlos, igual que
 * los `spot`.
 *
 * `outlineView`, `outlineSpin` y `outlineMirror` son el plan B: desde qué
 * cara aplastar el MODELO para deducirle una silueta, y cómo girarla y
 * espejarla para cuadrarla con el dibujo. Solo entran en juego si un animal
 * se queda sin `outlineShape` —uno nuevo, todavía sin calcar—, pero se
 * dejan puestos y medidos por animal para que ese caso salga razonable.
 *
 * La geometría son los .glb del diseñador del equipo, en public/models/.
 * Llegan modelados en unidades de Blender (entre 9 y 23 de lado, con el
 * pivote descentrado): IconLoader los recentra y los encaja a ICON_TARGET_SIZE
 * al cargarlos, así que aquí no hay que tocar `defaultScale` por modelo.
 *
 * Los cuatro van en `view: 'front'`: erguidos sobre el mapa y mirando a
 * quien sostiene el teléfono. Arrastrando el dedo se giran hacia los lados,
 * así que quien quiera ver a un animal de perfil lo gira.
 *
 * `iconSize` es por animal porque de frente cada uno enseña una silueta
 * distinta: la pava se ve entera, la tortuga es baja y ancha, y la ballena
 * se ve escorzada porque su longitud apunta a la cámara. Los números están
 * medidos en pantalla, no calculados sobre el tamaño del archivo.
 *
 * Si un .glb faltara, ese animal cae a un disco gris y los otros tres siguen
 * funcionando. Para volver a los iconos procedurales de PrimitiveFactory —que
 * siguen ahí y no necesitan ningún archivo— basta con cambiar su `source` de
 * vuelta a `ModelSource.primitive(...)`.
 */
export const NUQUI_CATALOG: readonly ArModelSnapshot[] = [
  {
    id: 'whale',
    name: 'Ballena jorobada',
    description:
      'Cada año nada más de 8.000 km desde la Antártida hasta estas aguas ' +
      'cálidas para tener a sus crías. Los machos cantan durante horas.',
    source: ModelSource.gltf('/models/Ballena_PBR.glb'),
    spot: { u: 0.262, v: 0.22 },
    // Lo más grande que cabe de frente sin hundirse en el papel: mirando a
    // la cámara la ballena se extiende HACIA FUERA, no a lo ancho, así que
    // el límite lo pone su fondo, no su silueta. Silueta: 0.204 x 0.141.
    view: 'front',
    iconSize: 3.2,
    facing: 0,
    // La primera que se calcó, y la que dejó claro que había que calcarlas
    // todas: en el mapa está buceando, con la cola alzada y la aleta
    // pectoral extendida hacia abajo. El modelo es una ballena recta;
    // aplastarlo de perfil, de frente o desde arriba da una mancha alargada
    // que no se parece a ese dibujo.
    //
    // Estos puntos se midieron SOBRE map.jpg —recorriendo columna a columna
    // dónde empieza y dónde acaba el azul de la ballena—, así que están en
    // las mismas coordenadas que `spot` y calzan con el dibujo por
    // construcción.
    outlineShape: [
      { u: 0.0773, v: 0.2758 }, { u: 0.0932, v: 0.25 }, { u: 0.1091, v: 0.2297 }, { u: 0.125, v: 0.2141 },
      { u: 0.1409, v: 0.125 }, { u: 0.1568, v: 0.1266 }, { u: 0.1727, v: 0.1313 }, { u: 0.1886, v: 0.1391 },
      { u: 0.2045, v: 0.1484 }, { u: 0.2205, v: 0.1563 }, { u: 0.2364, v: 0.1703 }, { u: 0.2523, v: 0.1781 },
      { u: 0.2682, v: 0.1781 }, { u: 0.2841, v: 0.1781 }, { u: 0.3, v: 0.1812 }, { u: 0.3159, v: 0.1828 },
      { u: 0.3318, v: 0.1844 }, { u: 0.3477, v: 0.1875 }, { u: 0.3636, v: 0.1922 }, { u: 0.3795, v: 0.1969 },
      { u: 0.3955, v: 0.2 }, { u: 0.4114, v: 0.2047 }, { u: 0.4273, v: 0.2109 }, { u: 0.4273, v: 0.232 },
      { u: 0.4114, v: 0.2367 }, { u: 0.3955, v: 0.2383 }, { u: 0.3795, v: 0.2398 }, { u: 0.3636, v: 0.2414 },
      { u: 0.3477, v: 0.243 }, { u: 0.3318, v: 0.2477 }, { u: 0.3159, v: 0.2508 }, { u: 0.3, v: 0.2523 },
      { u: 0.2841, v: 0.2523 }, { u: 0.2682, v: 0.2695 }, { u: 0.2523, v: 0.2805 }, { u: 0.2364, v: 0.2883 },
      { u: 0.2205, v: 0.2992 }, { u: 0.2045, v: 0.3039 }, { u: 0.1886, v: 0.3102 }, { u: 0.1727, v: 0.2586 },
      { u: 0.1568, v: 0.2539 }, { u: 0.1409, v: 0.2633 }, { u: 0.125, v: 0.2648 }, { u: 0.1091, v: 0.2883 },
      { u: 0.0932, v: 0.2867 }, { u: 0.0773, v: 0.2805 },
    ],
    outlineView: 'side',
    outlineSpin: 0,
    outlineMirror: true,
    defaultScale: 1,
    sound: {
      // Canto grave y largo, lo más cerca que se llega de una jorobada
      // con tres osciladores.
      waveform: 'sine',
      rootFrequencyHz: 90,
      overtoneRatios: [1, 1.5, 2.02],
      durationMs: 1800,
    },
  },
  {
    id: 'bird',
    name: 'Pava del Chocó',
    description:
      'Vive en las copas del bosque húmedo y come frutos. Al volar esparce ' +
      'las semillas, así que va sembrando la selva sin darse cuenta.',
    source: ModelSource.gltf('/models/Pava_PBR.glb'),
    spot: { u: 0.884, v: 0.264 },
    // La referencia de tamaño del conjunto: es la que ya se veía bien.
    // Silueta 0.219 x 0.155, prácticamente la de su dibujo (0.22).
    view: 'front',
    iconSize: 1.8,
    facing: 0,
    // Dibujada de perfil, de pie sobre la hierba y mirando a la IZQUIERDA
    // del mapa. Contorno calcado del dibujo: el marrón de la pava contra el
    // verde de la hierba.
    outlineShape: [
      { u: 0.817, v: 0.2094 }, { u: 0.8284, v: 0.2 }, { u: 0.8398, v: 0.2 }, { u: 0.8511, v: 0.2062 },
      { u: 0.8625, v: 0.2281 }, { u: 0.8739, v: 0.225 }, { u: 0.8852, v: 0.225 }, { u: 0.8966, v: 0.2266 },
      { u: 0.908, v: 0.2281 }, { u: 0.9193, v: 0.2297 }, { u: 0.9307, v: 0.2313 }, { u: 0.942, v: 0.2344 },
      { u: 0.9534, v: 0.2375 }, { u: 0.9648, v: 0.2422 }, { u: 0.9761, v: 0.2469 }, { u: 0.9761, v: 0.2789 },
      { u: 0.9648, v: 0.2805 }, { u: 0.9534, v: 0.2805 }, { u: 0.942, v: 0.293 }, { u: 0.9307, v: 0.3164 },
      { u: 0.9193, v: 0.332 }, { u: 0.908, v: 0.3289 }, { u: 0.8966, v: 0.2945 }, { u: 0.8852, v: 0.3039 },
      { u: 0.8739, v: 0.3102 }, { u: 0.8625, v: 0.3195 }, { u: 0.8511, v: 0.3164 }, { u: 0.8398, v: 0.2695 },
      { u: 0.8284, v: 0.2617 }, { u: 0.817, v: 0.2117 },
    ],
    outlineView: 'side',
    outlineSpin: 0,
    defaultScale: 1,
    sound: {
      // Graznido: agudo, corto y con armónicos impares que lo hacen áspero.
      waveform: 'square',
      rootFrequencyHz: 520,
      overtoneRatios: [1, 3, 5.1],
      durationMs: 320,
    },
  },
  {
    id: 'crab',
    name: 'Cangrejo de manglar',
    description:
      'Vive entre el manglar y la playa. Excava madrigueras en la arena y ' +
      'limpia la costa comiendo lo que deja el mar.',
    source: ModelSource.gltf('/models/Cangrejo_PBR.glb'),
    spot: { u: 0.487, v: 0.472 },
    // Ya se veía de frente; 'front' es exactamente la misma orientación
    // que tenía con 'side' + 90°, escrita de forma directa.
    view: 'front',
    iconSize: 1.2,
    facing: 0,
    // Dibujado en planta, como se ve un cangrejo en la arena, con los ojos
    // y las pinzas hacia ARRIBA del mapa. Visto desde arriba el modelo mira
    // hacia abajo, de ahí la media vuelta.
    //
    // Contorno calcado del dibujo: el naranja del caparazón contra la arena.
    // Entran el cuerpo y las patas, no las antenas —demasiado finas para que
    // una columna de píxeles las distinga del fondo.
    outlineShape: [
      { u: 0.4261, v: 0.4734 }, { u: 0.4352, v: 0.4609 }, { u: 0.4443, v: 0.4625 }, { u: 0.4534, v: 0.4625 },
      { u: 0.4625, v: 0.4562 }, { u: 0.4716, v: 0.4547 }, { u: 0.4807, v: 0.4547 }, { u: 0.4898, v: 0.4547 },
      { u: 0.4989, v: 0.4547 }, { u: 0.508, v: 0.4562 }, { u: 0.517, v: 0.4641 }, { u: 0.5261, v: 0.4641 },
      { u: 0.5352, v: 0.4625 }, { u: 0.5443, v: 0.4734 }, { u: 0.5443, v: 0.4984 }, { u: 0.5352, v: 0.4992 },
      { u: 0.5261, v: 0.507 }, { u: 0.517, v: 0.4992 }, { u: 0.508, v: 0.4945 }, { u: 0.4989, v: 0.482 },
      { u: 0.4898, v: 0.482 }, { u: 0.4807, v: 0.482 }, { u: 0.4716, v: 0.493 }, { u: 0.4625, v: 0.493 },
      { u: 0.4534, v: 0.4992 }, { u: 0.4443, v: 0.4914 }, { u: 0.4352, v: 0.5008 }, { u: 0.4261, v: 0.4992 },
    ],
    outlineView: 'top',
    outlineSpin: 180,
    defaultScale: 1,
    sound: {
      // Chasquido de pinza: armónicos no enteros, muy breve. 140 ms era
      // tan corto que en un móvil con ruido alrededor se confundía con no
      // haber sonado; 220 sigue siendo un chasquido pero no deja dudas.
      waveform: 'triangle',
      rootFrequencyHz: 880,
      overtoneRatios: [1, 2.76, 5.4],
      durationMs: 220,
    },
  },
  {
    id: 'turtle',
    name: 'Tortuga golfina',
    description:
      'Vuelve a poner sus huevos en la misma playa donde nació, después de ' +
      'pasar años en mar abierto. Nuquí es una de esas playas.',
    source: ModelSource.gltf('/models/Tortuga_PBR.glb'),
    spot: { u: 0.38, v: 0.635 },
    // De frente es una silueta baja y ancha —una tortuga lo es—, así que
    // se agranda por encima de su dibujo para que no quede como una raya.
    view: 'front',
    iconSize: 2,
    facing: 0,
    // Dibujada nadando, vista desde arriba y con la cabeza hacia la
    // IZQUIERDA del mapa; desde arriba el modelo mira hacia abajo.
    //
    // Contorno calcado del dibujo: el verde oliva de la tortuga contra el
    // mar crema. Va en diagonal, con las aletas extendidas, que es justo lo
    // que una silueta deducida del modelo no acertaba a dar.
    outlineShape: [
      { u: 0.2943, v: 0.6234 }, { u: 0.308, v: 0.5883 }, { u: 0.3216, v: 0.6008 }, { u: 0.3352, v: 0.6133 },
      { u: 0.3489, v: 0.6203 }, { u: 0.3625, v: 0.6188 }, { u: 0.3761, v: 0.6109 }, { u: 0.3898, v: 0.6062 },
      { u: 0.4034, v: 0.6031 }, { u: 0.417, v: 0.6016 }, { u: 0.4307, v: 0.5984 }, { u: 0.4443, v: 0.6312 },
      { u: 0.458, v: 0.6391 }, { u: 0.4716, v: 0.6641 }, { u: 0.4716, v: 0.6758 }, { u: 0.458, v: 0.6711 },
      { u: 0.4443, v: 0.6633 }, { u: 0.4307, v: 0.6617 }, { u: 0.417, v: 0.6633 }, { u: 0.4034, v: 0.6633 },
      { u: 0.3898, v: 0.6633 }, { u: 0.3761, v: 0.6586 }, { u: 0.3625, v: 0.6445 }, { u: 0.3489, v: 0.6539 },
      { u: 0.3352, v: 0.6492 }, { u: 0.3216, v: 0.6445 }, { u: 0.308, v: 0.643 }, { u: 0.2943, v: 0.6414 },
    ],
    outlineView: 'top',
    outlineSpin: -90,
    defaultScale: 1,
    sound: {
      // Burbujeo redondo y tranquilo, a juego con cómo se mueve.
      waveform: 'sine',
      rootFrequencyHz: 240,
      overtoneRatios: [1, 2, 3],
      durationMs: 620,
    },
  },
];
