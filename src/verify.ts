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
  Mesh,
  MeshBasicMaterial,
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

const TARGET_ASPECT = 1280 / 880;
const MAP_URL = '/targets/map.jpg';

const scene = new Scene();
addLights(scene);
scene.add(new AmbientLight(0xffffff, 0.35));

// El mapa, exactamente como lo ve MindAR: centrado en el origen, de 1
// unidad de ancho, en el plano XY.
const texture = new TextureLoader().load(MAP_URL);
texture.colorSpace = SRGBColorSpace;
scene.add(new Mesh(new PlaneGeometry(1, TARGET_ASPECT), new MeshBasicMaterial({ map: texture })));

// Se usa el MISMO IconLoader que la app: si un .glb no carga, o carga con
// mala escala o mal pivote, aquí se ve exactamente igual que en el teléfono.
// Antes esta página forzaba las figuras procedurales, así que dejó de
// verificar nada en cuanto el catálogo pasó a .glb.
const icons = new IconLoader();
const pins: MarkerPin[] = [];

const ready = Promise.all(
  NUQUI_CATALOG.map(async (snapshot, index) => {
    const model = ArModel.fromSnapshot(snapshot);
    const pin = new MarkerPin(
      model.id.value,
      model.spot,
      await icons.load(model),
      index,
      TARGET_ASPECT,
    );
    scene.add(pin.group);
    return [index, pin] as const;
  }),
);

// Los .glb llegan de forma asíncrona: se ordenan al final para que el
// desfase del vaivén siga correspondiendo al orden del catálogo.
void ready.then((loaded) => {
  for (const [index, pin] of loaded) pins[index] = pin;
  // Se destaca uno para comprobar de un vistazo que el resaltado funciona.
  pins[0]?.highlight(true);
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
