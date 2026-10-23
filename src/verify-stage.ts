/**
 * Página de verificación del PRIMER PLANO (solo desarrollo, como
 * verify.html: `vite build` no la empaqueta).
 *
 * Responde a lo que verify.html no puede: cómo se ve un animal cuando se
 * planta delante de la cámara. Aquí no hay copias ni imitaciones: se monta
 * el `ThreeSceneAdapter` real —el que añade la iluminación de tres puntos,
 * el tone mapping y el encuadre en tres cuartos— sobre un runtime de mentira
 * con la cámara fija en el origen mirando hacia −Z, exactamente como la
 * pone MindAR. El arrastre es el `PointerInteractionAdapter` real, así que
 * también se comprueba que girar un animal no gira a los demás.
 */
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { ArModel } from '@domain/entities/ArModel';
import { Placement } from '@domain/entities/Placement';
import { Discovery } from '@domain/value-objects/Discovery';
import { ModelId } from '@domain/value-objects/ModelId';
import { Scale } from '@domain/value-objects/Scale';
import { PointerInteractionAdapter } from '@infrastructure/interaction/PointerInteractionAdapter';
import { ThreeSceneAdapter } from '@infrastructure/rendering/ThreeSceneAdapter';
import { NUQUI_CATALOG } from '@infrastructure/repositories/StaticModelRepository';

const TARGET_ASPECT = 1432 / 1000;

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const nav = document.querySelector<HTMLElement>('#animals');
if (canvas === null || nav === null) throw new Error('Faltan #stage o #animals');

// `?zoom=2` agranda el teléfono (y su resolución) para mirar la luz de cerca.
const zoom = Number(new URLSearchParams(window.location.search).get('zoom') ?? 1) || 1;
const phone = document.querySelector<HTMLElement>('#phone');
if (phone !== null && zoom !== 1) {
  phone.style.transformOrigin = 'top left';
  phone.style.transform = `scale(${zoom})`;
}

const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * zoom);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

const scene = new Scene();
const camera = new PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.01, 100);

let frame: (delta: number) => unknown = () => undefined;
const mindar = { scene, camera, renderer };
const runtime = {
  prepare: async () => {},
  init: () => mindar,
  mindar,
  onFrame: (fn: (delta: number) => unknown) => {
    frame = fn;
    return () => {};
  },
  anchorVisible: false,
  anchor: { group: new Group() },
  isInitialized: true,
};

// `?mapa=1`: los animales del MAPA, detrás del primer plano, como los pone
// MindAR (un ancla delante de la cámara, algo inclinada), todos descubiertos.
// Sirve para mirar qué hacen los demás mientras uno está abierto (vuelven a
// su dibujo, ver MarkerPin.setReceded). `closeStage()` cierra la ficha.
const withMap = new URLSearchParams(window.location.search).has('mapa');
if (withMap) {
  runtime.anchor.group.position.set(0, -0.1, -1.4);
  runtime.anchor.group.rotation.x = -0.55;
  runtime.anchor.group.updateMatrixWorld(true);
  runtime.anchorVisible = true;
}

const models = NUQUI_CATALOG.map((snapshot) => ArModel.fromSnapshot(snapshot));
const adapter = new ThreeSceneAdapter(runtime as never, TARGET_ASPECT);
let placement = Placement.initial(models[0]!.id, Scale.default());
let discovery = Discovery.empty();

function show(id: string): void {
  if (withMap) for (const model of models) discovery = discovery.unlock(model.id).focus(null);
  discovery = discovery.unlock(ModelId.of(id));
  adapter.applyDiscovery(discovery);
  for (const button of nav!.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', button.dataset['id'] === id ? 'true' : 'false');
  }
  render();
}

function render(): void {
  renderer.render(scene, camera);
}

await adapter.preload(models);
adapter.applyPlacement(placement);

for (const model of models) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset['id'] = model.id.value;
  button.textContent = model.name;
  button.addEventListener('click', () => show(model.id.value));
  nav.append(button);
}

new PointerInteractionAdapter(runtime as never, adapter).attach({
  onTapModel: (id, instance) => adapter.pulse(ModelId.of(id), instance),
  onTapText: () => {},
  onRotate: (id, yaw, pitch) => {
    placement = placement.rotatedBy(ModelId.of(id), yaw, pitch);
    adapter.applyPlacement(placement);
  },
});

show(new URLSearchParams(window.location.search).get('animal') ?? 'whale');

Object.assign(window, {
  stageScene: scene,
  stageAdapter: adapter,
  showStage: show,
  closeStage: () => {
    discovery = discovery.focus(null);
    adapter.applyDiscovery(discovery);
  },
  stepStage: (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) frame(1 / 60);
    render();
  },
});

let last = performance.now();
function loop(): void {
  const now = performance.now();
  frame(Math.min((now - last) / 1000, 0.1));
  last = now;
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
