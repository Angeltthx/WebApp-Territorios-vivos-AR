import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Iluminación de tres puntos para los cuatro animales, la de un plató:
 *
 *   - PRINCIPAL (key): la que modela la forma. Desde arriba a la derecha
 *     y por delante: ilumina tres cuartas partes del animal y deja la otra
 *     en sombra, que es lo que hace que se lea como volumen y no como
 *     silueta. Cálida.
 *   - RELLENO (fill): desde el lado contrario, casi a la altura de los
 *     ojos, a algo menos de un tercio de la principal. No elimina la
 *     sombra, la abre: se sigue viendo qué lado está en sombra, pero con
 *     detalle. Fría, como el cielo que rebota en el agua, para que el
 *     contraste sea también de temperatura.
 *   - CONTRA (back/rim): desde detrás del animal, arriba a la izquierda
 *     —en diagonal opuesta a la principal, como manda el esquema—. Dibuja
 *     un filo de luz en el borde del lomo, la cabeza y las aletas que lo
 *     SEPARA del fondo: sobre la cámara, con el mapa detrás, es lo que hace
 *     que el animal flote delante en vez de parecer pegado al papel.
 *
 * Más una hemisférica muy baja, solo para que ninguna sombra caiga a negro.
 *
 * Una primera versión (principal 2.4, relleno 1.05, contra 2.6 más atrás,
 * hemisférica 0.55) era correcta pero no se notaba: el relleno y la
 * hemisférica juntos casi igualaban a la principal y la luz volvía a ser
 * plana. El salto de ahora está en la PROPORCIÓN principal:relleno, cerca
 * de 3.5:1, la de un retrato con volumen sin llegar a ser dramático, y en
 * el perfilado del contraluz (`addRimShading`).
 *
 * LA SEGUNDA VERSIÓN (principal 3.4, relleno 1.0, contraluz 5.5 desde
 * arriba a la izquierda, hemisférica 0.3) tenía volumen pero "la dirección
 * de la luz se veía mal puesta", y la razón era medible: el contraluz, más
 * fuerte que la principal y con bastante altura, iluminaba el LOMO más que
 * ella (0.52 × 5.5 ≈ 2.9 frente a 0.66 × 3.4 ≈ 2.2 en una cara que mira
 * hacia arriba). Resultado: dos soles, uno a cada lado, con el lomo y la
 * aleta dorsal lavados desde atrás a la izquierda y la cara, que es lo que
 * se mira, en penumbra. Y con una hemisférica tan baja, la cara inferior de
 * las aletas caía a negro, que en exteriores no pasa nunca: el cielo
 * rellena. Ahora:
 *
 *   - UN sol que manda, arriba a la derecha y algo por delante, más alto que
 *     antes: es la dirección de la luz de una escena real (el sol, una
 *     lámpara de techo), y ninguna otra luz ilumina el lomo más que él
 *     (`npm test` lo comprueba).
 *   - El cielo como relleno: hemisférica más alta, azulada arriba y con el
 *     rebote verdoso del agua abajo, más un mapa de entorno suave
 *     (`addEnvironment`) que da a los materiales PBR los reflejos que sin
 *     él no tienen y que son buena parte de por qué parecían de plástico.
 *   - El contraluz se queda DETRÁS y bajo: dibuja el filo sin competir con
 *     el sol por el lomo.
 *
 * Las direcciones son relativas a la CÁMARA: en MindAR la cámara está fija
 * en el origen mirando hacia −Z (lo que se mueve es el mapa), así que el
 * mundo es el espacio de la cámara y el esquema se mantiene aunque el
 * teléfono gire alrededor del mapa. La página de verificación mira en la
 * misma dirección y ve lo mismo.
 */

/** De dónde viene el contraluz. Lo comparten la luz y el perfilado. */
const RIM_FROM = new Vector3(-0.9, 0.45, -1.7);
const RIM_COLOUR = 0xfff4e6;

export function addThreePointLighting(scene: Object3D): void {
  // El cielo: claro y algo azul arriba, rebote verdoso del agua abajo.
  const sky = new HemisphereLight(0xdfe9ff, 0x3d4a40, 1.05);
  sky.name = 'cielo';
  scene.add(sky);

  // El sol: arriba a la derecha, por delante, cálido.
  const key = new DirectionalLight(0xfff0da, 2.7);
  key.name = 'luz-principal';
  key.position.set(1.2, 2.1, 1.3);
  scene.add(key);

  const fill = new DirectionalLight(0xd8e6ff, 0.8);
  fill.name = 'luz-relleno';
  fill.position.set(-1.7, 0.2, 1.1);
  scene.add(fill);

  const rim = new DirectionalLight(RIM_COLOUR, 1.6);
  rim.name = 'contraluz';
  rim.position.copy(RIM_FROM);
  scene.add(rim);
}

/** Cuánto brilla el filo del contraluz, y lo fino que es (más alto = más fino). */
const RIM_STRENGTH = 0.38;
const RIM_POWER = 3;
/**
 * Cuánto pesa el mapa de entorno en los animales. Lo justo para que el lomo
 * mojado de la ballena o el caparazón de la tortuga tengan un reflejo; más
 * alto aplana la luz, porque el entorno ilumina desde todas partes.
 */
const ENVIRONMENT_STRENGTH = 0.45;

/**
 * Un entorno de estudio neutro (el `RoomEnvironment` de three, filtrado con
 * PMREM) como reflejo y luz de fondo de los materiales PBR. Se genera una
 * vez, en la GPU, al montar la escena: unos milisegundos.
 *
 * Solo con un renderer WebGL de verdad: las pruebas montan la escena con
 * uno de mentira.
 */
export function addEnvironment(renderer: unknown, scene: Scene): void {
  if (!(renderer instanceof WebGLRenderer)) return;
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
}

/**
 * El perfilado del contraluz: un filo de luz que sigue la SILUETA del
 * animal por el lado del que viene el contraluz.
 *
 * Hace falta porque a los animales casi siempre se les ve de frente, y una
 * luz direccional que viene de detrás solo toca las pocas caras que miran
 * hacia atrás: en pantalla el contraluz apenas se notaba. Es la técnica
 * habitual en animación y videojuegos (un término de Fresnel): crece en los
 * bordes, donde la superficie se pone de canto respecto a la cámara, y se
 * limita al lado que mira hacia el contraluz, así que sigue siendo UNA
 * luz, coherente con las otras dos, y no un halo alrededor de todo.
 *
 * Se suma como emisión, con el color del contraluz, a los materiales PBR
 * del modelo. `customProgramCacheKey` separa el shader modificado del de
 * los materiales normales (el contorno, el agua, los puntos de texto).
 */
export function addRimShading(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof MeshStandardMaterial) applyRim(material);
    }
  });
}

function applyRim(material: MeshStandardMaterial): void {
  material.envMapIntensity = ENVIRONMENT_STRENGTH;
  material.onBeforeCompile = (shader) => {
    shader.uniforms['rimFrom'] = { value: RIM_FROM.clone().normalize() };
    shader.uniforms['rimColour'] = { value: new Color(RIM_COLOUR) };
    shader.uniforms['rimStrength'] = { value: RIM_STRENGTH };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 rimFrom;\nuniform vec3 rimColour;\nuniform float rimStrength;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          // `normal` y `vViewPosition` están en espacio de vista: el
          // contraluz se pasa a ese espacio para que funcione con cualquier
          // cámara, también la inclinada de verify.html.
          'vec3 rimToCamera = normalize(vViewPosition);',
          'vec3 rimLight = normalize((viewMatrix * vec4(rimFrom, 0.0)).xyz);',
          `float rimEdge = pow(1.0 - saturate(dot(normal, rimToCamera)), ${RIM_POWER.toFixed(2)});`,
          'float rimSide = smoothstep(-0.1, 0.6, dot(normal, rimLight));',
          'totalEmissiveRadiance += rimColour * rimEdge * rimSide * rimStrength;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'perfilado-contraluz-2';
  material.needsUpdate = true;
}
