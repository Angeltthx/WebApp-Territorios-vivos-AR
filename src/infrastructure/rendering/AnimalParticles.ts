import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { ParticleEffect, ParticleKind } from '@domain/value-objects/ParticleEffect';

/**
 * Las partículas que acompañan los movimientos de un animal: hojas o granos
 * de arena (ver ParticleEffect).
 *
 * No toca las animaciones. Cada fotograma mira dónde están los huesos del
 * catálogo y, si uno se mueve más deprisa que su umbral, suelta partículas
 * en proporción a ese exceso —con una pausa mínima entre una y otra, para
 * que acompañen y no tapen—. Así salen del gesto mismo: la pava sacude la
 * cabeza y le caen unas hojas; el cangrejo corretea deprisa y sus patas
 * levantan unos granos de arena.
 *
 * Viven al lado del icono, en su mismo padre (`lift` sobre el mapa, el
 * escenario o su hueco en el primer plano). En los dos sitios +Y es el
 * "arriba" del animal, así que la gravedad es -Y y no hay que saber dónde
 * está; si el icono cambia de padre, el grupo se muda con él y empieza de
 * cero. Las medidas van en tamaños del animal, como el salpicón.
 *
 * Lo que se probó y no quedó: burbujas en la tortuga y la ballena (ya
 * estaban bien), granos grandes y facetados en el cangrejo (piedritas, no
 * arena), nubes de polvo (demasiado), gotas de rocío y luego luciérnagas en
 * la rana (ninguna convenció: la rana va sin efecto) y una lluvia de hojas
 * en la pava que tapaba su canto.
 */

interface KindSpec {
  readonly capacity: number;
  /** Tamaño de la partícula, en tamaños del animal (mínimo y máximo). */
  readonly size: readonly [number, number];
  readonly life: readonly [number, number];
  /** Aceleración vertical, en tamaños/s² (negativa: cae). */
  readonly gravity: number;
  /** Frenado del aire, 1/s. */
  readonly drag: number;
  /** Velocidad de salida: hacia arriba y hacia los lados, en tamaños/s. */
  readonly up: readonly [number, number];
  readonly out: readonly [number, number];
  /** Cuánto lejos del hueso puede nacer, en tamaños. */
  readonly spread: number;
  /** Cuánto MÁS ARRIBA del hueso nace (hojas: caen de la copa), en tamaños. */
  readonly above: readonly [number, number];
  /** Vaivén lateral, en tamaños/s. */
  readonly sway: number;
  /** Giro, en vueltas por segundo. */
  readonly spin: number;
  /** Cuánto crece a lo largo de su vida. */
  readonly grow: number;
  /** Si se posa al tocar el suelo (la pata más baja): se queda quieta y se apaga. */
  readonly lands: boolean;
  /** Pausa mínima entre dos partículas del mismo hueso, en segundos. */
  readonly cooldown: number;
  /** Cuántas salen de golpe cada vez (el polvo, en varias nubecillas). */
  readonly burst: number;
  readonly colors: readonly number[];
}

const SPECS: Record<ParticleKind, KindSpec> = {
  // Pocas, desde arriba, lentas: como si al moverse rozara las ramas.
  leaves: {
    capacity: 14, size: [0.1, 0.15], life: [3, 4], gravity: -0.35, drag: 2.4,
    up: [-0.05, 0.05], out: [0.05, 0.15], spread: 0.3, above: [0.35, 0.7],
    sway: 0.3, spin: 0.6, grow: 0, lands: false, cooldown: 0.6, burst: 2,
    colors: [0x4f8a2c, 0x6aa335, 0x3d7a33, 0x8fae3f],
  },
  // Granitos de arena: saltan de la pata en un arco corto y caen al suelo.
  sand: {
    capacity: 60, size: [0.026, 0.042], life: [1.2, 1.6], gravity: -3.6, drag: 0.6,
    up: [0.7, 1.25], out: [0.2, 0.45], spread: 0.03, above: [0, 0.01],
    sway: 0, spin: 0, grow: 0, lands: true, cooldown: 0.2, burst: 3,
    colors: [0xd3ab70, 0xe2c38c, 0xbf9458, 0xe9d2a4],
  },
};

/** Las que se dibujan como sprite (siempre de cara a la cámara). */
const SPRITE_KINDS: ReadonlySet<ParticleKind> = new Set(['sand']);

/** Una hoja: dos curvas que se juntan en punta, un poco combada. */
function leafGeometry(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, -0.5);
  shape.quadraticCurveTo(0.34, -0.2, 0, 0.5);
  shape.quadraticCurveTo(-0.34, -0.2, 0, -0.5);
  const geometry = new ShapeGeometry(shape, 6);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    position.setZ(i, -1.2 * x * x);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Textura de un disco suave, hecha a mano (sin canvas, para que funcione
 * también fuera del navegador). `core`: cuánto del centro es pleno; un
 * grano de arena es casi todo grano, con el borde apenas suavizado.
 * `grain`: moteado, para que no sea un círculo liso.
 */
function softTexture(core: number, grain: number): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const falloff = r >= 1 ? 0 : r <= core ? 1 : 1 - (r - core) / (1 - core);
      const noise = Math.abs((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1);
      const alpha = Math.max(0, falloff * falloff * (1 - grain * noise));
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

interface Particle {
  alive: boolean;
  age: number;
  life: number;
  size: number;
  ground: number;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly axis: Vector3;
  angle: number;
  spin: number;
  phase: number;
}

const random = (range: readonly [number, number]): number => range[0] + Math.random() * (range[1] - range[0]);

/** Lo que tarda en apagarse una partícula que se posa en el suelo. */
const SETTLE_SECONDS = 0.3;

/** Como mucho, tantos huesos sueltan por fotograma y efecto. */
const MAX_PER_FRAME = 4;

/** Las partículas de UN efecto (un tipo, unos huesos). */
class Emitter {
  readonly object: Object3D;
  private readonly spec: KindSpec;
  private readonly particles: Particle[];
  private readonly bones: Object3D[];
  private readonly previous: (Vector3 | null)[];
  /** Desde cuándo no suelta cada hueso (ver `cooldown`). */
  private readonly quiet: number[];
  private readonly debts: number[];
  private next = 0;
  /** La mayor velocidad vista en un hueso (tamaños/s), para calibrar. */
  peakSpeed = 0;
  /** Cuántas ha soltado desde el último reinicio, para calibrar. */
  emitted = 0;
  private readonly mesh: InstancedMesh | null;
  private readonly sprites: Sprite[];
  private readonly matrix = new Matrix4();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly here = new Vector3();
  private readonly color = new Color();

  constructor(private readonly effect: ParticleEffect, icon: Object3D) {
    this.spec = SPECS[effect.kind];
    this.bones = [];
    icon.traverse((node) => {
      // Por el FINAL del nombre: la rana tiene, además del hueso bueno
      // (RIG_RanaLeftToe_End), sus controles IK_LeftToe_End y LeftToe_End_main.
      if (effect.from.some((part) => node.name.endsWith(part))) this.bones.push(node);
    });
    this.previous = this.bones.map(() => null);
    this.quiet = this.bones.map(() => Infinity);
    this.debts = this.bones.map(() => 0);
    this.particles = Array.from({ length: this.spec.capacity }, () => ({
      alive: false, age: 0, life: 1, size: 0, ground: 0, angle: 0, spin: 0, phase: 0,
      position: new Vector3(), velocity: new Vector3(), axis: new Vector3(0, 1, 0),
    }));

    if (SPRITE_KINDS.has(effect.kind)) {
      // Cada sprite con su material: su opacidad es suya (se desvanece sola).
      const texture = softTexture(0.55, 0.2);
      this.mesh = null;
      this.sprites = this.particles.map((_, index) => {
        const sprite = new Sprite(new SpriteMaterial({
          map: texture,
          color: this.spec.colors[index % this.spec.colors.length]!,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }));
        sprite.visible = false;
        sprite.raycast = () => {};
        return sprite;
      });
      const group = new Group();
      for (const sprite of this.sprites) group.add(sprite);
      this.object = group;
    } else {
      this.sprites = [];
      const mesh = new InstancedMesh(
        leafGeometry(),
        new MeshStandardMaterial({ roughness: 0.65, metalness: 0, side: DoubleSide }),
        this.spec.capacity,
      );
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      this.particles.forEach((_, index) => {
        this.color.setHex(this.spec.colors[index % this.spec.colors.length]!);
        mesh.setColorAt(index, this.color);
      });
      this.mesh = mesh;
      this.object = mesh;
    }
    this.hideAll();
  }

  get kind(): ParticleKind {
    return this.effect.kind;
  }

  get boneCount(): number {
    return this.bones.length;
  }

  get liveCount(): number {
    return this.particles.filter((particle) => particle.alive).length;
  }

  /** Olvida dónde estaban los huesos (al mudarse de padre o tras una pausa). */
  forget(): void {
    this.previous.fill(null);
    this.debts.fill(0);
  }

  clear(): void {
    for (const particle of this.particles) particle.alive = false;
    this.forget();
    this.hideAll();
  }

  update(dt: number, parent: Object3D, unit: number, emitting: boolean, gesturing: boolean): void {
    if (unit <= 0) return;
    for (let index = 0; index < this.quiet.length; index += 1) this.quiet[index]! += dt;
    const now = emitting && (this.effect.during === 'always' || gesturing);
    if (now && dt > 0) this.emitFromBones(dt, parent, unit);
    // Fuera de su momento, se olvidan las posiciones: al volver, la primera
    // distancia no es una velocidad.
    else if (!now) this.forget();
    this.simulate(dt, unit);
  }

  private emitFromBones(dt: number, parent: Object3D, unit: number): void {
    const { threshold, rate } = this.effect;
    // El suelo: el hueso más bajo ahora mismo (la pata apoyada). Medirlo
    // desde la pata que suelta —levantada— hacía morir la arena en el aire.
    let ground = Infinity;
    for (const bone of this.bones) {
      bone.getWorldPosition(this.here);
      ground = Math.min(ground, parent.worldToLocal(this.here).y);
    }
    let spawned = 0;
    this.bones.forEach((bone, index) => {
      bone.getWorldPosition(this.here);
      parent.worldToLocal(this.here);
      const before = this.previous[index];
      if (before === null || before === undefined) {
        this.previous[index] = this.here.clone();
        return;
      }
      const speed = before.distanceTo(this.here) / dt / unit;
      this.peakSpeed = Math.max(this.peakSpeed, speed);
      if (speed > threshold) {
        // Con tope: un hueso que "salta" en un fotograma (al dar la vuelta
        // un clip) daría una velocidad enorme y una lluvia de golpe.
        this.debts[index] = Math.min(this.debts[index]! + (speed - threshold) * rate * dt, 1);
        if (this.debts[index]! >= 1 && this.quiet[index]! >= this.spec.cooldown && spawned < MAX_PER_FRAME) {
          this.debts[index] = 0;
          this.quiet[index] = 0;
          for (let i = 0; i < this.spec.burst; i += 1) this.spawn(this.here, unit, ground);
          spawned += 1;
        }
      }
      before.copy(this.here);
    });
  }

  private spawn(origin: Vector3, unit: number, ground: number): void {
    this.emitted += 1;
    const particle = this.particles[this.next]!;
    this.next = (this.next + 1) % this.particles.length;
    const spec = this.spec;
    const angle = Math.random() * Math.PI * 2;
    particle.alive = true;
    particle.age = 0;
    particle.life = random(spec.life);
    particle.size = random(spec.size) * unit * this.effect.scale;
    particle.position.set(
      origin.x + (Math.random() - 0.5) * 2 * spec.spread * unit,
      origin.y + random(spec.above) * unit,
      origin.z + (Math.random() - 0.5) * 2 * spec.spread * unit,
    );
    particle.ground = Math.min(origin.y, ground) - 0.02 * unit;
    const out = random(spec.out) * unit;
    particle.velocity.set(Math.cos(angle) * out, random(spec.up) * unit, Math.sin(angle) * out);
    particle.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    particle.angle = Math.random() * Math.PI * 2;
    particle.spin = (Math.random() < 0.5 ? -1 : 1) * spec.spin * Math.PI * 2 * (0.5 + Math.random());
    particle.phase = Math.random() * Math.PI * 2;
  }

  private simulate(dt: number, unit: number): void {
    const spec = this.spec;
    let changed = false;
    this.particles.forEach((particle, index) => {
      if (!particle.alive) return;
      changed = true;
      particle.age += dt;
      particle.velocity.y += spec.gravity * unit * dt;
      particle.velocity.multiplyScalar(Math.exp(-spec.drag * dt));
      particle.position.addScaledVector(particle.velocity, dt);
      if (spec.sway > 0) {
        // Las hojas no caen en línea recta: se mecen.
        particle.position.x += Math.sin(particle.age * 2.7 + particle.phase) * spec.sway * unit * dt;
        particle.position.z += Math.cos(particle.age * 1.9 + particle.phase) * spec.sway * 0.7 * unit * dt;
      }
      particle.angle += particle.spin * dt;
      if (spec.lands && particle.velocity.y < 0 && particle.position.y < particle.ground) {
        // Se posa: queda en el suelo y se apaga en un momento, como la arena
        // que cae sobre la arena. Morir al tocarlo la hacía casi invisible.
        particle.position.y = particle.ground;
        particle.velocity.set(0, 0, 0);
        particle.life = Math.min(particle.life, particle.age + SETTLE_SECONDS);
      }
      if (particle.age >= particle.life) {
        particle.alive = false;
        this.hide(index);
        return;
      }
      this.show(index, particle, particle.age / particle.life);
    });
    if (changed && this.mesh !== null) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private show(index: number, particle: Particle, t: number): void {
    const spec = this.spec;
    if (this.mesh !== null) {
      // Hojas: aparecen y se van encogiendo, sin parpadeo.
      const fade = Math.min(1, t / 0.1, (1 - t) / 0.25);
      this.rotation.setFromAxisAngle(particle.axis, particle.angle);
      this.scale.setScalar(particle.size * fade);
      this.matrix.compose(particle.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
      return;
    }
    const sprite = this.sprites[index]!;
    const material = sprite.material;
    sprite.visible = true;
    sprite.position.copy(particle.position);
    const size = particle.size * (1 + spec.grow * t);
    sprite.scale.set(size, size, 1);
    material.rotation = particle.angle;
    // El grano se ve entero mientras vuela y solo se apaga al final.
    material.opacity = 0.95 * Math.min(1, t / 0.05, (1 - t) / 0.2);
  }

  private hide(index: number): void {
    if (this.mesh !== null) {
      this.matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(index, this.matrix);
      this.mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    const sprite = this.sprites[index];
    if (sprite !== undefined) sprite.visible = false;
  }

  private hideAll(): void {
    for (let index = 0; index < this.particles.length; index += 1) this.hide(index);
    if (this.mesh?.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh !== null) {
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshStandardMaterial).dispose();
      this.mesh.dispose();
    }
    const texture = this.sprites[0]?.material.map;
    for (const sprite of this.sprites) sprite.material.dispose();
    texture?.dispose();
  }
}

export class AnimalParticles {
  readonly group = new Group();
  private readonly emitters: Emitter[];

  constructor(effects: readonly ParticleEffect[], private readonly icon: Object3D) {
    this.emitters = effects.map((effect) => new Emitter(effect, icon));
    for (const emitter of this.emitters) this.group.add(emitter.object);
    this.group.raycast = () => {};
  }

  /**
   * Un fotograma. `unit`: el tamaño del animal en el espacio de su padre (lo
   * mismo que mide el salpicón). `emitting`: si puede soltar —un animal que
   * aún es un contorno no suelta nada—. `gesturing`: si está haciendo el
   * gesto del toque (para los efectos que solo salen entonces).
   */
  update(dt: number, unit: number, emitting: boolean, gesturing = false): void {
    const parent = this.icon.parent;
    if (parent === null) return;
    if (this.group.parent !== parent) {
      // Se mudó (al primer plano o de vuelta al mapa): lo que volaba estaba
      // en otras coordenadas; mejor empezar de cero que verlo saltar.
      parent.add(this.group);
      for (const emitter of this.emitters) emitter.clear();
    }
    // Tras una pausa larga (mapa fuera de cuadro), la distancia recorrida no
    // es una velocidad.
    if (dt > 0.2) for (const emitter of this.emitters) emitter.forget();
    this.icon.updateWorldMatrix(true, true);
    for (const emitter of this.emitters) emitter.update(Math.min(dt, 0.1), parent, unit, emitting, gesturing);
  }

  /** Para calibrar en /verify.html: huesos encontrados, vivas, soltadas y velocidad máxima. */
  get stats(): { kind: string; bones: number; live: number; peak: number; emitted: number }[] {
    return this.emitters.map((emitter) => ({
      kind: emitter.kind,
      bones: emitter.boneCount,
      live: emitter.liveCount,
      peak: Math.round(emitter.peakSpeed * 100) / 100,
      emitted: emitter.emitted,
    }));
  }

  /** Pone a cero la velocidad máxima y la cuenta (para medir otra fase). */
  resetStats(): void {
    for (const emitter of this.emitters) {
      emitter.peakSpeed = 0;
      emitter.emitted = 0;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const emitter of this.emitters) emitter.dispose();
  }
}
