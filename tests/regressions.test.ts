import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StartArExperience } from '../src/application/use-cases/StartArExperience';
import { PlayModelSound } from '../src/application/use-cases/PlayModelSound';
import { ArSession } from '../src/domain/entities/ArSession';
import { ArModel } from '../src/domain/entities/ArModel';
import { ModelId } from '../src/domain/value-objects/ModelId';
import { Placement } from '../src/domain/entities/Placement';
import { ModelSource } from '../src/domain/value-objects/ModelSource';
import { AnimationSequence } from '../src/domain/value-objects/AnimationSequence';
import { Proximity } from '../src/domain/value-objects/Proximity';
import { ThreeSceneAdapter } from '../src/infrastructure/rendering/ThreeSceneAdapter';
import { IconAnimator } from '../src/infrastructure/rendering/IconAnimator';
import { MarkerPin } from '../src/infrastructure/rendering/MarkerPin';
import { fitToIconSize, tameBreach } from '../src/infrastructure/rendering/IconLoader';
import { TapChoreography } from '../src/infrastructure/rendering/TapChoreography';
import { MindArTrackingAdapter } from '../src/infrastructure/tracking/MindArTrackingAdapter';
import { CameraPermissionDeniedError } from '../src/application/ports/TrackingPort';
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  VectorKeyframeTrack,
} from 'three';

const model = ArModel.fromSnapshot({
  id: 'whale', name: 'Ballena', description: 'Ficha',
  source: ModelSource.primitive('whale', 0x224466), spot: { u: 0.5, v: 0.5 },
  outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
  sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
});
const models = { findAll: async () => [model], findById: async () => model };
const analytics = { track() {} };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

function harness() {
  const handlers = new Map<string, Set<() => void>>();
  const calls = { starts: 0, stops: 0, loads: 0, unlocks: 0 };
  const tracking = {
    isSupported: async () => true, prewarm() {}, confirmAnchor() {},
    start: async () => { calls.starts++; },
    stop: async () => { calls.stops++; },
    on(event: string, handler: () => void) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler); handlers.set(event, set);
      return () => { set.delete(handler); };
    },
  };
  const scene = {
    preload: async () => { calls.loads++; }, setHighlightedModel() {},
    applyPlacement() {}, setStabilization() {}, setProximity() {},
    applyDiscovery() {}, onNearbyModel() {}, pulse() {}, clear() {}, dispose() {},
  };
  const audio = { unlock: async () => { calls.unlocks++; }, play() {}, dispose() {} };
  const app = new StartArExperience(tracking, scene, audio, models, analytics, () => {});
  return { app, tracking, scene, audio, calls, handlers };
}

test('doble inicio comparte operación y desbloquea audio antes del primer await', async () => {
  const h = harness();
  const gate = deferred();
  h.scene.preload = () => gate.promise;
  const first = h.app.execute('whale');
  assert.equal(h.calls.unlocks, 1);
  const second = h.app.execute('whale');
  assert.equal(first, second);
  gate.resolve();
  assert.equal((await first).status, 'searching');
  assert.equal(h.calls.starts, 1);
});

test('fallo de cámara limpia eventos; reintentar registra una sola suscripción', async () => {
  const h = harness();
  h.tracking.start = async () => { throw new Error('cámara'); };
  assert.equal((await h.app.execute('whale')).status, 'error');
  assert.equal(h.handlers.get('anchor-found')?.size, 0);
  assert.equal(h.calls.stops, 1);
  h.tracking.start = async () => {};
  assert.equal((await h.app.execute('whale')).status, 'searching');
  assert.equal(h.handlers.get('anchor-found')?.size, 1);
  assert.equal(h.calls.loads, 1);
});

test('parar durante precarga no enciende la cámara y permite nueva sesión', async () => {
  const h = harness();
  const gate = deferred();
  const entered = deferred();
  h.scene.preload = () => { entered.resolve(); return gate.promise; };
  const starting = h.app.execute('whale');
  await entered.promise;
  const stopping = h.app.stop();
  gate.resolve();
  await Promise.all([starting, stopping]);
  assert.equal(h.calls.starts, 0);
  assert.equal(h.app.current.status, 'idle');
  await h.app.execute('whale');
  assert.equal(h.calls.starts, 1);
});

test('parar y volver a iniciar recarga una escena que ya fue liberada', async () => {
  const h = harness();
  await h.app.execute('whale');
  await h.app.stop();
  await h.app.execute('whale');
  assert.equal(h.calls.loads, 2);
  assert.equal(h.handlers.get('anchor-found')?.size, 1);
});

test('cancelar durante el arranque no devuelve una sesión interactiva al llamador', async () => {
  const h = harness();
  const entered = deferred();
  const gate = deferred();
  h.tracking.start = async () => { entered.resolve(); await gate.promise; };
  const starting = h.app.execute('whale');
  await entered.promise;
  const stopping = h.app.stop();
  gate.resolve();
  assert.equal((await starting).hasStarted, false);
  await stopping;
  assert.equal(h.app.current.status, 'idle');
});

test('adaptador conserva denegación de cámara, silencia antes de await y restaura getUserMedia', async () => {
  const original = async () => { throw new DOMException('No', 'NotAllowedError'); };
  const media = { getUserMedia: original };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } });
  Object.defineProperty(globalThis, 'MediaStream', { configurable: true, value: class {} });
  const video = {
    muted: false, srcObject: null,
    setAttribute() {}, removeAttribute() {}, pause() {}, remove() {},
  };
  const mindar = {
    video,
    // Reproduce el reject() sin causa de MindAR 1.2.5.
    start: () => media.getUserMedia().catch(() => Promise.reject()),
  };
  const runtime = {
    init: () => mindar, mindar, anchor: {}, isInitialized: true,
    setAnchorVisible() {}, stopLoop() {},
  };
  const tracking = new MindArTrackingAdapter(runtime as never);
  const start = tracking.start();
  assert.equal(video.muted, true);
  assert.equal(media.getUserMedia, original);
  await assert.rejects(start, CameraPermissionDeniedError);
  await tracking.stop(); // Sin controlador ni stream también debe funcionar.
});

test('primer plano suena sin mapa; animal bloqueado o perdido sin ficha no suena', async () => {
  const h = harness();
  let count = 0;
  h.audio.play = () => { count++; };
  let state = ArSession.idle().searching(Placement.initial(model.id, model.defaultScale)).tracking();
  const play = new PlayModelSound(h.audio, h.scene, models, analytics, () => state);
  await play.execute('whale');
  assert.equal(count, 0);
  state = state.withDiscovery(state.discovery.unlock(model.id)).lost();
  await play.execute('whale');
  assert.equal(count, 1);
  await play.execute('whale');
  assert.equal(count, 2); // cada toque vuelve a sonar aunque ya esté enfocado
  state = state.withDiscovery(state.discovery.focus(null));
  await play.execute('whale');
  assert.equal(count, 2);
});

test('animador respeta los bucles antes de pasar al siguiente clip', () => {
  const root = new Object3D();
  const idle = new AnimationClip('Idle', 0.1, [
    new NumberKeyframeTrack('.position[x]', [0, 0.1], [0, 1]),
  ]);
  const action = new AnimationClip('Action', 0.1, [
    new NumberKeyframeTrack('.position[x]', [0, 0.1], [10, 11]),
  ]);
  const sequence = AnimationSequence.of({
    steps: [
      { name: 'Idle', loops: 2 },
      { name: 'Action', loops: 1 },
    ],
    crossFadeSeconds: 0,
  });
  const animator = new IconAnimator(root, [idle, action], sequence);

  animator.start();
  animator.update(0.11);
  assert.ok(root.position.x < 2);
  animator.update(0.11);
  animator.update(0.01);
  assert.ok(root.position.x > 9);
  animator.dispose();
});

test('aparición y toque reinician el gesto expresivo antes de volver al ciclo', () => {
  const root = new Object3D();
  const idle = new AnimationClip('Idle', 0.1, [
    new NumberKeyframeTrack('.position[x]', [0, 0.1], [0, 1]),
  ]);
  const action = new AnimationClip('Action', 0.1, [
    new NumberKeyframeTrack('.position[x]', [0, 0.1], [10, 11]),
  ]);
  const animator = new IconAnimator(root, [idle, action], AnimationSequence.of({
    steps: [
      { name: 'Idle', loops: 2 },
      { name: 'Action', loops: 1 },
    ],
    entranceClip: 'Action',
    tapClip: 'Action',
    crossFadeSeconds: 0,
  }));

  animator.start();
  animator.update(0.01);
  assert.ok(root.position.x > 9);
  animator.update(0.11);
  animator.update(0.01);
  assert.ok(root.position.x < 2);
  animator.react();
  animator.update(0.01);
  assert.ok(root.position.x > 9);
  animator.dispose();
});

test('el salto de la ballena solo se ejecuta al tocar, a su velocidad, y luego vuelve al nado', () => {
  const root = new Object3D();
  const swim = new AnimationClip('Swin', 0.1, [new NumberKeyframeTrack('.position[x]', [0, 0.1], [0, 1])]);
  const jump = new AnimationClip('Jump', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [10, 11])]);
  const animator = new IconAnimator(root, [swim, jump], AnimationSequence.of({
    steps: [{ name: 'Swin', loops: 1 }], entranceClip: 'Swin', tapClip: 'Jump', tapSpeed: 2,
    crossFadeSeconds: 0,
  }));
  animator.start();
  animator.update(0.32);
  assert.equal(animator.isReacting, false);
  assert.ok(root.position.x < 2);
  animator.react();
  animator.update(0.25);
  assert.equal(animator.isReacting, true);
  // A doble velocidad, 0.25 s de reloj son 0.5 s de clip.
  assert.ok(Math.abs((animator.tapClipTime ?? 0) - 0.5) < 1e-6);
  assert.ok(root.position.x > 9);
  animator.update(0.3);
  animator.update(0.02);
  assert.equal(animator.isReacting, false);
  assert.ok(root.position.x < 2);
  animator.dispose();
});

test('el toque repite su clip las vueltas pedidas y el bucle vuelve a velocidad normal', () => {
  const root = new Object3D();
  const idle = new AnimationClip('Idle', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
  const walk = new AnimationClip('Walk', 0.1, [new NumberKeyframeTrack('.position[x]', [0, 0.1], [10, 11])]);
  const animator = new IconAnimator(root, [idle, walk], AnimationSequence.of({
    steps: [{ name: 'Idle', loops: 3 }, { name: 'Walk', loops: 1 }],
    tapClip: 'Walk', tapSpeed: 2, tapLoops: 3, crossFadeSeconds: 0,
  }));
  animator.start();
  animator.update(0.5);
  animator.react();
  // Tres vueltas de 0.1 s de clip a doble velocidad: 0.15 s de reloj.
  animator.update(0.1);
  assert.equal(animator.isReacting, true);
  animator.update(0.06);
  assert.equal(animator.isReacting, false);
  // Vuelve al paso ambiental que estaba sonando (Idle), no al siguiente.
  // Un fotograma más: el cambio se decide a mitad de `update`.
  animator.update(0.01);
  assert.ok(root.position.x < 2);
  animator.dispose();
});

test('la secuencia rechaza gestos de toque imposibles', () => {
  const base = { steps: [{ name: 'Idle', loops: 1 }] };
  assert.throws(() => AnimationSequence.of({ ...base, tapSpeed: 0 }));
  assert.throws(() => AnimationSequence.of({ ...base, tapLoops: 1.5 }));
  assert.throws(() => AnimationSequence.of({ ...base, tapMove: 'fly' as never }));
  assert.throws(() => AnimationSequence.of({ ...base, entranceClip: 'Jump' }));
  const ok = AnimationSequence.of({ ...base, tapClip: 'Jump', tapMove: 'breach' });
  assert.equal(ok.tapClip, 'Jump');
  assert.equal(ok.tapSpeed, 1);
});

test('el salto domado conserva el giro, acorta la trayectoria y marca el choque', () => {
  const times = [0, 1, 2, 3, 4];
  const original = new AnimationClip('Jump', 4, [
    // Sube 20, avanza 20, choca (cae un cuarto) en t=3 y vuelve.
    new VectorKeyframeTrack('RIg_BallenaHips.position', times, [
      0, 2, 0, 0, 12, 10, 0, 22, 20, 0, 15, 20, 0, 2, 0,
    ]),
    new NumberKeyframeTrack('RIg_BallenaHips.rotation[z]', [0, 4], [0, 6]),
  ]);
  const { clip, impactSeconds } = tameBreach(original);
  assert.equal(impactSeconds, 3);
  const values = Array.from(clip.tracks[0]!.values);
  // La cima se conserva a una fracción de su altura…
  assert.ok(values[7]! > 2 && values[7]! < 22 * 0.5);
  // …el avance casi desaparece…
  assert.ok(values[8]! < 20 * 0.2);
  // …y en el choque la cadera está de vuelta en el agua.
  assert.ok(Math.abs(values[10]! - 2) < 1e-6);
  assert.deepEqual(Array.from(clip.tracks[1]!.values), [0, 6]);
  // El original no se toca: IconLoader lo comparte con la caché de GLTFLoader.
  assert.deepEqual(Array.from(original.tracks[0]!.values).slice(6, 9), [0, 22, 20]);
});

test('la tortuga se sumerge, salpica al entrar y vuelve exactamente a su sitio', () => {
  const dive = new TapChoreography('dive');
  dive.start();
  const splashes: number[] = [];
  let deepest = 1;
  for (let t = 0; t < 3.2; t += 1 / 60) {
    const splash = dive.advance(1 / 60);
    if (splash !== null) splashes.push(splash);
    deepest = Math.min(deepest, dive.pose.depth);
  }
  assert.equal(splashes.length, 2);
  assert.ok(deepest < 0.7);
  assert.deepEqual({ ...dive.pose }, { rise: 0, sway: 0, yaw: 0, pitch: 0, roll: 0, depth: 1 });
  // Sin movimiento definido ('none') no hay nada que avanzar ni salpicar.
  const none = new TapChoreography('none');
  none.start();
  assert.equal(none.advance(1), null);
});

test('la ballena salpica en el fotograma del choque de su clip, no antes', () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const whale = ArModel.fromSnapshot({
    id: 'whale', name: 'Ballena', description: 'Ficha',
    source: ModelSource.primitive('whale', 0x224466), spot: { u: 0.5, v: 0.5 },
    view: 'side', iconSize: 1,
    animation: { steps: [{ name: 'Swin', loops: 1 }], tapClip: 'Jump', tapMove: 'breach', crossFadeSeconds: 0 },
    outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const icon = new Group();
  icon.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial()));
  const swim = new AnimationClip('Swin', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
  const jump = new AnimationClip('Jump', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
  const pin = new MarkerPin(whale, { object: fitToIconSize(icon), animations: [swim, jump], splashAt: 0.5 }, 0, 1.432);
  const water = pin.waterGroup;
  assert.ok(water);
  pin.setRevealed(true);
  pin.advance(0.1, 0.1);
  pin.pulse();
  pin.advance(0.4, 0.5);
  assert.equal(water.visible, false);
  pin.advance(0.15, 0.65);
  assert.equal(water.visible, true);
  pin.dispose();
});

test('proximidad permite descubrir antes y conserva histéresis', () => {
  const proximity = Proximity.default();
  assert.equal(proximity.decide(1.7, 0.7, false), true);
  assert.equal(proximity.decide(1.8, 0.7, false), false);
  assert.equal(proximity.decide(2, 0.7, true), true);
  assert.equal(proximity.decide(2.2, 0.7, true), false);
  assert.equal(proximity.decide(1, 0.73, false), false);
});

test('un modelo animado se dimensiona incluyendo el recorrido del clip', () => {
  const root = new Group();
  const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  body.name = 'Body';
  root.add(body);
  const clip = new AnimationClip('Move', 1, [
    new NumberKeyframeTrack('Body.position[y]', [0, 0.5, 1], [0, 4, 0]),
  ]);
  const fitted = fitToIconSize(root, 1, [clip]);
  const mixer = new AnimationMixer(fitted);
  mixer.clipAction(clip).play();
  mixer.update(0.5);
  const animatedHeight = new Box3().setFromObject(fitted, true).getSize(new Vector3()).y;
  assert.ok(animatedHeight <= 1.01, `El modelo animado mide ${animatedHeight}`);
});

test('pin real conserva ID en primer plano, permite raycast, pulsa y libera geometría', async () => {
  // El humo necesita un canvas; esta prueba no requiere un contexto WebGL.
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 0.5, 0.001, 100);
  let advance = (_delta: number) => {};
  const runtime = {
    prepare: async () => {},
    init: () => ({ scene, renderer: {} }),
    mindar: { scene, camera, renderer: {} },
    onFrame: (fn: (delta: number) => void) => { advance = fn; return () => {}; },
    anchorVisible: false,
  };
  const adapter = new ThreeSceneAdapter(runtime as never, 1.432);
  await adapter.preload([model]);
  adapter.applyDiscovery(ArSession.idle().discovery.unlock(model.id));
  advance(0.016);
  scene.updateMatrixWorld(true);
  const pickable = adapter.pickables?.get('whale');
  assert.ok(pickable);
  assert.equal(pickable.userData['modelId'], 'whale');
  const icon = pickable.children.find((child) => child.userData['modelId'] === 'whale');
  assert.ok(icon);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0, 0), camera);
  assert.ok(ray.intersectObject(pickable, true).length > 0);
  const initialScale = icon.scale.x;
  adapter.applyPlacement(Placement.initial(model.id, model.defaultScale).scaledBy(2));
  advance(0);
  assert.ok(Math.abs(icon.scale.x / initialScale - 2) < 0.0001);
  const scale = icon.scale.x;
  adapter.pulse(ModelId.of('whale'));
  advance(0.1);
  assert.ok(icon.scale.x > scale);
  let disposed = false;
  icon.traverse((object) => {
    if (object instanceof Mesh) object.geometry.addEventListener('dispose', () => { disposed = true; });
  });
  adapter.clear();
  assert.equal(disposed, true);
  assert.equal(adapter.pickables, null);
});
