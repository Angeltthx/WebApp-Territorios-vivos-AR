import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';

/**
 * Un salpicón de agua, sin texturas que cargar.
 *
 * El primero eran diez círculos planos con mezcla ADITIVA que se abrían en
 * corona sobre el papel: no caían, no tenían espuma y brillaban, así que se
 * leían como confeti luminoso. El agua que salpica se reconoce por tres
 * cosas, y las tres están aquí:
 *
 *   1. Sube y CAE: cada gota sale disparada hacia arriba y la gravedad la
 *      devuelve. Esa parábola es lo que el ojo identifica como líquido.
 *   2. Es BLANCA donde se rompe: espuma opaca en la base, no luz sumada.
 *      Mezcla normal, así se ve igual sobre el mar turquesa del mapa que
 *      sobre la imagen de la cámara.
 *   3. Deja ONDAS: dos anillos que se abren aplastados, como se ve una
 *      superficie de agua en perspectiva.
 *
 * UNIDADES: todo se mide en "tamaños de animal". Quien lo usa lo escala al
 * tamaño con que se ve el animal (en el mapa o en primer plano), y así el
 * mismo salpicón vale para una ballena y para una tortuga.
 *
 * EJES: +Y es arriba y XY es el plano de la pantalla —el mismo convenio que
 * siguen los iconos de frente o de perfil, y el primer plano—. Las gotas son
 * sprites, así que miran a la cámara sin importar desde dónde se mire.
 */

const LIFETIME_S = 1.25;
const GRAVITY = 3.4;

const DROPLETS = 52;
const COLUMN = 10;
const FOAM = 14;
const RIPPLES = 2;

interface Particle {
  readonly sprite: Sprite;
  readonly vx: number;
  readonly vy: number;
  readonly x0: number;
  readonly size: number;
  readonly delay: number;
  readonly life: number;
}

export class WaterSplash {
  readonly group = new Group();

  private readonly dropTexture: Texture;
  private readonly foamTexture: Texture;
  private readonly particles: Particle[] = [];
  private readonly foam: Particle[] = [];
  private readonly ripples: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  private elapsed = LIFETIME_S;
  private strength = 1;

  constructor() {
    this.dropTexture = discTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.55, 'rgba(235,250,255,0.95)'],
      [0.8, 'rgba(190,235,250,0.55)'],
      [1, 'rgba(190,235,250,0)'],
    ]);
    this.foamTexture = discTexture([
      [0, 'rgba(255,255,255,0.95)'],
      [0.5, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]);

    // Corona: gotas que salen hacia arriba y hacia fuera, más abiertas
    // cuanto más lejos del centro nacen.
    for (let i = 0; i < DROPLETS; i += 1) {
      const side = (i / (DROPLETS - 1)) * 2 - 1;
      const jitter = Math.random() - 0.5;
      this.particles.push(this.particle(this.dropTexture, {
        x0: side * 0.32,
        vx: side * (0.55 + Math.random() * 0.45) + jitter * 0.2,
        vy: 1.05 + Math.random() * 0.75 - Math.abs(side) * 0.35,
        size: 0.022 + Math.random() * 0.04,
        delay: Math.random() * 0.08,
        life: 0.85 + Math.random() * 0.3,
      }, 10));
    }
    // Columna: pocas gotas grandes que suben rectas y más alto.
    for (let i = 0; i < COLUMN; i += 1) {
      this.particles.push(this.particle(this.dropTexture, {
        x0: (Math.random() - 0.5) * 0.14,
        vx: (Math.random() - 0.5) * 0.25,
        vy: 1.7 + Math.random() * 0.6,
        size: 0.05 + Math.random() * 0.045,
        delay: 0.03 + Math.random() * 0.06,
        life: 1.05 + Math.random() * 0.15,
      }, 11));
    }
    // Espuma: se abre a ras de agua y se deshace despacio.
    for (let i = 0; i < FOAM; i += 1) {
      const side = (i / (FOAM - 1)) * 2 - 1;
      this.foam.push(this.particle(this.foamTexture, {
        x0: side * 0.18,
        vx: side * (0.35 + Math.random() * 0.2),
        vy: 0.08 + Math.random() * 0.12,
        size: 0.2 + Math.random() * 0.12,
        delay: Math.random() * 0.05,
        life: 1.1 + Math.random() * 0.15,
      }, 9));
    }
    for (let i = 0; i < RIPPLES; i += 1) {
      const ring = new Mesh(
        new RingGeometry(0.86, 1, 48),
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      ring.renderOrder = 8;
      ring.visible = false;
      this.ripples.push(ring);
      this.group.add(ring);
    }

    this.group.visible = false;
  }

  /** Lanza un salpicón desde cero. `strength` < 1 para uno más discreto. */
  burst(strength = 1): void {
    this.strength = strength;
    this.elapsed = 0;
    this.group.visible = true;
  }

  get active(): boolean {
    return this.elapsed < LIFETIME_S;
  }

  advance(deltaSeconds: number): void {
    if (!this.active) return;
    this.elapsed = Math.min(LIFETIME_S, this.elapsed + deltaSeconds);
    const k = this.strength;

    for (const drop of this.particles) {
      const t = this.elapsed - drop.delay;
      const progress = t / drop.life;
      const alive = t > 0 && progress < 1;
      drop.sprite.visible = alive;
      if (!alive) continue;
      const vy = drop.vy * k - GRAVITY * k * t;
      drop.sprite.position.set(
        (drop.x0 + drop.vx * t) * Math.sqrt(k),
        (drop.vy * t - 0.5 * GRAVITY * t * t) * k,
        0.02,
      );
      // Estiradas en la dirección en que viajan: una gota en vuelo es un
      // trazo, no un punto.
      const speed = Math.hypot(drop.vx, vy);
      const stretch = 1 + Math.min(speed, 2) * 0.55;
      drop.sprite.scale.set(drop.size * k, drop.size * k * stretch, 1);
      drop.sprite.material.rotation = Math.atan2(vy, drop.vx) - Math.PI / 2;
      drop.sprite.material.opacity = progress < 0.6 ? 0.95 : 0.95 * (1 - (progress - 0.6) / 0.4);
    }

    for (const puff of this.foam) {
      const t = this.elapsed - puff.delay;
      const progress = t / puff.life;
      const alive = t > 0 && progress < 1;
      puff.sprite.visible = alive;
      if (!alive) continue;
      const eased = 1 - Math.pow(1 - progress, 2.2);
      puff.sprite.position.set(
        (puff.x0 + puff.vx * eased) * Math.sqrt(k),
        puff.vy * eased * k,
        0.01,
      );
      const size = puff.size * (0.6 + eased * 0.9) * k;
      puff.sprite.scale.set(size * 1.35, size, 1);
      puff.sprite.material.opacity = progress < 0.1 ? progress / 0.1 * 0.95 : 0.95 * Math.pow(1 - progress, 1.2);
    }

    this.ripples.forEach((ring, index) => {
      const t = this.elapsed - index * 0.22;
      const progress = t / (LIFETIME_S - index * 0.22);
      ring.visible = t > 0 && progress < 1;
      if (!ring.visible) return;
      const eased = 1 - Math.pow(1 - progress, 2);
      const radius = (0.12 + eased * 0.62) * Math.sqrt(k);
      // Aplastado: así se ve un círculo tumbado en el agua.
      ring.scale.set(radius, radius * 0.24, 1);
      ring.material.opacity = 0.75 * (1 - progress);
    });

    if (!this.active) this.group.visible = false;
  }

  dispose(): void {
    for (const particle of [...this.particles, ...this.foam]) particle.sprite.material.dispose();
    for (const ring of this.ripples) {
      ring.geometry.dispose();
      ring.material.dispose();
    }
    this.dropTexture.dispose();
    this.foamTexture.dispose();
  }

  private particle(
    texture: Texture,
    motion: Omit<Particle, 'sprite'>,
    renderOrder: number,
  ): Particle {
    const sprite = new Sprite(new SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    sprite.renderOrder = renderOrder;
    sprite.visible = false;
    this.group.add(sprite);
    return { sprite, ...motion };
  }
}

/** Disco con degradado radial, dibujado en un canvas al vuelo. */
function discTexture(stops: readonly (readonly [number, string])[]): CanvasTexture {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (context !== null) {
    const gradient = context.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
    context.fillStyle = gradient;
    context.fillRect(0, 0, SIZE, SIZE);
  }
  return new CanvasTexture(canvas);
}
