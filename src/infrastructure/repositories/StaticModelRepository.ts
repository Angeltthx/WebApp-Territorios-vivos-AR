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
 * medidos sobre la imagen de 1000×1432 y verificados dibujando el contorno
 * calcado encima:
 *
 *     node scripts/preview-spots.mjs \
 *       '[{"u":0.292,"v":0.116},{"u":0.909,"v":0.512}]' salida.jpg
 *
 * Si algún día se reemplaza el mapa, hay que volver a medir estos cuatro
 * valores y recompilar el target — son solidarios con esa imagen concreta.
 *
 * Los timbres son deliberadamente distintos para que se reconozcan de oído
 * sin mirar la pantalla.
 *
 * `description` es la ficha que se lee en el primer plano, bajo el modelo:
 * los textos que entregó el equipo, uno o varios párrafos que se muestran
 * todos. `species` es la línea de nombre científico / nombre común que va
 * bajo el título.
 *
 * `soundscape` son GRABACIONES REALES: su voz, lo que suena al tocarlo y el
 * ambiente del lugar donde vive (ver AnimalSoundscape). Los archivos los
 * genera `npm run build-audio` desde `audio-src/`, y de dónde sale cada uno
 * —autor y licencia— está en `public/audio/CREDITOS.md`. `sound` (timbre
 * sintetizado) queda como respaldo para un animal sin grabaciones.
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
 * Los cuatro van de frente, mirando a quien sostiene el teléfono.
 * Arrastrando el dedo se pueden girar en su propio sitio.
 *
 * `iconSize` es por animal porque cada uno enseña una silueta distinta. Los
 * números se comprueban sobre el mapa en pantalla, no solo con las medidas
 * tridimensionales del archivo.
 *
 * En el mapa de 2026 los dibujos encogieron —la ballena sigue midiendo 0,30
 * de ancho de mapa, pero la tortuga bajó a 0,18, la pava a 0,12 y el
 * cangrejo a 0,09—. Los tamaños conservan esa jerarquía visual sin permitir
 * que el pulso o el giro desborden la imagen. El ajuste fino aún necesita el
 * mapa impreso delante.
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
    species: 'Megaptera novaeangliae / Ballena yubarta o jorobada',
    description: [
      'Cada año viaja más de 8.000 km desde la Antártida hasta estas aguas tibias ' +
        'para tener a sus crías. Nuquí es su sala de parto.',
      'El macho canta bajo el agua durante horas: la melodía más larga del reino ' +
        'animal. Y la compone frente a estas costas.',
    ],
    // Canto de jorobada (Parques Nacionales de EE. UU. y CC0), su soplido al
    // salir a respirar y un chapuzón para el salto, y el mar de fondo.
    soundscape: {
      calls: [
        '/audio/whale/call-1.mp3',
        '/audio/whale/call-2.mp3',
        '/audio/whale/call-3.mp3',
        '/audio/whale/call-4.mp3',
        '/audio/whale/call-5.mp3',
      ],
      taps: [
        '/audio/whale/tap-1.mp3',
        '/audio/whale/tap-2.mp3',
        '/audio/whale/tap-3.mp3',
      ],
      ambience: '/audio/whale/ambience.mp3',
    },
    source: ModelSource.gltf('/models/Ballena_Ani.glb'),
    animation: {
      // Nada siempre. Al tocarla salta fuera del agua, gira sobre el lomo y
      // cae con un salpicón: es el `Jump` del diseñador, domado por
      // `tameBreach` para que quepa en el mapa, y a casi el doble de
      // velocidad —el original tarda diez segundos—.
      steps: [
        { name: 'Swin', loops: 1 },
      ],
      entranceClip: 'Swin',
      tapClip: 'Jump',
      tapSpeed: 1.8,
      tapMove: 'breach',
    },
    // El punto queda dentro del dibujo de la ballena; un poco más abajo que
    // su centro para que la silueta 3D no rebase el borde en perspectiva.
    spot: { u: 0.304, v: 0.19 },
    // De frente, como los otros tres: los cuatro miran a quien sostiene el
    // teléfono. Se probó de perfil porque de frente su largo apunta a la
    // cámara, pero lo que se veía "demasiado grande" era el PRIMER PLANO, no
    // el mapa: allí el tamaño lo acota ahora `STAGE_MAX_WIDTH` contando la
    // perspectiva, y `focusSize` la deja bastante por debajo de ese tope:
    // los clientes la seguían viendo salirse del encuadre en primer plano.
    // Sobre el mapa, en cambio, se pidió MÁS grande: es el animal más grande
    // del mapa y tiene que leerse así junto a los otros tres.
    view: 'front',
    iconSize: 2.1,
    focusSize: 0.7,
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
      { u: 0.151, v: 0.1585 }, { u: 0.168, v: 0.1376 }, { u: 0.185, v: 0.0391 }, { u: 0.202, v: 0.037 },
      { u: 0.219, v: 0.0419 }, { u: 0.236, v: 0.0489 }, { u: 0.253, v: 0.0601 }, { u: 0.27, v: 0.0733 },
      { u: 0.287, v: 0.088 }, { u: 0.304, v: 0.0908 }, { u: 0.321, v: 0.0915 }, { u: 0.338, v: 0.0922 },
      { u: 0.355, v: 0.0943 }, { u: 0.372, v: 0.0971 }, { u: 0.389, v: 0.0992 }, { u: 0.406, v: 0.1061 },
      { u: 0.423, v: 0.1103 }, { u: 0.44, v: 0.1173 }, { u: 0.457, v: 0.1229 }, { u: 0.457, v: 0.1439 },
      { u: 0.44, v: 0.148 }, { u: 0.423, v: 0.1494 }, { u: 0.406, v: 0.1508 }, { u: 0.389, v: 0.1543 },
      { u: 0.372, v: 0.1571 }, { u: 0.355, v: 0.1599 }, { u: 0.338, v: 0.1613 }, { u: 0.321, v: 0.169 },
      { u: 0.304, v: 0.1816 }, { u: 0.287, v: 0.1948 }, { u: 0.27, v: 0.2053 }, { u: 0.253, v: 0.2123 },
      { u: 0.236, v: 0.2165 }, { u: 0.219, v: 0.1704 }, { u: 0.202, v: 0.1753 }, { u: 0.185, v: 0.183 },
      { u: 0.168, v: 0.1865 }, { u: 0.151, v: 0.1795 },
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
    name: 'Pava',
    species: 'Penelope ortoni / Pava del Chocó',
    description: [
      'Endémica del Chocó biogeográfico: no existe en ningún otro lugar del planeta. ' +
        'Su canto anuncia que el bosque está sano.',
      'Dispersa las semillas de los árboles gigantes al comer sus frutos. ' +
        'Cada vuelo suyo siembra selva.',
    ],
    // No hay grabaciones abiertas de Penelope ortoni (las de xeno-canto no se
    // pueden descargar sin cuenta): son pavas del MISMO GÉNERO, de los Andes
    // de Colombia y Ecuador, cuyo llamado es muy parecido. El ambiente sí es
    // selva del Chocó.
    soundscape: {
      calls: [
        '/audio/bird/call-1.mp3',
        '/audio/bird/call-2.mp3',
        '/audio/bird/call-3.mp3',
        '/audio/bird/call-4.mp3',
        '/audio/bird/call-5.mp3',
      ],
      taps: [
        '/audio/bird/tap-1.mp3',
        '/audio/bird/tap-2.mp3',
      ],
      ambience: '/audio/bird/ambience.mp3',
    },
    source: ModelSource.gltf('/models/Pava_Ani.glb'),
    animation: {
      // Siempre en Idle (más el balanceo de MarkerPin, porque Idle apenas
      // mueve huesos). El canto —salta, estira el cuello, mueve la cabeza—
      // se reserva para la entrada y el toque: si también fuera parte del
      // bucle, tocarla no haría nada que no hiciera ya sola.
      steps: [
        { name: 'Idle', loops: 1 },
      ],
      entranceClip: 'Idle',
      tapClip: 'Sing',
      tapSpeed: 1.2,
    },
    spot: { u: 0.9075, v: 0.5098 },
    // Dibujo: 0.121 x 0.098. Se mantiene menor que la ballena, pero con
    // presencia suficiente para que la animación Sing se lea en teléfono.
    view: 'front',
    iconSize: 1.55,
    facing: 0,
    // Dibujada de perfil, de pie sobre la hierba y mirando a la IZQUIERDA
    // del mapa. Contorno calcado del dibujo: el marrón de la pava contra el
    // verde de la hierba.
    outlineShape: [
      { u: 0.841, v: 0.4686 }, { u: 0.848, v: 0.4637 }, { u: 0.855, v: 0.4637 }, { u: 0.862, v: 0.4658 },
      { u: 0.869, v: 0.4881 }, { u: 0.876, v: 0.486 }, { u: 0.883, v: 0.4839 }, { u: 0.89, v: 0.4832 },
      { u: 0.897, v: 0.4839 }, { u: 0.904, v: 0.4846 }, { u: 0.911, v: 0.486 }, { u: 0.918, v: 0.4874 },
      { u: 0.925, v: 0.4881 }, { u: 0.932, v: 0.4895 }, { u: 0.939, v: 0.4916 }, { u: 0.946, v: 0.4944 },
      { u: 0.953, v: 0.4972 }, { u: 0.96, v: 0.5 }, { u: 0.967, v: 0.5035 }, { u: 0.974, v: 0.5126 },
      { u: 0.974, v: 0.5279 }, { u: 0.967, v: 0.5244 }, { u: 0.96, v: 0.5251 }, { u: 0.953, v: 0.5265 },
      { u: 0.946, v: 0.5258 }, { u: 0.939, v: 0.5293 }, { u: 0.932, v: 0.5454 }, { u: 0.925, v: 0.5559 },
      { u: 0.918, v: 0.5391 }, { u: 0.911, v: 0.5335 }, { u: 0.904, v: 0.5321 }, { u: 0.897, v: 0.5419 },
      { u: 0.89, v: 0.5468 }, { u: 0.883, v: 0.5496 }, { u: 0.876, v: 0.5545 }, { u: 0.869, v: 0.5524 },
      { u: 0.862, v: 0.5517 }, { u: 0.855, v: 0.5161 }, { u: 0.848, v: 0.5105 }, { u: 0.841, v: 0.4714 },
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
    name: 'Cangrejo',
    species: 'Gecarcinus quadratus / Cangrejo',
    description: [
      'Naranja fuego sobre patas de tierra: nace en el mar pero vive en la selva. ' +
        'Baja a la orilla solo para dejar su descendencia en las olas.',
      'Cava túneles que airean el suelo del bosque costero. Cada madriguera suya ' +
        'ayuda a que el manglar respire.',
    ],
    // Un cangrejo no tiene voz: suena al moverse. Sus pasos (uno de ellos,
    // recreado) y, de fondo, la playa con el manglar detrás.
    soundscape: {
      calls: [
        '/audio/crab/call-1.mp3',
        '/audio/crab/call-2.mp3',
        '/audio/crab/call-3.mp3',
      ],
      taps: [
        '/audio/crab/tap-1.mp3',
        '/audio/crab/tap-2.mp3',
      ],
      ambience: '/audio/crab/ambience.mp3',
    },
    source: ModelSource.gltf('/models/Cangrejo_Ani.glb'),
    animation: {
      // Ratos quieto y ratos caminando. Al tocarlo, el mismo Walk pero a
      // más del doble de velocidad y correteando de lado a saltitos.
      steps: [
        { name: 'Idle', loops: 4 },
        { name: 'Walk', loops: 2 },
      ],
      entranceClip: 'Walk',
      tapClip: 'Walk',
      tapSpeed: 2.4,
      tapLoops: 4,
      tapMove: 'scuttle',
    },
    spot: { u: 0.618, v: 0.4022 },
    // Ya se veía de frente; 'front' es exactamente la misma orientación
    // que tenía con 'side' + 90°, escrita de forma directa.
    view: 'front',
    // Algo mayor que su dibujo (0.08), que en pantalla se quedaba en nada.
    iconSize: 0.95,
    facing: 0,
    // Dibujado en planta, como se ve un cangrejo en la arena, con los ojos
    // y las pinzas hacia ARRIBA del mapa. Visto desde arriba el modelo mira
    // hacia abajo, de ahí la media vuelta.
    //
    // Contorno calcado del dibujo: el naranja del caparazón contra la arena.
    // Entran el cuerpo y las patas, no las antenas —demasiado finas para que
    // una columna de píxeles las distinga del fondo.
    outlineShape: [
      { u: 0.576, v: 0.3918 }, { u: 0.583, v: 0.3897 }, { u: 0.59, v: 0.3918 }, { u: 0.597, v: 0.3925 },
      { u: 0.604, v: 0.3848 }, { u: 0.611, v: 0.382 }, { u: 0.618, v: 0.3841 }, { u: 0.625, v: 0.3827 },
      { u: 0.632, v: 0.3855 }, { u: 0.639, v: 0.3939 }, { u: 0.646, v: 0.3932 }, { u: 0.653, v: 0.3911 },
      { u: 0.66, v: 0.3932 }, { u: 0.66, v: 0.4099 }, { u: 0.653, v: 0.4225 }, { u: 0.646, v: 0.4155 },
      { u: 0.639, v: 0.4134 }, { u: 0.632, v: 0.412 }, { u: 0.625, v: 0.4043 }, { u: 0.618, v: 0.4043 },
      { u: 0.611, v: 0.4043 }, { u: 0.604, v: 0.4085 }, { u: 0.597, v: 0.4113 }, { u: 0.59, v: 0.4162 },
      { u: 0.583, v: 0.4022 }, { u: 0.576, v: 0.4085 },
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
    name: 'Tortuga carey',
    species: 'Eretmochelys imbricata / Tortuga carey',
    description: [
      'Navega los océanos por 50 años y siempre recuerda el camino de vuelta. ' +
        'Su caparazón, de escamas que se montan como tejas, es único: no hay dos ' +
        'iguales en todo el mar.',
      'Es la jardinera de los arrecifes: con su pico curvo como el de un ave come ' +
        'esponjas que nadie más toca, y así mantiene vivo el coral. Sin ella, el ' +
        'arrecife se ahoga.',
      'Puede cruzar océanos enteros guiándose por el campo magnético de la Tierra, ' +
        'como una brújula viva. Lleva más de cien millones de años surcando estos ' +
        'mares, desde mucho antes que nosotros.',
    ],
    // Tampoco tiene voz: burbujas bajo el agua, el sonido de sumergirse para
    // su buceo y, de fondo, un hidrófono en un arrecife del Caribe.
    soundscape: {
      calls: [
        '/audio/turtle/call-1.mp3',
        '/audio/turtle/call-2.mp3',
        '/audio/turtle/call-3.mp3',
      ],
      taps: [
        '/audio/turtle/tap-1.mp3',
        '/audio/turtle/tap-2.mp3',
      ],
      ambience: '/audio/turtle/ambience.mp3',
    },
    source: ModelSource.gltf('/models/Tortuga_Ani.glb'),
    animation: {
      // Nada y descansa. Al tocarla da una vuelta, se sumerge y vuelve a
      // salir, braceando al doble mientras tanto.
      steps: [
        { name: 'Swin', loops: 3 },
        { name: 'Idle', loops: 4 },
      ],
      entranceClip: 'Swin',
      tapClip: 'Swin',
      tapSpeed: 2,
      tapLoops: 3,
      tapMove: 'dive',
    },
    spot: { u: 0.3375, v: 0.5335 },
    // De frente es una silueta baja y ancha —una tortuga lo es—, así que
    // se agranda por encima de su dibujo para que no quede como una raya.
    view: 'front',
    iconSize: 1.23,
    facing: 0,
    // Dibujada nadando, vista desde arriba y con la cabeza hacia la
    // IZQUIERDA del mapa; desde arriba el modelo mira hacia abajo.
    //
    // Contorno calcado del dibujo: el verde oliva de la tortuga contra el
    // mar crema. Va en diagonal, con las aletas extendidas, que es justo lo
    // que una silueta deducida del modelo no acertaba a dar.
    outlineShape: [
      { u: 0.244, v: 0.5286 }, { u: 0.255, v: 0.4916 }, { u: 0.266, v: 0.4958 }, { u: 0.277, v: 0.5042 },
      { u: 0.288, v: 0.5154 }, { u: 0.299, v: 0.523 }, { u: 0.31, v: 0.5203 }, { u: 0.321, v: 0.5161 },
      { u: 0.332, v: 0.5126 }, { u: 0.343, v: 0.5084 }, { u: 0.354, v: 0.5056 }, { u: 0.365, v: 0.5028 },
      { u: 0.376, v: 0.5007 }, { u: 0.387, v: 0.53 }, { u: 0.398, v: 0.5349 }, { u: 0.409, v: 0.544 },
      { u: 0.42, v: 0.5587 }, { u: 0.431, v: 0.5726 }, { u: 0.431, v: 0.5754 }, { u: 0.42, v: 0.5754 },
      { u: 0.409, v: 0.5726 }, { u: 0.398, v: 0.5677 }, { u: 0.387, v: 0.5615 }, { u: 0.376, v: 0.5622 },
      { u: 0.365, v: 0.5705 }, { u: 0.354, v: 0.5684 }, { u: 0.343, v: 0.5635 }, { u: 0.332, v: 0.5622 },
      { u: 0.321, v: 0.5615 }, { u: 0.31, v: 0.5594 }, { u: 0.299, v: 0.5559 }, { u: 0.288, v: 0.5517 },
      { u: 0.277, v: 0.5461 }, { u: 0.266, v: 0.5433 }, { u: 0.255, v: 0.5419 }, { u: 0.244, v: 0.5363 },
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
