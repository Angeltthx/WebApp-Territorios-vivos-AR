import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { NUQUI_CATALOG } from '../src/infrastructure/repositories/StaticModelRepository';
import { RecurringNudge } from '../src/ui/RecurringNudge';
import assert from 'node:assert/strict';
import { StartArExperience } from '../src/application/use-cases/StartArExperience';
import { PlayModelSound } from '../src/application/use-cases/PlayModelSound';
import { AnimalSoundscape, soundPreloadOrder } from '../src/application/use-cases/AnimalSoundscape';
import { DiscoverNearbyModel } from '../src/application/use-cases/DiscoverNearbyModel';
import { CloseFocus } from '../src/application/use-cases/CloseFocus';
import { OpenMapText } from '../src/application/use-cases/OpenMapText';
import { MapText } from '../src/domain/value-objects/MapText';
import { NUQUI_MAP_TEXTS, StaticMapTextRepository } from '../src/infrastructure/repositories/StaticMapTextRepository';
import { pickDifferent } from '../src/domain/value-objects/Soundscape';
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
import { FrameLockedBackground } from '../src/infrastructure/mindar/FrameLockedBackground';
import { CameraPermissionDeniedError } from '../src/application/ports/TrackingPort';
import { PoseFilter } from '../src/infrastructure/rendering/PoseFilter';
import { PointerInteractionAdapter } from '../src/infrastructure/interaction/PointerInteractionAdapter';
import { Stabilization } from '../src/domain/value-objects/Stabilization';
import { Scale } from '../src/domain/value-objects/Scale';
import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Bone,
  Float32BufferAttribute,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
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
  const audio = {
    unlock: async () => { calls.unlocks++; }, play() {}, dispose() {},
    preload() {}, playClip() {}, startAmbience() {}, stopAmbience() {},
  };
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
    setAnchorVisible() {}, stopLoop() {}, unlockBackground() {}, renderProfile: 'full',
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
  const play = new PlayModelSound(new AnimalSoundscape(h.audio as never, () => state), h.scene, models, analytics, () => state);
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

test('el fondo muestra el fotograma analizado y suelta a los animales si el seguimiento se pierde', () => {
  const drawn: unknown[] = [];
  const canvases: { style: Record<string, string>; width: number; height: number; removed: boolean }[] = [];
  globalThis.document = {
    createElement: () => {
      const canvas = {
        style: {} as Record<string, string>, width: 0, height: 0, removed: false,
        setAttribute() {}, remove() { canvas.removed = true; },
        getContext: () => ({ drawImage: (source: unknown) => drawn.push(source) }),
      };
      canvases.push(canvas);
      return canvas;
    },
  } as unknown as Document;
  const source = { width: 1280, height: 720 };
  const originalLoad = () => 'tensor';
  const states = [{ showing: true, isTracking: true }];
  const updates: string[] = [];
  const originalUpdate = (data: { type: string }) => { updates.push(data.type); };
  const controller = {
    inputLoader: { context: { canvas: source }, loadInput: originalLoad },
    onUpdate: originalUpdate as ((data: { type: string }) => void) | null,
    trackingStates: states,
  };
  const video = { videoWidth: 1280, videoHeight: 720, style: { top: '-10px', left: '0px', width: '400px', height: '700px', opacity: '' } };
  const container = { appendChild() {} };
  const frame = (tracking: boolean) => {
    states[0]!.isTracking = tracking;
    assert.equal(controller.inputLoader.loadInput(video), 'tensor');
    controller.onUpdate!({ type: 'processDone' });
  };

  const lock = new FrameLockedBackground();
  assert.equal(lock.install(controller, video as never, container as never, { lockBackground: true }), true);
  frame(true);
  // Se copió el fotograma analizado y se enseña con el encuadre del vídeo.
  assert.equal(drawn[0], source);
  assert.equal(canvases.filter((c) => c.style['visibility'] === 'visible').length, 1);
  assert.equal(canvases.find((c) => c.style['visibility'] === 'visible')?.style['top'], '-10px');
  assert.equal(video.style.opacity, '0');
  assert.deepEqual(updates, ['processDone']);

  // Unos fallos se aguantan congelados; más, y los animales se ocultan.
  for (let i = 0; i < 3; i += 1) frame(false);
  assert.equal(lock.isStale, false);
  frame(false);
  assert.equal(lock.isStale, true);
  assert.equal(video.style.opacity, '');
  frame(true);
  assert.equal(lock.isStale, false);

  lock.uninstall();
  assert.equal(controller.inputLoader.loadInput, originalLoad);
  assert.equal(controller.onUpdate, originalUpdate);
  assert.ok(canvases.every((c) => c.removed));

  // Teléfono girado: la copia de MindAR va rotada y no se engancha nada.
  const rotated = new FrameLockedBackground();
  assert.equal(rotated.install(controller, { ...video, videoWidth: 720, videoHeight: 1280 } as never, container as never, { lockBackground: true }), false);
  assert.equal(controller.inputLoader.loadInput, originalLoad);
});

test('por defecto el fondo sigue en vivo y solo se vigilan las poses viejas', () => {
  const states = [{ showing: true, isTracking: true }];
  const originalLoad = () => 'tensor';
  const originalUpdate = () => {};
  const controller = {
    inputLoader: { context: { canvas: { width: 1280, height: 720 } }, loadInput: originalLoad },
    onUpdate: originalUpdate as ((data: { type: string }) => void) | null,
    trackingStates: states,
  };
  const video = { videoWidth: 1280, videoHeight: 720, style: { opacity: '' } };
  const lock = new FrameLockedBackground();
  assert.equal(lock.install(controller, video as never, { appendChild() { throw new Error('sin lienzos'); } } as never), true);
  // Ni se copia el fotograma ni se toca el vídeo…
  assert.equal(controller.inputLoader.loadInput, originalLoad);
  states[0]!.isTracking = false;
  for (let i = 0; i < 5; i += 1) controller.onUpdate!({ type: 'processDone' });
  assert.equal(lock.isStale, false);
  controller.onUpdate!({ type: 'processDone' });
  assert.equal(video.style.opacity, '');
  // …pero una pose vieja sigue ocultando a los animales.
  assert.equal(lock.isStale, true);
  lock.uninstall();
  assert.equal(controller.onUpdate, originalUpdate);
});

test('en primer plano, un animal largo mirando a la cámara no se sale de la pantalla', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const scene = new Scene();
  // Proporción de un teléfono en vertical.
  const camera = new PerspectiveCamera(60, 0.46, 0.01, 100);
  let advance = (_delta: number): unknown => undefined;
  const runtime = {
    prepare: async () => {},
    init: () => ({ scene, renderer: {} }),
    mindar: { scene, camera, renderer: {} },
    onFrame: (fn: (delta: number) => unknown) => { advance = fn; return () => {}; },
    anchorVisible: false,
  };
  const whale = ArModel.fromSnapshot({
    id: 'whale', name: 'Ballena', description: 'Ficha',
    source: ModelSource.primitive('whale', 0x224466), spot: { u: 0.5, v: 0.5 },
    view: 'front', iconSize: 1.6,
    outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const adapter = new ThreeSceneAdapter(runtime as never, 1.432);
  await adapter.preload([whale]);
  // Descubrirla la pone en primer plano.
  adapter.applyDiscovery(ArSession.idle().discovery.unlock(whale.id));
  const icon = adapter.pickables?.get('whale')?.children.find((child) => child.userData['modelId'] === 'whale');
  assert.ok(icon);
  camera.updateMatrixWorld(true);
  // Sin tocarlo, NO gira: no es un producto en un expositor.
  advance(0.25);
  const still = icon.rotation.y;
  for (let frame = 0; frame < 20; frame += 1) advance(0.25);
  assert.equal(icon.rotation.y, still, 'el animal gira solo en primer plano');
  // Toda una vuelta arrastrando con el dedo: de lado, de morro, de espaldas.
  let placement = Placement.initial(whale.id, Scale.default());
  for (let frame = 0; frame < 120; frame += 1) {
    placement = placement.rotatedBy((Math.PI * 2) / 120);
    adapter.applyPlacement(placement);
    assert.equal(advance(0.25), true);
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(icon);
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const ndc = new Vector3(x, y, z).project(camera);
          assert.ok(Math.abs(ndc.x) <= 1, `se sale por el lado en el fotograma ${frame}: ${ndc.x.toFixed(2)}`);
          assert.ok(Math.abs(ndc.y) <= 1, `se sale por arriba o abajo en el fotograma ${frame}: ${ndc.y.toFixed(2)}`);
        }
      }
    }
  }
  adapter.clear();
});

function soundHarness() {
  const log: string[] = [];
  const audio = {
    unlock: async () => {}, dispose() {}, preload() {},
    play: () => { log.push('synth'); },
    playClip: (url: string) => { log.push(`clip ${url}`); },
    startAmbience: (url: string) => { log.push(`ambience ${url}`); },
    stopAmbience: () => { log.push('ambience off'); },
  };
  let pending: { fn: () => void; ms: number } | null = null;
  const timers = {
    set: (fn: () => void, ms: number) => { pending = { fn, ms }; return 1; },
    clear: () => { pending = null; },
  };
  const fire = () => { const next = pending; pending = null; next?.fn(); return next?.ms; };
  return { audio, timers, log, fire, pendingMs: () => pending?.ms ?? null };
}

const voiced = (id: string, extra: Partial<Parameters<typeof ArModel.fromSnapshot>[0]> = {}) => ArModel.fromSnapshot({
  id, name: id, description: ['Uno.', 'Dos.'], species: 'Especie / nombre',
  source: ModelSource.primitive('whale', 0x224466), spot: { u: 0.5, v: 0.5 },
  outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
  sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  soundscape: { calls: [`/${id}/c1`, `/${id}/c2`, `/${id}/c3`], taps: [`/${id}/t1`, `/${id}/t2`], ambience: `/${id}/amb` },
  ...extra,
});

test('la ficha guarda todos los párrafos y la especie; un paisaje sonoro no admite más de cinco', () => {
  const whale = voiced('whale');
  assert.deepEqual(whale.paragraphs, ['Uno.', 'Dos.']);
  assert.equal(whale.species, 'Especie / nombre');
  assert.equal(voiced('x', { species: '  ' }).species, null);
  assert.throws(() => voiced('x', { description: ['  '] }));
  assert.throws(() => voiced('x', { soundscape: { calls: ['a', 'b', 'c', 'd', 'e', 'f'] } }));
  assert.throws(() => voiced('x', { soundscape: { calls: [] } }));
});

test('nunca suena la misma grabación dos veces seguidas', () => {
  let previous: string | null = null;
  for (let i = 0; i < 200; i += 1) {
    const next = pickDifferent(['a', 'b', 'c'], previous);
    assert.notEqual(next, previous);
    previous = next;
  }
  assert.equal(pickDifferent(['solo'], 'solo'), 'solo');
  assert.equal(pickDifferent([], null), null);
});

test('primer plano: ambiente, una llamada al entrar y otras distintas mientras siga abierto', () => {
  const whale = voiced('whale');
  let state = ArSession.idle().searching(Placement.initial(whale.id, whale.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(whale.id));
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  sounds.focusOpened(whale);
  assert.deepEqual(h.log, ['ambience /whale/amb']);
  assert.equal(h.fire(), 400);
  const calls = h.log.filter((entry) => entry.startsWith('clip'));
  assert.equal(calls.length, 1);
  const gap = h.pendingMs();
  assert.ok(gap !== null && gap >= 10_000 && gap <= 16_000);
  h.fire();
  const again = h.log.filter((entry) => entry.startsWith('clip'));
  assert.equal(again.length, 2);
  assert.notEqual(again[0], again[1]);

  // Tocarlo suena a toque, no a llamada.
  sounds.tapped(whale);
  assert.match(h.log.at(-1)!, /^clip \/whale\/t/);

  // Cerrar apaga el ambiente y ya no suenan más llamadas.
  sounds.focusClosed();
  assert.equal(h.log.at(-1), 'ambience off');
  assert.equal(h.pendingMs(), null);

  // Sin grabaciones, el toque cae al timbre sintetizado.
  sounds.tapped(ArModel.fromSnapshot({ ...NUQUI_CATALOG[0]!, soundscape: undefined }));
  assert.equal(h.log.at(-1), 'synth');
});

test('una llamada programada no suena si la sesión perdió el primer plano por otra vía', () => {
  const whale = voiced('whale');
  let state = ArSession.idle().searching(Placement.initial(whale.id, whale.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(whale.id));
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  sounds.focusOpened(whale);
  state = state.withDiscovery(state.discovery.focus(null));
  h.fire();
  assert.equal(h.log.filter((entry) => entry.startsWith('clip')).length, 0);
  assert.equal(h.pendingMs(), null);
});

test('con un animal en primer plano, acercarse a otro no le quita el sitio; al cerrar, sí cuenta', async () => {
  const whale = voiced('whale');
  const crab = voiced('crab');
  const repo = { findAll: async () => [whale, crab], findById: async (id: ModelId) => (id.value === 'whale' ? whale : crab) };
  let state = ArSession.idle().searching(Placement.initial(whale.id, whale.defaultScale)).tracking();
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  const applied: (string | null)[] = [];
  const scene = { applyDiscovery: (d: { focused: ModelId | null }) => { applied.push(d.focused?.value ?? null); } };
  const discover = new DiscoverNearbyModel(scene as never, repo as never, sounds, analytics, () => state, (next) => { state = next; });
  const close = new CloseFocus(scene as never, sounds, analytics, () => state, (next) => { state = next; },
    (closed) => discover.resume(closed));

  discover.execute('whale');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.discovery.focused?.value, 'whale');
  assert.equal(h.log[0], 'ambience /whale/amb');

  // Bloqueado: el cangrejo ni se descubre ni roba el primer plano.
  discover.execute('crab');
  assert.equal(state.discovery.focused?.value, 'whale');
  assert.equal(state.discovery.isUnlocked(crab.id), false);

  // Al cerrar con la X, el cangrejo —junto al que ya está la cámara— sí.
  close.execute();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.discovery.focused?.value, 'crab');
  assert.ok(h.log.includes('ambience off'));
  assert.equal(h.log.at(-1), 'ambience /crab/amb');

  // Cerrar el cangrejo estando todavía junto a él no lo reabre solo.
  close.execute();
  assert.equal(state.discovery.focused, null);
  assert.deepEqual(applied, ['whale', null, 'crab', null]);
});

test('cada sonido del catálogo existe en public/audio, y se precarga primero lo que suena al entrar', () => {
  const catalog = NUQUI_CATALOG.map(ArModel.fromSnapshot);
  for (const model of catalog) {
    assert.ok(model.soundscape, `${model.id.value} sin grabaciones`);
    for (const url of model.soundscape.urls) {
      assert.ok(existsSync(`public${url}`), `Falta public${url}: ¿se ejecutó npm run build-audio?`);
    }
  }
  const order = soundPreloadOrder(catalog);
  assert.equal(new Set(order).size, order.length);
  const firstTap = order.findIndex((url) => url.includes('/tap-'));
  const lastAmbience = order.map((url) => url.includes('ambience')).lastIndexOf(true);
  assert.ok(lastAmbience < firstTap, 'los ambientes van antes que los toques');
});

test('leer un texto excluye al primer plano, y la X cierra cualquiera de los dos', () => {
  const whale = ModelId.of('whale');
  let discovery = ArSession.idle().discovery;
  assert.equal(discovery.hasFoundAll(1), false);
  discovery = discovery.unlock(whale);
  assert.equal(discovery.hasFoundAll(1), true);
  assert.equal(discovery.hasFoundAll(0), false);
  // Con el animal abierto, un texto no entra.
  assert.equal(discovery.read('turismo'), discovery);
  discovery = discovery.focus(null).read('turismo');
  assert.equal(discovery.reading, 'turismo');
  assert.equal(discovery.isBusy, true);
  // Con un texto abierto, otro no entra.
  assert.equal(discovery.read('rana'), discovery);
  discovery = discovery.focus(null);
  assert.equal(discovery.reading, null);
  assert.equal(discovery.isBusy, false);
  assert.equal(discovery.isUnlocked(whale), true);
});

test('los textos del mapa son válidos, no se solapan y su sonido existe', async () => {
  const repo = new StaticMapTextRepository(NUQUI_MAP_TEXTS);
  const texts = await repo.findAll();
  assert.ok(texts.length >= 10);
  for (const text of texts) {
    if (text.ambience !== null) assert.ok(existsSync(`public${text.ambience}`), `Falta public${text.ambience}`);
  }
  for (const a of texts) {
    for (const b of texts) {
      if (a === b) continue;
      const overlap = a.area.u0 < b.area.u1 && b.area.u0 < a.area.u1 && a.area.v0 < b.area.v1 && b.area.v0 < a.area.v1;
      assert.equal(overlap, false, `${a.id} y ${b.id} se solapan`);
    }
  }
  assert.throws(() => MapText.of({ id: 'x', label: 'x', area: { u0: 0.5, v0: 0.1, u1: 0.4, v1: 0.2 }, blocks: [{ kind: 'place', text: 'A' }] }));
  assert.throws(() => MapText.of({ id: 'x', label: 'x', area: { u0: 0.1, v0: 0.1, u1: 0.4, v1: 0.2 }, blocks: [{ kind: 'pin', text: ' ' }] }));
  assert.throws(() => new StaticMapTextRepository([NUQUI_MAP_TEXTS[0]!, NUQUI_MAP_TEXTS[0]!]));
});

test('un texto solo se abre con todos los animales encontrados y bloquea al resto', async () => {
  const whale = voiced('whale');
  const crab = voiced('crab');
  const repo = { findAll: async () => [whale, crab], findById: async (id: ModelId) => (id.value === 'whale' ? whale : crab) };
  const texts = new StaticMapTextRepository(NUQUI_MAP_TEXTS);
  let state = ArSession.idle().searching(Placement.initial(whale.id, whale.defaultScale)).tracking();
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  const scene = { applyDiscovery() {} };
  const set = (next: ArSession) => { state = next; };
  const open = new OpenMapText(scene as never, texts, repo as never, sounds, analytics, () => state, set);
  const discover = new DiscoverNearbyModel(scene as never, repo as never, sounds, analytics, () => state, set);
  const close = new CloseFocus(scene as never, sounds, analytics, () => state, set, (closed) => discover.resume(closed));

  // Falta el cangrejo: todavía no se lee nada.
  discover.execute('whale');
  close.execute();
  await open.execute('turismo');
  assert.equal(state.discovery.reading, null);

  discover.execute('crab');
  close.execute();
  // Todos encontrados: los textos se abren directamente, sin más pasos.
  await open.execute('turismo');
  assert.equal(state.discovery.reading, 'turismo');
  assert.equal(h.log.at(-1), 'ambience /audio/coast/ambience.mp3');

  // Leyendo, acercarse a un animal no lo abre…
  discover.execute('whale');
  assert.equal(state.discovery.focused, null);
  // …ni se abre otro texto encima.
  await open.execute('rana');
  assert.equal(state.discovery.reading, 'turismo');
  // Un id que no existe no hace nada.
  close.execute();
  assert.equal(state.discovery.reading, null);
  assert.equal(h.log.includes('ambience off'), true);
  // Y al cerrar el texto, la ballena junto a la que está la cámara sí se abre.
  assert.equal(state.discovery.focused?.value, 'whale');
  close.execute();
  await open.execute('no-existe');
  assert.equal(state.discovery.reading, null);
});

test('la escena solo hace tocables los puntos con todos los animales encontrados y nada abierto', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 0.5, 0.001, 100);
  const runtime = {
    prepare: async () => {},
    init: () => ({ scene, renderer: {} }),
    mindar: { scene, camera, renderer: {} },
    onFrame: () => () => {},
    anchorVisible: false,
  };
  const texts = new StaticMapTextRepository(NUQUI_MAP_TEXTS).all;
  const adapter = new ThreeSceneAdapter(runtime as never, 1.432, texts);
  await adapter.preload([model]);
  // El follower está oculto sin mapa a la vista: se enciende a mano para leer los tocables.
  (adapter as unknown as { follower: { visible: boolean } }).follower.visible = true;
  const tappableTexts = () => [...(adapter.pickables?.keys() ?? [])].filter((key) => key.startsWith('text:'));
  assert.equal(tappableTexts().length, 0);
  const found = ArSession.idle().discovery.unlock(model.id);
  adapter.applyDiscovery(found);
  // Descubierto pero con su ficha abierta: todavía no.
  assert.equal(tappableTexts().length, 0);
  // Ficha cerrada: ya se pueden tocar.
  const exploring = found.focus(null);
  adapter.applyDiscovery(exploring);
  assert.equal(tappableTexts().length, texts.length);
  const hotspot = adapter.pickables?.get('text:turismo');
  assert.equal(hotspot?.userData['textId'], 'turismo');
  adapter.applyDiscovery(exploring.read('turismo'));
  assert.equal(tappableTexts().length, 0);
  adapter.clear();
});

test('la zona de toque de un animal es su huella, no un disco que tape lo de al lado', () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const crab = ArModel.fromSnapshot(NUQUI_CATALOG.find((entry) => entry.id === 'crab')!);
  const icon = new Group();
  // Un cangrejo de 0.1 x 0.03 en su tamaño natural.
  icon.add(new Mesh(new BoxGeometry(0.1, 0.03, 0.05), new MeshBasicMaterial()));
  const pin = new MarkerPin(crab, { object: fitToIconSize(icon, 0.1), animations: [], splashAt: null }, 0, 1.432);
  pin.setRevealed(true);
  pin.advance(2, 2);
  pin.group.updateMatrixWorld(true);
  const disc = pin.group.children.find((child) => child instanceof Mesh && child.geometry instanceof CircleGeometry) as Mesh;
  assert.ok(disc);
  const size = new Box3().setFromObject(disc).getSize(new Vector3());
  // Antes: un disco de 0.24 de diámetro para todos los animales.
  assert.ok(size.x < 0.16, `la zona mide ${size.x.toFixed(3)} de ancho`);
  assert.ok(size.y < size.x, 'la zona sigue la forma del animal, no es un círculo');
  pin.dispose();
});

test('la invitación sale, se aparta a los 15 s y vuelve tras un rato sin uso', () => {
  let now = 0;
  const pending: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const timers = {
    set: (fn: () => void, ms: number) => { const id = nextId++; pending.push({ at: now + ms, fn, id }); return id; },
    clear: (id: unknown) => { const i = pending.findIndex((t) => t.id === id); if (i >= 0) pending.splice(i, 1); },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (next === undefined || next.at > until) break;
      pending.shift();
      now = next.at;
      next.fn();
    }
    now = until;
  };
  const log: string[] = [];
  const nudge = new RecurringNudge(() => log.push(`on@${now}`), () => log.push(`off@${now}`), 15_000, 35_000, timers);

  nudge.update(false);
  assert.equal(nudge.isVisible, false);
  nudge.update(true);
  assert.equal(nudge.isVisible, true);
  nudge.update(true); // renders repetidos no la reinician
  advance(15_000);
  assert.equal(nudge.isVisible, false);
  advance(34_000);
  assert.equal(nudge.isVisible, false);
  advance(1_000);
  assert.equal(nudge.isVisible, true);
  // Tocar un punto (abrir un texto) la aparta al instante…
  nudge.update(false);
  assert.equal(nudge.isVisible, false);
  // …y al cerrar, no vuelve enseguida: espera otro rato sin uso.
  nudge.update(true);
  advance(20_000);
  assert.equal(nudge.isVisible, false);
  advance(15_000);
  assert.equal(nudge.isVisible, true);
  assert.deepEqual(log, ['on@0', 'off@15000', 'on@50000', 'off@50000', 'on@85000']);
  nudge.dispose();
});

test('el filtro de pose deja fuera el temblor y sigue sin retraso un barrido del teléfono', () => {
  const stabilization = Stabilization.default();
  const still = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  const dt = 1 / 60;
  const filter = new PoseFilter();
  filter.update(new Vector3(), still, unit, dt, stabilization);
  // Un pulso que tiembla a 5 Hz, un centésimo de mapa arriba y abajo.
  let worst = 0;
  for (let frame = 1; frame <= 240; frame += 1) {
    const x = 0.01 * Math.sin(2 * Math.PI * 5 * frame * dt);
    filter.update(new Vector3(x, 0, 0), still, unit, dt, stabilization);
    if (frame > 60) worst = Math.max(worst, Math.abs(filter.position.x));
  }
  assert.ok(worst < 0.003, `el temblor pasa a los animales: ${worst.toFixed(4)} de 0.01`);

  // Barrer el teléfono: un ancho de mapa por segundo durante medio segundo.
  filter.reset();
  filter.update(new Vector3(), still, unit, dt, stabilization);
  for (let frame = 1; frame <= 30; frame += 1) {
    filter.update(new Vector3(frame * dt, 0, 0), still, unit, dt, stabilization);
  }
  const lag = 0.5 - filter.position.x;
  assert.ok(lag < 0.06, `los animales se quedan atrás: ${lag.toFixed(3)} anchos de mapa`);
});

test('tocar un punto de texto junto a un animal abre el texto; lo invisible no se toca', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const pickables = new Map<string, Object3D>();
  const runtime = { mindar: { camera, renderer: { domElement: canvas } } };
  const adapter = new PointerInteractionAdapter(runtime as never, { pickables });
  const targetAt = (x: number, y: number) =>
    (adapter as unknown as { targetAt(x: number, y: number): { kind: string; id: string } | null }).targetAt(x, y);

  // Un animal: su huella de cortesía, por delante del papel; y un humo ya
  // apagado, invisible, todavía más cerca de la cámara.
  const animal = new Group();
  animal.userData['modelId'] = 'crab';
  const footprint = new Mesh(new CircleGeometry(1, 16), new MeshBasicMaterial({ transparent: true, opacity: 0 }));
  footprint.userData['tapZone'] = true;
  footprint.position.z = 0.1;
  const smoke = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
  smoke.visible = false;
  smoke.position.z = 0.5;
  animal.add(footprint, smoke);
  // Un texto, sobre el papel, debajo de esa huella.
  const text = new Group();
  text.userData['textId'] = 'turismo';
  text.add(new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial()));
  for (const object of [animal, text]) object.updateMatrixWorld(true);
  pickables.set('crab', animal);
  pickables.set('text:turismo', text);

  assert.deepEqual(targetAt(50, 50), { kind: 'text', id: 'turismo' });
  // Fuera del texto, la huella sigue sirviendo para tocar al animal.
  assert.deepEqual(targetAt(58, 50), { kind: 'model', id: 'crab' });
  // Y el cuerpo del animal, si está delante, gana al texto.
  const body = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshBasicMaterial());
  body.position.z = 0.3;
  animal.add(body);
  animal.updateMatrixWorld(true);
  assert.deepEqual(targetAt(50, 50), { kind: 'model', id: 'crab' });
});

test('tras tocar un animal, otro animal que se ha movido con su clip se sigue pudiendo tocar', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
  const pickables = new Map<string, Object3D>();
  const runtime = { mindar: { camera, renderer: { domElement: canvas } } };
  const adapter = new PointerInteractionAdapter(runtime as never, { pickables });
  const targetAt = (x: number, y: number) =>
    (adapter as unknown as { targetAt(x: number, y: number): { kind: string; id: string } | null }).targetAt(x, y);

  // Un animal animado: una caja pegada entera a un hueso.
  const geometry = new BoxGeometry(0.3, 0.3, 0.3);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4));
  const bone = new Bone();
  const body = new SkinnedMesh(geometry, new MeshBasicMaterial());
  body.add(bone);
  const animal = new Group();
  animal.userData['modelId'] = 'turtle';
  animal.add(body);
  animal.updateMatrixWorld(true);
  const skeleton = new Skeleton([bone]);
  body.bind(skeleton);
  skeleton.update();
  pickables.set('turtle', animal);

  // El primer toque le da, y de paso deja calculada su caja.
  assert.deepEqual(targetAt(50, 50), { kind: 'model', id: 'turtle' });
  // Su clip lo lleva a otro sitio; el cuerpo que se ve ya no está donde estaba.
  bone.position.x = 1;
  animal.updateMatrixWorld(true);
  skeleton.update();
  const x = (new Vector3(1, 0, 0).project(camera).x + 1) * 50;
  assert.deepEqual(targetAt(x, 50), { kind: 'model', id: 'turtle' }, 'el toque se descarta por una caja vieja');
});
