/**
 * Página de verificación (solo desarrollo — `vite build` no la empaqueta,
 * porque solo index.html es punto de entrada).
 *
 * Responde a una pregunta que en el teléfono cuesta mucho contestar:
 * ¿cada icono cae realmente encima de su animal?
 *
 * Monta los MISMOS MarkerPin que usa la app sobre una foto del mapa,
 * colocada en el plano y con el tamaño exactos del anchor de MindAR
 * (ancho = 1 unidad, alto = targetAspect). Con la cámara ortográfica y de
 * frente no hay perspectiva, así que si el halo de un pin no coincide con
 * su animal, es que las coordenadas están mal.
 *
 * Vista izquierda: ortográfica de frente → comprobación de coordenadas.
 * Vista derecha:   en perspectiva y ladeada → cómo se ven flotando.
 */
import {
  AmbientLight,
  Box3,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
} from 'three';
import { ArModel } from '@domain/entities/ArModel';
import { addLights } from '@infrastructure/rendering/ThreeSceneAdapter';
import { IconLoader } from '@infrastructure/rendering/IconLoader';
import { MarkerPin } from '@infrastructure/rendering/MarkerPin';
import { NUQUI_CATALOG } from '@infrastructure/repositories/StaticModelRepository';

const TARGET_ASPECT = 1432 / 1000;
const MAP_URL = '/targets/map.jpg';

/**
 * Cuánto tarda esta página en revelar los cuatro animales.
 *
 * Se puede fijar por URL —`/verify.html?reveal=99999`— para dejar los
 * CONTORNOS punteados quietos en pantalla y comprobar con calma que cada
 * uno encuadra a su animal. Sin esto solo se ven durante dos segundos y no
 * hay forma de medirlos.
 */
const REVEAL_DELAY_MS = Number(
  new URLSearchParams(window.location.search).get('reveal') ?? 2500,
);

const scene = new Scene();
addLights(scene);
scene.add(new AmbientLight(0xffffff, 0.35));

// El mapa, exactamente como lo ve MindAR: centrado en el origen, de 1
// unidad de ancho, en el plano XY.
const texture = new TextureLoader().load(MAP_URL);
texture.colorSpace = SRGBColorSpace;
// La app usa vídeo de cámara como fondo, sin una malla que tape las partes
// del animal situadas detrás del papel. La vista de prueba debe hacer igual.
scene.add(new Mesh(
  new PlaneGeometry(1, TARGET_ASPECT),
  new MeshBasicMaterial({ map: texture, depthWrite: false }),
));

// Se usa el MISMO IconLoader que la app: si un .glb no carga, o carga con
// mala escala o mal pivote, aquí se ve exactamente igual que en el teléfono.
// Antes esta página forzaba las figuras procedurales, así que dejó de
// verificar nada en cuanto el catálogo pasó a .glb.
const icons = new IconLoader();
const pins: MarkerPin[] = [];

const ready = Promise.all(
  NUQUI_CATALOG.map(async (snapshot, index) => {
    const model = ArModel.fromSnapshot(snapshot);
    const pin = new MarkerPin(model, await icons.load(model), index, TARGET_ASPECT);
    scene.add(pin.group);
    return [index, pin] as const;
  }),
).finally(() => icons.dispose());

// Los .glb llegan de forma asíncrona: se ordenan al final para que el
// desfase del vaivén siga correspondiendo al orden del catálogo.
void ready.then((loaded) => {
  for (const [index, pin] of loaded) pins[index] = pin;
  // En la app los animales salen escondidos tras su contorno y solo
  // aparecen cuando la camara se acerca. Aqui no hay camara que acercar, y
  // lo que se viene a verificar son las COORDENADAS, asi que se revelan los
  // cuatro a mano. El contorno punteado se sigue viendo durante la
  // animacion de entrada, que de paso deja comprobar que encuadra bien.
  // Se destaca uno para comprobar de un vistazo que el resaltado funciona.
  pins[0]?.highlight(true);

  // Los cuatro se revelan tras una pausa, no al instante: los primeros
  // segundos enseñan los CONTORNOS punteados —que es lo que ve el usuario
  // antes de acercarse— y el resto de la sesión enseña los modelos, que es
  // lo que esta página existe para verificar. De paso se ve la bocanada de
  // humo, imposible de comprobar en el teléfono sin el mapa impreso.
  window.setTimeout(() => {
    for (const [, pin] of loaded) pin.setRevealed(true);
  }, REVEAL_DELAY_MS);
});

const half = TARGET_ASPECT / 2;
const flat = new OrthographicCamera(-0.5, 0.5, half, -half, 0.01, 10);
flat.position.set(0, 0, 3);

const angled = new PerspectiveCamera(38, 1 / TARGET_ASPECT, 0.01, 10);
angled.position.set(0.75, -1.5, 1.85);
angled.lookAt(0, 0, 0);

function mount(id: string, camera: OrthographicCamera | PerspectiveCamera): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>(`#${id}`);
  if (canvas === null) throw new Error(`Falta el canvas #${id}`);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  return () => renderer.render(scene, camera);
}

const draw = [mount('flat', flat), mount('angled', angled)];

// Permite comprobar el gesto de toque y sus efectos sin cámara ni mapa
// impreso. La vista ortográfica comparte el sistema normalizado del catálogo.
document.querySelector<HTMLCanvasElement>('#flat')?.addEventListener('click', (event) => {
  const rect = event.currentTarget instanceof HTMLCanvasElement
    ? event.currentTarget.getBoundingClientRect()
    : null;
  if (rect === null) return;
  const u = (event.clientX - rect.left) / rect.width;
  const v = (event.clientY - rect.top) / rect.height;
  let nearest = -1;
  let distance = 0.13;
  NUQUI_CATALOG.forEach((model, index) => {
    const candidate = Math.hypot(u - model.spot.u, (v - model.spot.v) * TARGET_ASPECT);
    if (candidate < distance) {
      nearest = index;
      distance = candidate;
    }
  });
  if (nearest >= 0 && pins[nearest]?.isRevealed) pins[nearest]!.pulse();
});

// Calibrar `iconSize` es medir, no calcular (ver CLAUDE.md): desde la
// consola, `measureIcons()` da lo que ocupa cada animal en la vista
// ortográfica, en anchos de mapa, para compararlo con su dibujo.
Object.assign(window, {
  measureIcons: () => pins.map((pin, index) => {
    let icon: Object3D | null = null;
    pin.group.traverse((node) => {
      if (node !== pin.group && node.userData['modelId'] !== undefined) icon = node;
    });
    const size = icon === null ? new Vector3() : new Box3().setFromObject(icon).getSize(new Vector3());
    return { id: NUQUI_CATALOG[index]?.id, ancho: +size.x.toFixed(3), alto: +size.y.toFixed(3) };
  }),
  // Una pestaña en segundo plano no ejecuta requestAnimationFrame, así que
  // una animación no se puede fotografiar a mitad. `tap('whale')` y luego
  // `stepVerify(1.2)` la dejan exactamente en ese instante.
  tap: (id: string) => pins[NUQUI_CATALOG.findIndex((model) => model.id === id)]?.pulse(),
  stepVerify: (seconds: number) => {
    const frame = 1 / 60;
    for (let t = 0; t < seconds; t += frame) {
      elapsed += frame;
      for (const pin of pins) pin.advance(frame, elapsed);
    }
    last = performance.now();
    for (const render of draw) render();
  },
});

let last = performance.now();
let elapsed = 0;

renderer();
function renderer(): void {
  const now = performance.now();
  const delta = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += delta;

  for (const pin of pins) pin.advance(delta, elapsed);
  for (const render of draw) render();

  requestAnimationFrame(renderer);
}
