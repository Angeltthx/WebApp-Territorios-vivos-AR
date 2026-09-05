import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';

/** Cuántas motas tiene una bocanada. Suficientes para leerse, pocas para no costar. */
const PARTICLES = 16;
/** Lo que tarda en disiparse del todo. */
const LIFETIME_S = 0.85;
/** Radio inicial y final de la nube, en anchos de mapa. */
const START_RADIUS = 0.02;
const END_RADIUS = 0.16;
/** Cuánto sube la bocanada mientras se deshace. */
const RISE = 0.09;

/**
 * La bocanada de humo con la que aparece un animal.
 *
 * Existe para tapar la costura: sin ella el modelo se materializa de golpe
 * en mitad del aire, que es exactamente el aspecto que tiene un fallo. Con
 * humo, aparecer es un suceso.
 *
 * Son sprites, no geometría: un sprite siempre mira a la cámara, así que la
 * nube se lee igual desde cualquier ángulo sin costar un solo triángulo de
 * más. La textura es un degradado radial dibujado en un canvas al vuelo —
 * no hay ningún archivo de imagen que cargar.
 */
export class SmokePuff {
  readonly group = new Group();

  private readonly sprites: Sprite[] = [];
  private readonly angles: number[] = [];
  private readonly speeds: number[] = [];
  private readonly texture: Texture;
  /** Segundos que le quedan a la bocanada actual. 0 = inactiva. */
  private remaining = 0;

  constructor(tint = 0xffffff) {
    this.texture = softDisc();

    for (let i = 0; i < PARTICLES; i += 1) {
      const material = new SpriteMaterial({
        map: this.texture,
        color: tint,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // Adisiva: el humo SUMA luz sobre la ilustración en vez de taparla,
        // que es como se comporta una nube iluminada a contraluz.
        blending: AdditiveBlending,
      });
      const sprite = new Sprite(material);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.group.add(sprite);

      // Repartidas en abanico, no al azar puro: una distribución uniforme
      // deja huecos visibles con tan pocas partículas.
      this.angles.push((i / PARTICLES) * Math.PI * 2 + Math.random() * 0.35);
      this.speeds.push(0.75 + Math.random() * 0.5);
    }

    this.group.visible = false;
  }

  /** Dispara una bocanada desde cero. Llamarlo otra vez la reinicia. */
  burst(): void {
    this.remaining = LIFETIME_S;
    this.group.visible = true;
  }

  advance(deltaSeconds: number): void {
    if (this.remaining <= 0) return;

    this.remaining = Math.max(0, this.remaining - deltaSeconds);
    const progress = 1 - this.remaining / LIFETIME_S;

    if (this.remaining === 0) {
      this.group.visible = false;
      for (const sprite of this.sprites) sprite.visible = false;
      return;
    }

    // Sale rápido y se frena: la desaceleración es lo que distingue una
    // bocanada de humo de una explosión de confeti.
    const eased = 1 - Math.pow(1 - progress, 2.4);

    this.sprites.forEach((sprite, index) => {
      const radius = (START_RADIUS + (END_RADIUS - START_RADIUS) * eased) * this.speeds[index]!;
      const angle = this.angles[index]!;

      sprite.visible = true;
      sprite.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, RISE * eased);
      sprite.scale.setScalar(0.05 + 0.11 * eased);

      const material = sprite.material;
      // Entra en un parpadeo y se va despacio: si apareciera con la misma
      // rampa con la que se va, no habría golpe.
      material.opacity = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
      // Mezcla aditiva sobre una ilustración clara casi no se ve: verificado
      // en /verify.html, donde el mapa es crema y a 0.55 el humo apenas
      // asomaba. Sobre la imagen de una cámara real, que suele ser más
      // oscura, este valor se lee bien sin quemar.
      material.opacity *= 0.78;
    });
  }

  dispose(): void {
    for (const sprite of this.sprites) sprite.material.dispose();
    this.texture.dispose();
  }
}

/**
 * Un disco difuminado dibujado en un canvas: el grano de humo.
 *
 * Se genera aquí en vez de cargar un PNG porque son doce líneas y ahorra
 * una petición de red, un archivo que versionar y un fallo de carga posible.
 */
function softDisc(): CanvasTexture {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;

  const context = canvas.getContext('2d');
  if (context !== null) {
    const gradient = context.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, SIZE, SIZE);
  }

  return new CanvasTexture(canvas);
}
