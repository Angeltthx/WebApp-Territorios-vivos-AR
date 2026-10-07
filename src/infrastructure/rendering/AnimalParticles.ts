import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import type { ParticleEffect, ParticleKind } from '@domain/value-objects/ParticleEffect';

/**
 * Las partículas que acompañan los movimientos de un animal: hojas, arena,
 * rocío o burbujas (ver ParticleEffect).
 *
 * No toca las animaciones. Cada fotograma mira dónde están los huesos del
 * catálogo y, si uno se mueve más deprisa que su umbral, suelta partículas
 * desde ahí en proporción a ese exceso. Así salen del gesto mismo: la pava
 * suelta hojas cuando sacude la cabeza al cantar, el cangrejo arena con
 * cada paso, la rana rocío al impulsarse y al caer.
 *
 * Son objetos 3D de verdad (InstancedMesh con MeshStandardMaterial): la luz
 * de tres puntos y el mapa de entorno los iluminan como a los animales, y
 * una hoja que gira enseña su cara y su canto.
 *
 * Viven al lado del icono, en su mismo padre (`lift` sobre el mapa, el
 * escenario o su hueco en el primer plano). En los dos sitios +Y es el
 * "arriba" del animal, así que la gravedad es -Y y no hay que saber dónde
 * está; si el icono cambia de padre, el grupo se muda con él y empieza de
 * cero. Las medidas van en tamaños del animal, como el salpicón.
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
  /** Vaivén lateral (hojas, burbujas), en tamaños/s. */
  readonly sway: number;
  /** Giro, en vueltas por segundo. */
  readonly spin: number;
  /** Cuánto crece a lo largo de su vida (burbujas). */
  readonly grow: number;
  /** Si muere al caer por debajo de donde nació (arena, gotas: tocan el suelo). */
  readonly lands: boolean;
  readonly colors: readonly number[];
}

const SPECS: Record<ParticleKind, KindSpec> = {
  leaves: {
    capacity: 36, size: [0.11, 0.18], life: [2.2, 3.2], gravity: -0.55, drag: 2.2,
    up: [0.15, 0.45], out: [0.2, 0.5], spread: 0.12, sway: 0.28, spin: 0.9, grow: 0, lands: false,
    colors: [0x3f7d2a, 0x5a9a2e, 0x7bb342, 0x2f6b3a, 0xa7b84a],
  },
  sand: {
    capacity: 200, size: [0.015, 0.03], life: [0.55, 0.95], gravity: -7, drag: 0.6,
    up: [0.5, 1.1], out: [0.25, 0.6], spread: 0.03, sway: 0, spin: 2.5, grow: 0, lands: true,
    colors: [0xcfa264, 0xb98a4f, 0xdcb578, 0xa47640, 0xe4c48c],
  },
  dew: {
    capacity: 40, size: [0.018, 0.034], life: [0.5, 0.9], gravity: -5.5, drag: 0.5,
    up: [0.6, 1.3], out: [0.35, 0.8], spread: 0.04, sway: 0, spin: 0, grow: 0, lands: true,
    colors: [0xe8f6ff, 0xcfeaff, 0xffffff],
  },
  bubbles: {
    capacity: 36, size: [0.018, 0.04], life: [1.2, 2], gravity: 0.9, drag: 1.6,
    up: [0.1, 0.3], out: [0.05, 0.2], spread: 0.05, sway: 0.18, spin: 0, grow: 0.8, lands: false,
    colors: [0xeaffff, 0xd6f4ff, 0xffffff],
  },
};

/** Una hoja: dos curvas que se juntan en punta, con algo más de ancho cerca del tallo. */
function leafGeometry(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, -0.5);
  shape.quadraticCurveTo(0.34, -0.2, 0, 0.5);
  shape.quadraticCurveTo(-0.34, -0.2, 0, -0.5);
  const geometry = new ShapeGeometry(shape, 6);
  // Un poco combada, como una hoja de verdad: no es un papel plano.
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    position.setZ(i, -1.2 * x * x);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function materialFor(kind: ParticleKind): MeshStandardMaterial {
  switch (kind) {
    case 'leaves':
      return new MeshStandardMaterial({ roughness: 0.65, metalness: 0, side: DoubleSide });
    case 'sand':
      return new MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
    case 'dew':
      return new MeshStandardMaterial({ roughness: 0.05, metalness: 0, transparent: true, opacity: 0.85, envMapIntensity: 1.4 });
    case 'bubbles':
      return new MeshStandardMaterial({ roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, envMapIntensity: 1.6, depthWrite: false });
  }
}

function geometryFor(kind: ParticleKind): BufferGeometry {
  if (kind === 'leaves') return leafGeometry();
  // La arena, irregular (icosaedro sin subdividir); gotas y burbujas, redondas.
  return new IcosahedronGeometry(1, kind === 'sand' ? 0 : 2);
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

/** Como mucho, tantas partículas nuevas por fotograma y efecto. */
const MAX_PER_FRAME = 4;

const random = (range: readonly [number, number]): number => range[0] + Math.random() * (range[1] - range[0]);

/** Las partículas de UN efecto (un tipo, unos huesos). */
class Emitter {
  readonly mesh: InstancedMesh;
  private readonly spec: KindSpec;
  private readonly particles: Particle[];
  private readonly bones: Object3D[];
  private readonly previous: (Vector3 | null)[];
  private debt = 0;
  private next = 0;
  /** La mayor velocidad vista en un hueso (tamaños/s), para calibrar. */
  peakSpeed = 0;
  /** Cuántas ha soltado desde el último reinicio, para calibrar. */
  emitted = 0;
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
    this.mesh = new InstancedMesh(geometryFor(effect.kind), materialFor(effect.kind), this.spec.capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = this.spec.capacity;
    // Lo que no se ve no se toca: el raycaster de three no se salta nada.
    this.mesh.raycast = () => {};
    this.particles = Array.from({ length: this.spec.capacity }, (_, index) => {
      this.color.setHex(this.spec.colors[index % this.spec.colors.length]!);
      this.mesh.setColorAt(index, this.color);
      return {
        alive: false, age: 0, life: 1, size: 0, ground: 0, angle: 0, spin: 0, phase: 0,
        position: new Vector3(), velocity: new Vector3(), axis: new Vector3(0, 1, 0),
      };
    });
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
    this.debt = 0;
  }

  clear(): void {
    for (const particle of this.particles) particle.alive = false;
    this.forget();
    this.hideAll();
  }

  update(dt: number, parent: Object3D, unit: number, emitting: boolean): void {
    if (unit <= 0) return;
    if (emitting && dt > 0) this.emitFromBones(dt, parent, unit);
    this.simulate(dt, unit);
  }

  private emitFromBones(dt: number, parent: Object3D, unit: number): void {
    const { threshold, rate } = this.effect;
    // El suelo: el hueso más bajo ahora mismo (la pata apoyada). Medirlo desde
    // el que suelta —la pata que se levanta— hacía morir la arena a medio vuelo.
    let ground = Infinity;
    for (const bone of this.bones) {
      bone.getWorldPosition(this.here);
      ground = Math.min(ground, parent.worldToLocal(this.here).y);
    }
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
        // Una deuda por hueso no hace falta: con varios huesos rápidos a la
        // vez sale más, que es justo lo que se ve (más patas, más arena).
        // Con tope: un hueso que "salta" en un fotograma (al dar la vuelta
        // un clip) daría una velocidad enorme y una lluvia de golpe.
        this.debt = Math.min(this.debt + (speed - threshold) * rate * dt, MAX_PER_FRAME);
        const direction = this.here.clone().sub(before).normalize();
        while (this.debt >= 1) {
          this.debt -= 1;
          this.spawn(this.here, direction, unit, ground);
        }
      }
      before.copy(this.here);
    });
  }

  private spawn(origin: Vector3, motion: Vector3, unit: number, ground: number): void {
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
      origin.y + (Math.random() - 0.5) * spec.spread * unit,
      origin.z + (Math.random() - 0.5) * 2 * spec.spread * unit,
    );
    particle.ground = Math.min(origin.y, ground) - 0.02 * unit;
    const out = random(spec.out) * unit;
    particle.velocity.set(Math.cos(angle) * out, random(spec.up) * unit, Math.sin(angle) * out);
    // Un poco hacia donde iba el hueso: la arena sale despedida con el paso.
    particle.velocity.addScaledVector(motion, 0.3 * out);
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
        // Hojas y burbujas no caen ni suben en línea recta: se mecen.
        const sway = Math.sin(particle.age * 3.1 + particle.phase) * spec.sway * unit * dt;
        particle.position.x += sway;
        particle.position.z += Math.cos(particle.age * 2.3 + particle.phase) * spec.sway * 0.6 * unit * dt;
      }
      particle.angle += particle.spin * dt;
      const landed = spec.lands && particle.velocity.y < 0 && particle.position.y < particle.ground;
      if (particle.age >= particle.life || landed) {
        particle.alive = false;
        this.hide(index);
        return;
      }
      // Aparece y se va encogiendo: sin parpadeo al nacer ni al morir.
      const t = particle.age / particle.life;
      const fade = Math.min(1, t / 0.08, (1 - t) / 0.2);
      const size = particle.size * fade * (1 + spec.grow * t);
      this.rotation.setFromAxisAngle(particle.axis, particle.angle);
      this.scale.setScalar(size);
      this.matrix.compose(particle.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private hide(index: number): void {
    this.matrix.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(index, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private hideAll(): void {
    for (let index = 0; index < this.particles.length; index += 1) this.hide(index);
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.dispose();
  }
}

export class AnimalParticles {
  readonly group = new Group();
  private readonly emitters: Emitter[];

  constructor(effects: readonly ParticleEffect[], private readonly icon: Object3D) {
    this.emitters = effects.map((effect) => new Emitter(effect, icon));
    for (const emitter of this.emitters) this.group.add(emitter.mesh);
    this.group.raycast = () => {};
  }

  /**
   * Un fotograma. `unit`: el tamaño del animal en el espacio de su padre (lo
   * mismo que mide el salpicón). `emitting`: si puede soltar —un animal que
   * aún es un contorno no suelta nada—.
   */
  update(dt: number, unit: number, emitting: boolean): void {
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
    for (const emitter of this.emitters) emitter.update(Math.min(dt, 0.1), parent, unit, emitting);
  }

  /** Para calibrar en /verify.html: huesos encontrados, vivas y velocidad máxima. */
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
