import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { NUQUI_CATALOG } from '../src/infrastructure/repositories/StaticModelRepository';
import assert from 'node:assert/strict';
import { StartArExperience } from '../src/application/use-cases/StartArExperience';
import { TapModel } from '../src/application/use-cases/TapModel';
import { AnimalSoundscape, soundPreloadOrder } from '../src/application/use-cases/AnimalSoundscape';
import { DiscoverModel } from '../src/application/use-cases/DiscoverModel';
import { Tutorial } from '../src/application/use-cases/Tutorial';
import { CloseFocus } from '../src/application/use-cases/CloseFocus';
import { OpenMapText } from '../src/application/use-cases/OpenMapText';
import { MapText } from '../src/domain/value-objects/MapText';
import { NUQUI_MAP_TEXTS, StaticMapTextRepository } from '../src/infrastructure/repositories/StaticMapTextRepository';
import { pickDifferent, Soundscape } from '../src/domain/value-objects/Soundscape';
import { ArSession } from '../src/domain/entities/ArSession';
import { ArModel } from '../src/domain/entities/ArModel';
import { ModelId } from '../src/domain/value-objects/ModelId';
import { Discovery } from '../src/domain/value-objects/Discovery';
import { Placement } from '../src/domain/entities/Placement';
import { ModelSource } from '../src/domain/value-objects/ModelSource';
import { AnimationSequence } from '../src/domain/value-objects/AnimationSequence';
import { ThreeSceneAdapter } from '../src/infrastructure/rendering/ThreeSceneAdapter';
import { IconAnimator } from '../src/infrastructure/rendering/IconAnimator';
import { MarkerPin } from '../src/infrastructure/rendering/MarkerPin';
import { fitToIconSize, tameBreach } from '../src/infrastructure/rendering/IconLoader';
import { TapChoreography } from '../src/infrastructure/rendering/TapChoreography';
import { MindArTrackingAdapter } from '../src/infrastructure/tracking/MindArTrackingAdapter';
import { FrameLockedBackground } from '../src/infrastructure/mindar/FrameLockedBackground';
import { CameraPermissionDeniedError } from '../src/application/ports/TrackingPort';
import { PoseFilter } from '../src/infrastructure/rendering/PoseFilter';
import { addRimShading, addThreePointLighting } from '../src/infrastructure/rendering/ThreePointLighting';
import { PlayGestureSound } from '../src/application/use-cases/PlayGestureSound';
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
  MeshStandardMaterial,
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
  Sprite,
  Uint16BufferAttribute,
  Scene,
  ShaderLib,
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
    preload: async () => { calls.loads++; },
    applyPlacement() {}, setStabilization() {}, setHint() {},
    applyDiscovery() {}, pulse: () => true, clear() {}, dispose() {},
  };
  const audio = {
    unlock: async () => { calls.unlocks++; }, play() {}, dispose() {},
    preload() {}, playClip() {}, startAmbience() {}, stopAmbience() {},
    playVoice: async () => true, stopVoice() {},
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

test('un toque en el mapa despierta al animal y hace su gesto; en primer plano, solo el de delante', async () => {
  const h = harness();
  let count = 0;
  const tapped: string[] = [];
  const applied: boolean[] = [];
  const scene = {
    ...h.scene,
    pulse: () => { count++; return true; },
    applyDiscovery: (d: { isUnlocked(id: ModelId): boolean }) => { applied.push(d.isUnlocked(model.id)); },
  };
  let state = ArSession.idle().searching(Placement.initial(model.id, model.defaultScale)).tracking();
  const tap = new TapModel(scene as never, models, analytics, () => state, (next) => { state = next; }, (id) => { tapped.push(id); });
  // Sobre el mapa, dormida: la despierta (sin abrirla) y hace su gesto.
  await tap.execute('whale');
  assert.equal(state.discovery.isUnlocked(model.id), true);
  assert.equal(state.discovery.focused, null);
  assert.equal(state.discovery.isOpened(model.id), false);
  assert.deepEqual(applied, [true]);
  assert.equal(count, 1);
  assert.deepEqual(tapped, ['whale']);
  // Ya despierta, otro toque es solo el gesto.
  await tap.execute('whale');
  assert.equal(count, 2);
  assert.equal(applied.length, 1);
  // En primer plano, con o sin mapa: su gesto; otro animal no responde.
  state = state.withDiscovery(state.discovery.unlock(model.id)).lost();
  await tap.execute('whale');
  assert.equal(count, 3);
  await tap.execute('crab');
  assert.equal(count, 3);
  assert.deepEqual(tapped, ['whale', 'whale']);
});

test('el sonido del toque suena en SU momento del gesto, no al tocar', () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const bird = ArModel.fromSnapshot({
    id: 'bird', name: 'Pava', description: 'Ficha',
    source: ModelSource.primitive('bird', 0x224466), spot: { u: 0.5, v: 0.5 },
    animation: { steps: [{ name: 'Idle', loops: 1 }], tapClip: 'Sing', tapSoundAt: 1.3, crossFadeSeconds: 0 },
    outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const icon = new Group();
  icon.add(new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial()));
  const idle = new AnimationClip('Idle', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
  const sing = new AnimationClip('Sing', 4.6, [new NumberKeyframeTrack('.position[x]', [0, 4.6], [0, 0])]);
  const pin = new MarkerPin(bird, { object: fitToIconSize(icon), animations: [idle, sing], splashes: [] }, 0, 1.432);
  let sounded: number[] = [];
  let clock = 0;
  pin.onTapSound = () => sounded.push(clock);
  pin.setRevealed(true);
  pin.advance(1, 1);
  pin.pulse();
  for (let frame = 0; frame < 180; frame += 1) {
    clock += 1 / 60;
    pin.advance(1 / 60, 1 + clock);
  }
  // Una sola vez, al estirar el cuello (1.3 s), no en el instante del toque.
  assert.equal(sounded.length, 1);
  assert.ok(Math.abs(sounded[0]! - 1.3) < 0.05, `sonó a los ${sounded[0]!.toFixed(2)} s`);
  // Un toque ignorado (a mitad del gesto) no vuelve a sonar.
  pin.pulse();
  for (let frame = 0; frame < 60; frame += 1) pin.advance(1 / 60, 5);
  assert.equal(sounded.length, 1);
  sounded = [];
  pin.dispose();
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

test('el salto de la ballena conserva su tiempo y sus giros, cae en arco y se sumerge antes de volver', () => {
  // Sube 20 y avanza 20 con la forma de una campana, del segundo 1 al 3;
  // a partir de ahí el archivo hace lo que quiera (aquí, vuelve despacio).
  const times: number[] = [];
  const values: number[] = [];
  for (let t = 0; t <= 10.0001; t += 0.1) {
    const up = t <= 3 ? Math.sin((Math.PI / 2) * Math.max(0, (t - 1) / 2)) ** 2 : Math.max(0, 1 - (t - 3) / 7);
    times.push(t);
    values.push(0, 2 + 20 * up, 20 * up);
  }
  const original = new AnimationClip('Jump', 10, [
    new VectorKeyframeTrack('RIg_BallenaHips.position', times, values),
    new NumberKeyframeTrack('RIg_BallenaHips.rotation[z]', [0, 10], [0, 6]),
  ]);
  const { clip, splashes } = tameBreach(original);
  const y = (index: number) => clip.tracks[0]!.values[index * 3 + 1]!;
  const z = (index: number) => clip.tracks[0]!.values[index * 3 + 2]!;
  // El tiempo no cambia (se reproduce a velocidad 1) y los giros tampoco.
  assert.equal(clip.duration, 10);
  assert.deepEqual(Array.from(clip.tracks[1]!.values), [0, 6]);
  // La cima, a escala; y el avance, a LA MISMA escala: el arco conserva su forma.
  const peak = 30;
  assert.ok(y(peak) > 2 && y(peak) < 2 + 20 * 0.5);
  assert.ok(Math.abs((y(peak) - 2) / 20 - z(peak) / 20) < 1e-6);
  // Salpica dos veces, como la tortuga: suave al romper la superficie
  // subiendo y fuerte al volver a cruzarla cayendo.
  assert.equal(splashes.length, 2);
  const [exit, entry] = splashes;
  assert.ok(exit!.at > 1 && exit!.at < 3, `sale del agua en ${exit!.at}`);
  assert.ok(entry!.at > 3 && entry!.at < 5.5, `cae al agua en ${entry!.at}`);
  assert.ok(exit!.strength < entry!.strength);
  // La superficie está POR ENCIMA de donde nada: en los dos cruces la
  // cadera va a la misma altura, y esa altura está sobre la de reposo.
  const hipsAt = (seconds: number) => y(Math.round(seconds * 10));
  assert.ok(hipsAt(exit!.at) > 2.5 && Math.abs(hipsAt(exit!.at) - hipsAt(entry!.at)) < 0.8);
  // La caída dura lo que duró la subida: nada de caer de golpe.
  assert.ok(entry!.at - 3 > 1, 'cae demasiado deprisa');
  // Tras el choque se sumerge por debajo de donde nada, y al final vuelve.
  const lowest = Math.min(...times.map((_, index) => y(index)));
  // Se mete de verdad: baja casi tanto como saltó.
  assert.ok(lowest < 2 - (y(peak) - 2) * 0.75, `solo baja hasta ${lowest.toFixed(2)}`);
  assert.ok(Math.abs(y(times.length - 1) - 2) < 1e-3);
  // Sin golpes: la VELOCIDAD de la cadera no cambia de golpe. Al tocar el
  // agua sigue bajando con la que traía; un suelo la pararía en seco.
  for (let index = 2; index < times.length; index += 1) {
    const before = y(index - 1) - y(index - 2);
    const after = y(index) - y(index - 1);
    assert.ok(Math.abs(after - before) < 0.35, `golpe en t=${times[index]!.toFixed(1)}: ${before.toFixed(2)} → ${after.toFixed(2)}`);
  }
  // El original no se toca: IconLoader lo comparte con la caché de GLTFLoader.
  assert.equal(original.tracks[0]!.values[peak * 3 + 1], 22);
});

test('la tortuga nada bajo el agua, salpica poco al salir y más al caer, y vuelve a su sitio sin tirones', () => {
  // La superficie, 0.2 tamaños por encima de su centro: nada sumergida.
  const leap = new TapChoreography('leap', 4.8, 0.2);
  leap.start();
  const splashes: { at: number; strength: number }[] = [];
  let highest = 0;
  let deepest = 0;
  let previous = { ...leap.pose };
  let lastSpeed = 0;
  for (let t = 1 / 60; t < 5; t += 1 / 60) {
    const splash = leap.advance(1 / 60);
    if (splash !== null) splashes.push({ at: t, strength: splash });
    const pose = leap.pose;
    highest = Math.max(highest, pose.rise);
    if (splashes.length > 0) deepest = Math.min(deepest, pose.rise);
    // Fluido: la VELOCIDAD de subida y bajada no cambia de golpe, y el
    // cabeceo tampoco salta entre fotogramas.
    const speed = pose.rise - previous.rise;
    assert.ok(Math.abs(speed - lastSpeed) < 0.005, `tirón de altura en t=${t.toFixed(2)}`);
    lastSpeed = speed;
    assert.ok(Math.abs(pose.pitch - previous.pitch) < 0.06, `tirón de cabeceo en t=${t.toFixed(2)}`);
    previous = { ...pose };
  }
  // Dos salpicones, los dos al cruzar la superficie: uno pequeño al salir y
  // otro mayor al volver a caer.
  assert.equal(splashes.length, 2);
  const [exit, entry] = splashes;
  assert.ok(exit!.strength < entry!.strength);
  // Asoma bien por encima del agua, no solo la roza.
  assert.ok(highest > 0.2 + 0.35, `solo sube a ${highest.toFixed(2)}`);
  assert.ok(deepest < -0.1);
  assert.equal(leap.isPlaying, false);
  assert.deepEqual({ ...leap.pose }, { rise: 0, sway: 0, yaw: 0, pitch: 0, roll: 0 });
  // Sin movimiento definido ('none') no hay nada que avanzar ni salpicar.
  const none = new TapChoreography('none', 2);
  none.start();
  assert.equal(none.advance(1), null);
  assert.equal(none.isPlaying, false);
});

test('tocar a un animal a mitad de su gesto no lo reinicia; al acabar, sí responde', () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const turtle = ArModel.fromSnapshot({
    id: 'turtle', name: 'Tortuga', description: 'Ficha',
    source: ModelSource.primitive('turtle', 0x224466), spot: { u: 0.5, v: 0.5 },
    animation: { steps: [{ name: 'Swin', loops: 1 }], tapClip: 'Swin', tapLoops: 2, tapMove: 'leap', crossFadeSeconds: 0 },
    outlineShape: [{ u: 0.4, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.5, v: 0.6 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const icon = new Group();
  icon.add(new Mesh(new BoxGeometry(0.1, 0.05, 0.1), new MeshBasicMaterial()));
  const swim = new AnimationClip('Swin', 1, [new NumberKeyframeTrack('.position[x]', [0, 1], [0, 0])]);
  const pin = new MarkerPin(turtle, { object: fitToIconSize(icon), animations: [swim], splashes: [] }, 0, 1.432);
  pin.setRevealed(true);
  pin.advance(1, 1);
  const scale = icon.scale.x;
  assert.equal(pin.pulse(), true);
  pin.advance(1, 2);
  // A mitad del gesto (dura 2 s: dos vueltas de un clip de 1 s).
  assert.equal(pin.isGesturing, true);
  assert.equal(pin.pulse(), false);
  assert.equal(icon.scale.x, scale, 'el toque no cambia su tamaño');
  pin.advance(0.6, 2.6);
  pin.advance(0.6, 3.2);
  assert.equal(pin.isGesturing, false);
  assert.equal(pin.pulse(), true);
  pin.dispose();
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
  const pin = new MarkerPin(whale, { object: fitToIconSize(icon), animations: [swim, jump], splashes: [{ at: 0.5, strength: 1 }] }, 0, 1.432);
  const water = pin.waterGroup;
  assert.ok(water);
  const heard: number[] = [];
  pin.onSplash = (strength) => heard.push(strength);
  pin.setRevealed(true);
  pin.advance(0.1, 0.1);
  pin.pulse();
  pin.advance(0.4, 0.5);
  assert.equal(water.visible, false);
  assert.deepEqual(heard, []);
  pin.advance(0.15, 0.65);
  assert.equal(water.visible, true);
  // El chapuzón se oye en el MISMO fotograma en que se ve el salpicón.
  assert.deepEqual(heard, [1]);
  pin.dispose();
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
  // Tocarlo ya no lo agranda: la respuesta es su gesto, no un cambio de tamaño.
  assert.equal(icon.scale.x, scale);
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
  // Y a la vez inclinándola arriba y abajo hasta el tope.
  let placement = Placement.initial(whale.id, Scale.default());
  for (let frame = 0; frame < 120; frame += 1) {
    placement = placement.rotatedBy(whale.id, (Math.PI * 2) / 120, frame < 60 ? 0.05 : -0.05);
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
    playVoice: async (url: string) => { log.push(`voice ${url}`); return true; },
    stopVoice: () => { log.push('voice off'); },
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

test('tocar un animal lo abre; con uno abierto, tocar otro no le quita el sitio ni se abre solo al cerrar', async () => {
  const whale = voiced('whale');
  const crab = voiced('crab');
  const repo = { findAll: async () => [whale, crab], findById: async (id: ModelId) => (id.value === 'whale' ? whale : crab) };
  let state = ArSession.idle().searching(Placement.initial(whale.id, whale.defaultScale)).tracking();
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  const applied: (string | null)[] = [];
  const scene = { applyDiscovery: (d: { focused: ModelId | null }) => { applied.push(d.focused?.value ?? null); } };
  const discover = new DiscoverModel(scene as never, repo as never, sounds, analytics, () => state, (next) => { state = next; });
  const close = new CloseFocus(scene as never, sounds, analytics, () => state, (next) => { state = next; });

  discover.execute('whale');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.discovery.focused?.value, 'whale');
  assert.equal(h.log[0], 'ambience /whale/amb');

  // Bloqueado: el cangrejo ni se descubre ni roba el primer plano.
  discover.execute('crab');
  assert.equal(state.discovery.focused?.value, 'whale');
  assert.equal(state.discovery.isUnlocked(crab.id), false);

  // Al cerrar con la X no se abre nada solo: hay que tocar el siguiente.
  close.execute();
  assert.equal(state.discovery.focused, null);
  assert.ok(h.log.includes('ambience off'));
  discover.execute('crab');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.discovery.focused?.value, 'crab');
  assert.equal(h.log.at(-1), 'ambience /crab/amb');
  close.execute();
  assert.deepEqual(applied, ['whale', null, 'crab', null]);

  // Sin el mapa a la vista no se abre nada: el toque no puede venir de él.
  state = state.lost();
  discover.execute('whale');
  assert.equal(state.discovery.focused, null);
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
  const discover = new DiscoverModel(scene as never, repo as never, sounds, analytics, () => state, set);
  const close = new CloseFocus(scene as never, sounds, analytics, () => state, set);

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

  // Leyendo, tocar un animal no lo abre…
  discover.execute('whale');
  assert.equal(state.discovery.focused, null);
  // …ni se abre otro texto encima.
  await open.execute('rana');
  assert.equal(state.discovery.reading, 'turismo');
  // Un id que no existe no hace nada.
  close.execute();
  assert.equal(state.discovery.reading, null);
  assert.equal(h.log.includes('ambience off'), true);
  // Y al cerrar el texto no se abre ningún animal solo.
  assert.equal(state.discovery.focused, null);
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
  const pin = new MarkerPin(crab, { object: fitToIconSize(icon, 0.1), animations: [], splashes: [] }, 0, 1.432);
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

test('el chapuzón suena con el volumen del salpicón, y solo en quien cae al agua; cada toque tiene su momento', async () => {
  const played: { url: string; volume: number | undefined }[] = [];
  const audio = {
    unlock: async () => {}, dispose() {}, preload() {}, play() {},
    playClip: (url: string, volume?: number) => { played.push({ url, volume }); },
    startAmbience() {}, stopAmbience() {}, playVoice: async () => true, stopVoice() {},
  };
  const sounds = new AnimalSoundscape(audio as never, () => ArSession.idle());
  const catalog = NUQUI_CATALOG.map((entry) => ArModel.fromSnapshot(entry));
  const byId = (id: string) => catalog.find((entry) => entry.id.value === id)!;
  const gesture = new PlayGestureSound(sounds, { findAll: async () => catalog, findById: async (id: ModelId) => byId(id.value) });
  await gesture.splashed('whale', 1);
  await gesture.splashed('turtle', 0.3);
  await gesture.splashed('crab', 1);
  assert.deepEqual(played, [
    { url: '/audio/whale/splash.mp3', volume: 1 },
    { url: '/audio/turtle/splash.mp3', volume: 0.3 },
  ]);
  // El chapuzón ya no es uno de los toques de la ballena: sonaba ANTES de saltar.
  assert.ok(!byId('whale').soundscape!.taps.some((url) => url.includes('splash')));
  // Cada animal suena en el instante de su gesto que lo produce: el
  // cangrejo al echar a andar, la pava al estirar el cuello, la tortuga al
  // hundirse tras caer, la ballena al volver a respirar.
  const at = (id: string) => byId(id).animation!.tapSoundAt;
  assert.equal(at('crab'), 0);
  assert.ok(at('bird') > 1 && at('bird') < 2);
  assert.ok(at('turtle') > 2 && at('turtle') < 3);
  assert.ok(at('whale') > 8);
  // Suena a una hora exacta: se descarga entre lo primero.
  const order = soundPreloadOrder(catalog);
  assert.ok(order.indexOf('/audio/whale/splash.mp3') < order.indexOf('/audio/whale/tap-1.mp3'));
});

test('los animales se iluminan con tres puntos: principal, relleno y contraluz', () => {
  const scene = new Scene();
  addThreePointLighting(scene);
  const light = (name: string) => scene.getObjectByName(name) as unknown as { intensity: number; position: Vector3 };
  const key = light('luz-principal');
  const fill = light('luz-relleno');
  const rim = light('contraluz');
  // La cámara mira hacia −Z: la principal y el relleno vienen de delante
  // (+Z) y de lados opuestos; el contraluz, de DETRÁS del animal.
  assert.ok(key.position.z > 0 && fill.position.z > 0);
  assert.ok(Math.sign(key.position.x) !== Math.sign(fill.position.x));
  assert.ok(rim.position.z < 0 && rim.position.y > 0);
  // El relleno abre la sombra sin borrarla: un contraste de retrato, entre
  // 2.5:1 y 4:1 (la primera versión, casi 2:1, no se notaba).
  const ratio = key.intensity / fill.intensity;
  assert.ok(ratio >= 2.5 && ratio <= 4, `principal:relleno = ${ratio.toFixed(1)}:1`);
  // El contraluz, en diagonal opuesta a la principal.
  assert.ok(Math.sign(rim.position.x) !== Math.sign(key.position.x));
  // UN sol: ninguna otra luz ilumina el lomo (una cara que mira hacia
  // arriba) más que la principal. El contraluz lo hacía —0.52 × 5.5 frente a
  // 0.66 × 3.4— y la luz parecía venir de dos sitios a la vez.
  const onTop = (light: { intensity: number; position: Vector3 }) =>
    light.intensity * Math.max(0, light.position.clone().normalize().y);
  assert.ok(onTop(key) > 2 * onTop(rim), `lomo: principal ${onTop(key).toFixed(2)}, contraluz ${onTop(rim).toFixed(2)}`);
  assert.ok(onTop(key) > 2 * onTop(fill));
  // Y viene de arriba, como el sol o una lámpara: más alta que lateral.
  assert.ok(key.position.y > Math.abs(key.position.x));
});

test('el filo del contraluz se inyecta en el shader PBR de los animales, y solo en ellos', () => {
  const animal = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  const outline = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const root = new Group();
  root.add(animal, outline);
  addRimShading(root);
  const material = animal.material as MeshStandardMaterial;
  // Se inyecta en el shader REAL de three: si una versión futura cambia
  // estos trozos, el reemplazo no haría nada sin avisar.
  const shader = {
    uniforms: {} as Record<string, unknown>,
    fragmentShader: ShaderLib.physical.fragmentShader,
    vertexShader: ShaderLib.physical.vertexShader,
  };
  material.onBeforeCompile(shader as never, undefined as never);
  assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance += rimColour'));
  assert.ok(shader.fragmentShader.includes('uniform vec3 rimFrom;'));
  assert.ok('rimStrength' in shader.uniforms);
  // Con su propia clave de programa: no se mezcla con los materiales normales.
  assert.notEqual(material.customProgramCacheKey(), new MeshStandardMaterial().customProgramCacheKey());
  assert.equal((outline.material as MeshBasicMaterial).customProgramCacheKey(), new MeshBasicMaterial().customProgramCacheKey());
});

test('la narración calla mientras el animal actúa, y sigue cuando acaba', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const bird = voiced('bird', {
    soundscape: {
      calls: ['/bird/c1', '/bird/c2'], ambience: '/bird/amb',
      narration: { parts: ['/bird/n1', '/bird/n2'], cues: [{ action: 'gesture', holdSeconds: 5.4 }] },
    },
  });
  let state = ArSession.idle().searching(Placement.initial(bird.id, bird.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(bird.id));
  const h = soundHarness();
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  sounds.setPerformer((id) => { h.log.push(`gesto ${id.value}`); return true; });

  sounds.focusOpened(bird);
  // Ambiente al abrir; la voz, un momento después (no encima del humo).
  assert.equal(h.log.at(-1), 'ambience /bird/amb');
  assert.equal(h.pendingMs(), 700);
  h.fire();
  await flush();
  // Primer trozo → el animal canta y la voz ESPERA lo que dura.
  assert.deepEqual(h.log.slice(-2), ['voice /bird/n1', 'gesto bird']);
  assert.equal(h.pendingMs(), 5400);
  h.fire();
  await flush();
  // Segundo trozo, y hasta que no acaba la narración no hay llamadas sueltas.
  assert.equal(h.log.at(-1), 'voice /bird/n2');
  assert.ok(!h.log.some((line) => line.startsWith('clip')));
  assert.equal(h.pendingMs(), 6000);
  h.fire();
  assert.ok(h.log.at(-1)!.startsWith('clip /bird/c'));
});

test('cerrar la ficha a mitad de la narración la corta y no la deja seguir', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const crab = voiced('crab', {
    soundscape: {
      calls: ['/crab/c1'],
      narration: { parts: ['/crab/n1', '/crab/n2'], cues: [{ action: 'gesture', holdSeconds: 3 }] },
    },
  });
  let state = ArSession.idle().searching(Placement.initial(crab.id, crab.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(crab.id));
  const h = soundHarness();
  // El trozo acaba DESPUÉS de cerrar: la promesa llega tarde.
  let finishPart: (ended: boolean) => void = () => {};
  h.audio.playVoice = (url: string) => { h.log.push(`voice ${url}`); return new Promise((resolve) => { finishPart = resolve; }); };
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  let gestures = 0;
  sounds.setPerformer(() => { gestures += 1; return true; });
  sounds.focusOpened(crab);
  h.fire();
  sounds.focusClosed();
  assert.equal(h.log.at(-2), 'voice off');
  finishPart(true);
  await flush();
  assert.equal(gestures, 0);
  assert.equal(h.pendingMs(), null);
});

test('las cuatro narraciones del catálogo existen, van en trozos y cada pausa deja actuar al animal', () => {
  for (const entry of NUQUI_CATALOG) {
    const narration = ArModel.fromSnapshot(entry).soundscape?.narration;
    assert.ok(narration, `${entry.id} no tiene narración`);
    assert.equal(narration.parts.length, 2);
    for (const part of narration.parts) assert.ok(existsSync(`public${part}`), `falta ${part}`);
    const [cue] = narration.cues;
    // La pausa cubre lo que tarda el animal: su gesto o su canto.
    assert.ok(cue!.holdSeconds >= 3 && cue!.holdSeconds <= 7);
  }
  assert.throws(() => Soundscape.of({ calls: ['a'], narration: { parts: ['a', 'b'], cues: [] } }));
});

test('cada animal gira por su cuenta, de lado y arriba/abajo, con la inclinación topada', () => {
  const whale = ModelId.of('whale');
  const crab = ModelId.of('crab');
  let placement = Placement.initial(whale, Scale.default()).rotatedBy(whale, 0.5, 0.3);
  assert.deepEqual(placement.orientationOf(whale), { yaw: 0.5, pitch: 0.3 });
  // Girar la ballena no mueve al cangrejo.
  assert.deepEqual(placement.orientationOf(crab), { yaw: 0, pitch: 0 });
  placement = placement.rotatedBy(crab, -0.2);
  assert.ok(Math.abs(placement.orientationOf(crab).yaw - (Math.PI * 2 - 0.2)) < 1e-9);
  assert.equal(placement.orientationOf(whale).yaw, 0.5);
  // Por mucho que se arrastre hacia abajo, no queda patas arriba.
  for (let i = 0; i < 50; i += 1) placement = placement.rotatedBy(whale, 0, 0.2);
  assert.ok(placement.orientationOf(whale).pitch <= 1.25);
});

test('en la escena, arrastrar un animal gira solo ese; el primer plano sale en tres cuartos', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 0.46, 0.01, 100);
  let advance = (_delta: number): unknown => undefined;
  const runtime = {
    prepare: async () => {},
    init: () => ({ scene, renderer: {} }),
    mindar: { scene, camera, renderer: {} },
    onFrame: (fn: (delta: number) => unknown) => { advance = fn; return () => {}; },
    anchorVisible: false,
  };
  const make = (id: string, u: number) => ArModel.fromSnapshot({
    id, name: id, description: 'Ficha',
    source: ModelSource.primitive('whale', 0x224466), spot: { u, v: 0.5 },
    outlineShape: [{ u: u - 0.05, v: 0.45 }, { u: u + 0.05, v: 0.45 }, { u, v: 0.55 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const whale = make('whale', 0.3);
  const crab = make('crab', 0.7);
  const adapter = new ThreeSceneAdapter(runtime as never, 1.432);
  await adapter.preload([whale, crab]);
  let discovery = ArSession.idle().discovery.unlock(whale.id).unlock(crab.id).focus(null);
  adapter.applyDiscovery(discovery);
  // El icono es el nodo que lleva el id y cuelga de algo que no lo lleva
  // (el `lift` del pin, o el escenario del primer plano).
  const iconOf = (id: string): Object3D => {
    let icon: Object3D | undefined;
    scene.traverse((node) => {
      if (node.userData['modelId'] === id && node.parent !== null && node.parent.userData['modelId'] === undefined
        && node.parent.parent?.userData['modelId'] === id) icon = node;
    });
    scene.traverse((node) => {
      if (icon === undefined && node.userData['modelId'] === id && node.parent?.userData['modelId'] === id) icon = node;
    });
    assert.ok(icon, `no se encuentra el icono de ${id}`);
    return icon;
  };
  advance(0.016);
  const crabBefore = iconOf('crab').rotation.clone();
  const whaleBefore = iconOf('whale').rotation.clone();
  adapter.applyPlacement(Placement.initial(whale.id, Scale.default()).rotatedBy(whale.id, 0.8, 0.4));
  // Sin avanzar el tiempo: así el vaivén no cambia nada.
  assert.ok(Math.abs(iconOf('whale').rotation.y - whaleBefore.y - 0.8) < 1e-6);
  assert.ok(Math.abs(iconOf('whale').rotation.x - whaleBefore.x - 0.4) < 1e-6);
  assert.equal(iconOf('crab').rotation.y, crabBefore.y);
  assert.equal(iconOf('crab').rotation.x, crabBefore.x);

  // En primer plano: tres cuartos y algo desde arriba.
  discovery = discovery.focus(crab.id);
  adapter.applyDiscovery(discovery);
  advance(0.016);
  assert.equal(adapter.focusedModelId, 'crab');
  // Sin desenfoque (se quitó a petición del cliente): el resto del mapa
  // sigue a la vista detrás del animal.
  const mapLayer = iconOf('whale').parent!.parent!.parent!;
  assert.equal(mapLayer.visible, true);
  const staged = adapter.pickables?.get('crab')?.children.find((child) => child.userData['modelId'] === 'crab');
  assert.ok(staged);
  assert.ok(Math.abs(staged.rotation.y) > 0.4 && Math.abs(staged.rotation.y) < 0.9, `giro ${staged.rotation.y}`);
  assert.ok(staged.rotation.x > 0.1, 'se ve un poco desde arriba');
  // Al cerrar, el mapa vuelve.
  adapter.applyDiscovery(discovery.focus(null));
  assert.equal(mapLayer.visible, true);
  adapter.clear();
});

test('el arrastre gira el animal bajo el dedo, o el del primer plano; empezar en el vacío no gira nada', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const canvas = {
    style: {} as Record<string, string>,
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  const pickables = new Map<string, Object3D>();
  const source = { pickables, focusedModelId: null as string | null };
  const runtime = { mindar: { camera, renderer: { domElement: canvas } } };
  const adapter = new PointerInteractionAdapter(runtime as never, source);
  const rotations: [string, number, number][] = [];
  adapter.attach({ onTapModel() {}, onTapText() {}, onRotate: (id, yaw, pitch) => { rotations.push([id, yaw, pitch]); } });
  const pointer = adapter as unknown as {
    handleDown(e: unknown): void; handleMove(e: unknown): void; handleUp(e: unknown): void;
  };
  const drag = (fromX: number, fromY: number, dx: number, dy: number) => {
    pointer.handleDown({ pointerId: 1, clientX: fromX, clientY: fromY });
    for (let step = 1; step <= 10; step += 1) {
      pointer.handleMove({ pointerId: 1, clientX: fromX + (dx * step) / 10, clientY: fromY + (dy * step) / 10 });
    }
    pointer.handleUp({ pointerId: 1, clientX: fromX + dx, clientY: fromY + dy });
  };

  const animal = new Group();
  animal.userData['modelId'] = 'whale';
  animal.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial()));
  animal.updateMatrixWorld(true);
  pickables.set('whale', animal);

  // Empieza sobre la ballena: la gira a ella, de lado y hacia abajo.
  drag(50, 50, 40, 30);
  assert.ok(rotations.length > 0 && rotations.every(([id]) => id === 'whale'));
  assert.ok(rotations.some(([, yaw]) => yaw > 0) && rotations.some(([, , pitch]) => pitch > 0));
  // Empieza en el vacío, lejos de cualquier animal: no gira a nadie.
  rotations.length = 0;
  drag(2, 2, 40, 0);
  assert.equal(rotations.length, 0);
  // Con un animal en primer plano, cualquier arrastre es para él.
  source.focusedModelId = 'crab';
  drag(2, 2, 40, 0);
  assert.ok(rotations.length > 0 && rotations.every(([id]) => id === 'crab'));
  adapter.detach();
});

test('la narración suena sola la primera vez; después, solo con el botón, y se puede detener', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const turtle = voiced('turtle', {
    soundscape: {
      calls: ['/turtle/c1', '/turtle/c2'], ambience: '/turtle/amb',
      narration: { parts: ['/turtle/n1', '/turtle/n2'], cues: [{ action: 'gesture', holdSeconds: 5 }] },
    },
  });
  let state = ArSession.idle().searching(Placement.initial(turtle.id, turtle.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(turtle.id));
  const h = soundHarness();
  let finishPart: (ended: boolean) => void = () => {};
  h.audio.playVoice = (url: string) => { h.log.push(`voice ${url}`); return new Promise((resolve) => { finishPart = resolve; }); };
  h.audio.stopVoice = () => { h.log.push('voice off'); finishPart(false); };
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  const states: string[] = [];
  sounds.onNarrationChange(({ available, playing }) => states.push(`${available ? 'hay' : 'no hay'}${playing ? ', suena' : ''}`));

  // Primera vez: arranca sola.
  sounds.focusOpened(turtle);
  assert.equal(states.at(-1), 'hay, suena');
  h.fire();
  assert.equal(h.log.at(-1), 'voice /turtle/n1');
  // Detenerla corta la voz, deja el ambiente y el animal vuelve a llamar enseguida.
  sounds.toggleNarration();
  await flush();
  assert.equal(h.log.at(-1), 'voice off');
  assert.ok(!h.log.includes('ambience off'));
  assert.equal(states.at(-1), 'hay');
  assert.equal(h.pendingMs(), 1500);
  h.fire();
  assert.match(h.log.at(-1)!, /^clip \/turtle\/c/);

  // Segunda vez: NO arranca sola; suenan sus llamadas y el botón la ofrece.
  sounds.focusClosed();
  assert.equal(states.at(-1), 'no hay');
  sounds.focusOpened(turtle);
  assert.equal(states.at(-1), 'hay');
  assert.equal(h.pendingMs(), 400);
  const voices = h.log.filter((line) => line.startsWith('voice /')).length;
  // El botón la narra desde el principio, sin esperar.
  sounds.toggleNarration();
  assert.equal(states.at(-1), 'hay, suena');
  assert.equal(h.pendingMs(), 0);
  h.fire();
  assert.equal(h.log.filter((line) => line.startsWith('voice /')).length, voices + 1);
  assert.equal(h.log.at(-1), 'voice /turtle/n1');
  // Al acabar la narración entera, el botón vuelve a ofrecerla.
  finishPart(true);
  await flush();
  h.fire();
  await flush();
  finishPart(true);
  await flush();
  assert.equal(states.at(-1), 'hay');
});

const narratedTurtle = () => voiced('turtle', {
  soundscape: {
    calls: ['/turtle/c1', '/turtle/c2'], taps: ['/turtle/t1'], ambience: '/turtle/amb', splash: '/turtle/splash',
    narration: { parts: ['/turtle/n1', '/turtle/n2'], cues: [{ action: 'gesture', holdSeconds: 5 }] },
  },
});

test('mientras narra solo suena la voz: tocar anima sin sonar y no la corta; en su pausa, el animal sí suena', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const turtle = narratedTurtle();
  let state = ArSession.idle().searching(Placement.initial(turtle.id, turtle.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(turtle.id));
  const h = soundHarness();
  let finishPart: (ended: boolean) => void = () => {};
  h.audio.playVoice = (url: string) => { h.log.push(`voice ${url}`); return new Promise((resolve) => { finishPart = resolve; }); };
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  sounds.setPerformer(() => { sounds.tapped(turtle); return true; });

  sounds.focusOpened(turtle);
  h.fire();
  assert.equal(h.log.at(-1), 'voice /turtle/n1');
  // El usuario toca a la tortuga mientras habla: su gesto no suena, ni su chapuzón.
  sounds.tapped(turtle);
  sounds.splashed(turtle, 1);
  assert.ok(!h.log.some((line) => line.startsWith('clip')), 'un sonido tapó la voz');
  assert.ok(!h.log.includes('voice off'), 'tocar cortó la narración');
  // En la pausa de la narración el animal actúa CON su sonido.
  finishPart(true);
  await flush();
  assert.equal(h.log.at(-1), 'clip /turtle/t1');
  sounds.splashed(turtle, 1);
  assert.equal(h.log.at(-1), 'clip /turtle/splash');
  // Vuelve a hablar: otra vez solo la voz.
  h.fire();
  assert.equal(h.log.at(-1), 'voice /turtle/n2');
  sounds.splashed(turtle, 1);
  assert.equal(h.log.at(-1), 'voice /turtle/n2');
  // Detenida, el animal vuelve a sonar al tocarlo.
  sounds.stopNarration();
  sounds.tapped(turtle);
  assert.equal(h.log.at(-1), 'clip /turtle/t1');
});

test('volver a pedir abrir el animal que ya está abierto no reabre la ficha ni corta la narración', async () => {
  const turtle = narratedTurtle();
  const repo = { findAll: async () => [turtle], findById: async () => turtle };
  let state = ArSession.idle().searching(Placement.initial(turtle.id, turtle.defaultScale)).tracking();
  const h = soundHarness();
  h.audio.playVoice = (url: string) => { h.log.push(`voice ${url}`); return new Promise(() => {}); };
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  const scene = { applyDiscovery() {} };
  const discover = new DiscoverModel(scene as never, repo as never, sounds, analytics, () => state, (next) => { state = next; });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  discover.execute('turtle');
  await flush();
  h.fire();
  assert.equal(h.log.at(-1), 'voice /turtle/n1');
  // Un segundo aviso de abrirla (un doble toque que se cuela, p. ej.).
  discover.execute('turtle');
  await flush();
  assert.ok(!h.log.includes('voice off'), 'la narración se cortó al volver a acercarse');
  assert.ok(!h.log.includes('ambience off'));
  // Y aunque llegara otra vez el aviso de abrir, el paisaje sonoro no se reinicia.
  sounds.focusOpened(turtle);
  assert.ok(!h.log.includes('voice off'));
});

test('si la primera narración no llega a cargar, la próxima vez vuelve a sonar sola', async () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const turtle = narratedTurtle();
  let state = ArSession.idle().searching(Placement.initial(turtle.id, turtle.defaultScale)).tracking();
  state = state.withDiscovery(state.discovery.unlock(turtle.id));
  const h = soundHarness();
  let loads = true;
  h.audio.playVoice = async (url: string) => { h.log.push(`voice ${url}`); return loads; };
  const sounds = new AnimalSoundscape(h.audio as never, () => state, h.timers);
  loads = false;
  sounds.focusOpened(turtle);
  h.fire();
  await flush();
  sounds.focusClosed();
  loads = true;
  sounds.focusOpened(turtle);
  assert.equal(h.pendingMs(), 700, 'la segunda vez no volvió a narrar sola');
});

test('el primer trozo de cada narración se descarga antes que los toques', () => {
  const order = soundPreloadOrder(NUQUI_CATALOG.map(ArModel.fromSnapshot));
  const firstTap = order.findIndex((url) => url.includes('/tap-'));
  for (const url of order.filter((candidate) => candidate.endsWith('narration-1.mp3'))) {
    assert.ok(order.indexOf(url) < firstTap, `${url} llega tarde`);
  }
  const firstCall = order.findIndex((url) => url.includes('/call-'));
  assert.ok(order.findIndex((url) => url.endsWith('narration-1.mp3')) > firstCall);
});

test('la mano se posa sobre el animal más centrado, no se come los toques y un animal dormido se toca por su contorno', async () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 0.6, 0.01, 100);
  let advance = (_delta: number): unknown => undefined;
  const runtime = {
    prepare: async () => {},
    init: () => ({ scene, renderer: {} }),
    mindar: { scene, camera, renderer: {} },
    onFrame: (fn: (delta: number) => unknown) => { advance = fn; return () => {}; },
    anchorVisible: true,
    anchor: { group: new Group() },
  };
  // El mapa, delante de la cámara.
  runtime.anchor.group.position.set(0, 0, -1.4);
  runtime.anchor.group.updateMatrixWorld(true);
  const make = (id: string, u: number, v: number) => ArModel.fromSnapshot({
    id, name: id, description: 'Ficha',
    source: ModelSource.primitive('whale', 0x224466), spot: { u, v },
    outlineShape: [{ u: u - 0.06, v: v - 0.04 }, { u: u + 0.06, v: v - 0.04 }, { u, v: v + 0.05 }],
    sound: { waveform: 'sine', rootFrequencyHz: 90, overtoneRatios: [1], durationMs: 1800 },
  });
  const adapter = new ThreeSceneAdapter(runtime as never, 1.432);
  await adapter.preload([make('whale', 0.2, 0.15), make('crab', 0.52, 0.5)]);
  adapter.applyDiscovery(ArSession.idle().discovery);
  adapter.setHint({ kind: 'animal', gesture: 'tap', urgent: false, preferred: null, candidates: ['whale', 'crab'] });
  for (let frame = 0; frame < 30; frame += 1) advance(1 / 30);
  scene.updateMatrixWorld(true);

  // Los dos, dormidos, son tocables: tocarlos es descubrirlos.
  const pickables = adapter.pickables;
  assert.ok(pickables?.has('whale') && pickables.has('crab'));
  // La mano está sobre el cangrejo, el más centrado.
  let hand: Object3D | undefined;
  // La mano: el sprite apoyado en la punta del dedo (no el humo ni el «2×»).
  scene.traverse((node) => { if (node instanceof Sprite && Math.abs(node.center.y - 0.88) < 1e-3) hand = node; });
  assert.ok(hand?.visible, 'la mano no se ve');
  const handAt = hand!.getWorldPosition(new Vector3());
  const crabAt = pickables!.get('crab')!.getWorldPosition(new Vector3());
  const whaleAt = pickables!.get('whale')!.getWorldPosition(new Vector3());
  assert.ok(handAt.distanceTo(crabAt) < handAt.distanceTo(whaleAt));
  // Un toque en el cangrejo da en el cangrejo, no en la mano.
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(crabAt.clone().project(camera).x, crabAt.clone().project(camera).y), camera);
  const hits = ray.intersectObjects([...pickables!.values()], true).filter((hit) => hit.object.visible);
  assert.ok(hits.length > 0 && hits.every((hit) => hit.object.type !== 'Sprite'));
  // La ballena como preferida: la mano va a ella, aunque el cangrejo esté
  // más centrado; estar en medio no basta para quitársela.
  adapter.setHint({ kind: 'animal', gesture: 'tap', urgent: false, preferred: 'whale', candidates: ['whale', 'crab'] });
  for (let frame = 0; frame < 30; frame += 1) advance(1 / 30);
  scene.updateMatrixWorld(true);
  const handOnWhale = hand!.getWorldPosition(new Vector3());
  assert.ok(handOnWhale.distanceTo(whaleAt) < handOnWhale.distanceTo(crabAt), 'la primera sugerencia no es la ballena');
  // Acercarse al cangrejo (en medio y cerca): la mano se va con él.
  runtime.anchor.group.position.set(-crabAt.x, -crabAt.y, -0.5);
  runtime.anchor.group.updateMatrixWorld(true);
  for (let frame = 0; frame < 60; frame += 1) advance(1 / 30);
  scene.updateMatrixWorld(true);
  const crabNow = pickables!.get('crab')!.getWorldPosition(new Vector3());
  const whaleNow = pickables!.get('whale')!.getWorldPosition(new Vector3());
  const handNow = hand!.getWorldPosition(new Vector3());
  assert.ok(handNow.distanceTo(crabNow) < handNow.distanceTo(whaleNow), 'acercarse al cangrejo no movió la mano');
  // Con el primer animal abierto, la mano se va.
  adapter.setHint(null);
  for (let frame = 0; frame < 30; frame += 1) advance(1 / 30);
  assert.equal(hand!.parent?.visible, false);
  adapter.clear();
});

test('el salpicón sale donde está el cuerpo al tocar el agua, aunque el animal esté girado', () => {
  globalThis.document = { createElement: () => ({ getContext: () => null }) } as unknown as Document;
  const turtle = ArModel.fromSnapshot(NUQUI_CATALOG.find((entry) => entry.id === 'turtle')!);
  // Un cuerpo con su cadera algo adelantada, como la de un animal a mitad de salto.
  const body = new Group();
  body.add(new Mesh(new BoxGeometry(0.1, 0.04, 0.1), new MeshBasicMaterial()));
  const hips = new Bone();
  hips.name = 'RIG_TortugaHips';
  hips.position.set(0.03, 0, 0.02);
  body.add(hips);
  const pin = new MarkerPin(turtle, { object: body, animations: [], splashes: [] }, 0, 1.432);
  const internals = pin as unknown as {
    splash: { group: Group; burst(strength: number): void };
    measureSplashSpot(): void;
  };
  for (const yaw of [0, Math.PI / 2, -2]) {
    pin.applyTransform(1, yaw, 0);
    internals.measureSplashSpot();
    internals.splash.burst(1);
    pin.advance(0, 0);
    pin.group.updateMatrixWorld(true);
    const hipsAt = pin.group.worldToLocal(hips.getWorldPosition(new Vector3()));
    const splashAt = internals.splash.group.position;
    assert.ok(Math.abs(splashAt.x - hipsAt.x) < 1e-6, `giro ${yaw}: salpica en x=${splashAt.x.toFixed(3)}, el cuerpo está en ${hipsAt.x.toFixed(3)}`);
    // Siempre en la superficie del agua y por delante del cuerpo.
    assert.ok(splashAt.z >= hipsAt.z);
  }
  pin.dispose();
});

test('el tutorial, animal por animal: toque, doble toque, la ✕ al callar la narración, el siguiente; un texto y exploración libre', () => {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const timers = {
    set: (fn: () => void, ms: number) => { pending.set(next, { fn, ms }); return next++; },
    clear: (handle: unknown) => { pending.delete(handle as number); },
  };
  const fire = (ms: number) => {
    for (const [handle, timer] of [...pending]) {
      if (timer.ms === ms) { pending.delete(handle); timer.fn(); }
    }
  };
  const animals = ['whale', 'bird', 'crab', 'turtle'];
  const tutorial = new Tutorial(animals, ['turismo', 'rana'], timers);
  const states: { step: string; urgent: boolean; preferred: string | null; gesture: string | undefined; remaining: number }[] = [];
  tutorial.onChange((state) => states.push({
    step: state.step, urgent: state.urgent, preferred: state.hint?.preferred ?? null,
    gesture: state.hint?.gesture, remaining: state.remaining,
  }));
  const last = () => states.at(-1)!;
  let state = ArSession.idle().searching(Placement.initial(model.id, model.defaultScale));
  const openAndHear = (id: string) => {
    state = state.withDiscovery(state.discovery.unlock(ModelId.of(id)));
    tutorial.update(state);
    tutorial.narrationChanged(true);
    // Mientras narra, nada tapa la ficha.
    assert.equal(last().step, 'off');
    tutorial.narrationChanged(false);
    // Calló: la mano señala la ✕.
    assert.equal(last().step, 'closeFocus');
    state = state.withDiscovery(state.discovery.focus(null));
    tutorial.update(state);
  };

  tutorial.update(state);
  assert.equal(last().step, 'off');
  // Mapa encontrado: la mano sobre la ballena, UN toque.
  state = state.tracking();
  tutorial.update(state);
  assert.deepEqual(last(), { step: 'tapAnimal', urgent: false, preferred: 'whale', gesture: 'tap', remaining: 4 });
  fire(6000);
  assert.equal(last().urgent, true);
  // Toca el cangrejo (vale cualquiera): ahora DOS veces ese.
  tutorial.animalTapped('crab');
  assert.deepEqual(last(), { step: 'doubleTap', urgent: false, preferred: 'crab', gesture: 'double', remaining: 4 });
  openAndHear('crab');
  // Al cerrar, ENSEGUIDA el siguiente (sin esperar).
  assert.deepEqual(last(), { step: 'tapAnimal', urgent: false, preferred: null, gesture: 'tap', remaining: 3 });
  // Tocar uno ya conocido no cambia nada; uno nuevo, su doble toque.
  tutorial.animalTapped('crab');
  assert.equal(last().step, 'tapAnimal');
  tutorial.animalTapped('whale');
  assert.deepEqual(last(), { step: 'doubleTap', urgent: false, preferred: 'whale', gesture: 'double', remaining: 3 });
  openAndHear('whale');
  for (const id of ['bird', 'turtle']) {
    assert.equal(last().step, 'tapAnimal');
    tutorial.animalTapped(id);
    assert.equal(last().step, 'doubleTap');
    openAndHear(id);
  }
  // Los cuatro conocidos: enseguida, UN punto de los textos.
  assert.equal(last().step, 'tapText');
  assert.equal(last().remaining, 0);
  // Al cerrar ese primer texto: «Explora el resto de Nuquí», sin mano.
  state = state.withDiscovery(state.discovery.read('turismo'));
  tutorial.update(state);
  assert.equal(last().step, 'off');
  state = state.withDiscovery(state.discovery.focus(null));
  tutorial.update(state);
  assert.equal(last().step, 'explore');
  assert.equal(tutorial.state.hint, null);
  // A los 5 s se va, y el tutorial se acabó: leer otro no lo trae de vuelta.
  fire(5000);
  assert.equal(last().step, 'off');
  state = state.withDiscovery(state.discovery.read('rana'));
  tutorial.update(state);
  state = state.withDiscovery(state.discovery.focus(null));
  tutorial.update(state);
  assert.equal(last().step, 'off');
  assert.equal(pending.size, 0);
  // Volver a abrir un animal ya conocido no vuelve a señalar la ✕.
  state = state.withDiscovery(state.discovery.unlock(ModelId.of('crab')));
  tutorial.update(state);
  tutorial.narrationChanged(true);
  tutorial.narrationChanged(false);
  assert.equal(last().step, 'off');
});

test('un toque que cae a pocos píxeles de un animal cuenta; lo que está justo debajo siempre gana', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) };
  const pickables = new Map<string, Object3D>();
  const place = (id: string, x: number, size: number) => {
    const animal = new Group();
    animal.userData['modelId'] = id;
    const body = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial());
    body.position.x = x;
    animal.add(body);
    animal.updateMatrixWorld(true);
    pickables.set(id, animal);
  };
  place('whale', -0.5, 0.4);
  place('crab', 0.12, 0.2);
  const adapter = new PointerInteractionAdapter({ mindar: { camera, renderer: { domElement: canvas } } } as never, { pickables });
  const at = (x: number, y: number) =>
    (adapter as unknown as { forgivingTargetAt(x: number, y: number): { id: string } | null }).forgivingTargetAt(x, y);
  const px = (x: number) => (new Vector3(x, 0, 0).project(camera).x + 1) * 200;
  // Justo fuera del borde derecho de la ballena, a unos 8 px: cuenta.
  const whaleEdge = px(-0.5 + 0.2);
  assert.equal(at(whaleEdge + 8, 200)?.id, 'whale');
  // Sobre el cangrejo, aunque la ballena quede a pocos píxeles: el cangrejo.
  assert.equal(at(px(0.12 - 0.1) + 2, 200)?.id, 'crab');
  // Lejos de todo: nada.
  assert.equal(at(px(0.8), 200), null);
});

test('dos toques seguidos sobre el mismo animal abren; lentos, lejos o en otro, son dos toques', () => {
  const camera = new PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  const canvas = {
    style: {} as Record<string, string>,
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  const pickables = new Map<string, Object3D>();
  const place = (id: string, x: number) => {
    const animal = new Group();
    animal.userData['modelId'] = id;
    const body = new Mesh(new PlaneGeometry(0.6, 0.6), new MeshBasicMaterial());
    body.position.x = x;
    animal.add(body);
    animal.updateMatrixWorld(true);
    pickables.set(id, animal);
  };
  place('whale', -0.6);
  place('crab', 0.6);
  const adapter = new PointerInteractionAdapter({ mindar: { camera, renderer: { domElement: canvas } } } as never, { pickables });
  const log: string[] = [];
  adapter.attach({
    onTapModel: (id) => log.push(`toque ${id}`),
    onDoubleTapModel: (id) => log.push(`doble ${id}`),
    onTapText() {}, onRotate() {},
  });
  const pointer = adapter as unknown as { handleDown(e: unknown): void; handleUp(e: unknown): void };
  let clock = 1000;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;
  const tap = (x: number, y = 50) => {
    pointer.handleDown({ pointerId: 1, clientX: x, clientY: y });
    clock += 80;
    pointer.handleUp({ pointerId: 1, clientX: x, clientY: y });
  };
  const whaleX = (new Vector3(-0.6, 0, 0).project(camera).x + 1) * 50;
  const crabX = (new Vector3(0.6, 0, 0).project(camera).x + 1) * 50;
  try {
    tap(whaleX); clock += 200; tap(whaleX);
    assert.deepEqual(log, ['toque whale', 'doble whale']);
    // Demasiado lentos: dos toques.
    log.length = 0;
    clock += 2000; tap(whaleX); clock += 700; tap(whaleX);
    assert.deepEqual(log, ['toque whale', 'toque whale']);
    // Uno en cada animal: dos toques.
    log.length = 0;
    clock += 2000; tap(whaleX); clock += 150; tap(crabX);
    assert.deepEqual(log, ['toque whale', 'toque crab']);
  } finally {
    performance.now = realNow;
    adapter.detach();
  }
});

test('revelar con un toque no cuenta como conocerlo: los textos se abren al CONOCER a todos', () => {
  const ids = ['whale', 'crab'].map((id) => ModelId.of(id));
  let discovery = Discovery.empty();
  for (const id of ids) discovery = discovery.reveal(id);
  assert.equal(discovery.isUnlocked(ids[0]!), true);
  assert.equal(discovery.focused, null);
  assert.equal(discovery.hasFoundAll(2), false);
  for (const id of ids) discovery = discovery.unlock(id).focus(null);
  assert.equal(discovery.hasFoundAll(2), true);
  assert.equal(discovery.openedCount, 2);
  // Revelar uno ya revelado no cambia nada.
  assert.equal(discovery.reveal(ids[0]!), discovery);
});

test('en un teléfono, la cámara de MindAR se corrige a su campo de visión real antes de usarse', async () => {
  const { chooseLongSideFov, installCameraModel, verticalFieldOfView } = await import('../src/infrastructure/mindar/CameraModel');
  // En vertical el lado largo es el alto: su campo de visión es el vertical.
  assert.ok(Math.abs(verticalFieldOfView(720, 1280, 66) - (66 * Math.PI) / 180) < 1e-9);
  // Apaisado: el vertical es el del lado corto, menor.
  assert.ok(verticalFieldOfView(1280, 720, 66) < (45 * Math.PI) / 180);
  // Teléfono → 66°; ordenador → el de MindAR; `?fov=` manda si es razonable.
  assert.equal(chooseLongSideFov(null, true), 66);
  assert.equal(chooseLongSideFov(null, false), null);
  assert.equal(chooseLongSideFov(70, false), 70);
  assert.equal(chooseLongSideFov(500, true), 66);

  // MindAR crea el controlador con 45° y ACTO SEGUIDO lo usa: la corrección
  // tiene que llegar en la propia asignación.
  const mindar: { controller?: unknown } = {};
  installCameraModel(mindar, 66);
  const focal45 = 1280 / 2 / Math.tan((45 * Math.PI) / 360);
  const controller = {
    inputWidth: 720,
    inputHeight: 1280,
    projectionTransform: [[focal45, 0, 360], [0, focal45, 640], [0, 0, 1]],
    projectionMatrix: [] as number[],
    _glProjectionMatrix: ({ projectionTransform, height }: { projectionTransform: number[][]; height: number }) =>
      [0, 0, 0, 0, 0, (2 * projectionTransform[1]![1]!) / height],
  };
  const transform = controller.projectionTransform;
  mindar.controller = controller;
  assert.equal(mindar.controller, controller);
  // La misma matriz (en su sitio), con la focal de 66°.
  assert.equal(controller.projectionTransform, transform);
  const focal66 = 1280 / 2 / Math.tan((66 * Math.PI) / 360);
  assert.ok(Math.abs(transform[0]![0]! - focal66) < 1e-6 && Math.abs(transform[1]![1]! - focal66) < 1e-6);
  assert.ok(Math.abs(controller.projectionMatrix[5]! - 1 / Math.tan((66 * Math.PI) / 360)) < 1e-9);
  // En un ordenador no se toca nada.
  const desk: { controller?: unknown } = {};
  installCameraModel(desk, null);
  assert.equal(Object.getOwnPropertyDescriptor(desk, 'controller'), undefined);
});
