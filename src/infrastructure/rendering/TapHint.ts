import {
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
  TextureLoader,
} from 'three';
import type { HintSpec } from '@application/ports/ScenePort';

/**
 * La mano que enseña a TOCAR un animal, sobre el propio mapa.
 *
 * Sustituye al dibujo que enseñaba a acercar el teléfono (un móvil de línea
 * que bajaba hacia un contorno). Ahora el gesto es tocar, y lo más claro
 * para enseñar a tocar algo es verlo tocado: una mano, siempre de cara a la
 * cámara (un `Sprite`), apoya la punta del dedo sobre uno de los animales
 * y, en cada pulsación, salen del punto de contacto ondas doradas sobre el
 * papel, el mismo dorado que los contornos punteados.
 *
 * Dos gestos: un toque (despierta al animal y lo hace moverse) o DOS
 * seguidos, rápidos, y una pausa (lo abre). Y dos intensidades:
 *   - en calma: una pulsación cada 1.7 s (el doble, cada 1.9 s), dos ondas.
 *   - `urgent`: más grande y más rápido, tres ondas que llegan más lejos y
 *     más brillantes. El cambio es gradual (`energy`), no un salto.
 *
 * Está en unidades de mapa y cuelga de la capa del mapa: el adaptador lo
 * lleva al animal elegido y lo escala con él. Como MarkerPin, no depende de
 * MindAR.
 */

/** Tamaño de la mano, en anchos de mapa, en calma y con prisa. */
const HAND_SIZE = 0.1;
const HAND_SIZE_URGENT = 0.125;
/** Cuánto sube la mano entre pulsación y pulsación (hacia la cámara). */
const HAND_LIFT = 0.035;
const PERIOD_S = 1.7;
const PERIOD_URGENT_S = 1.05;
/** Hasta dónde llegan las ondas, en anchos de mapa. */
const WAVE_REACH = 0.07;
const WAVE_REACH_URGENT = 0.1;
const GOLD = 0xffc53d;
const APPEAR_S = 0.5;

/**
 * La mano, dibujada para esta app: blanca y de formas redondas, con un
 * degradado cálido muy leve, una sombra suave y un brillo dorado en la
 * punta del dedo, el dorado de los contornos. Sustituye al icono
 * `touch_app` de Material, que se leía como un cursor de ordenador —trazo
 * duro, contorno oscuro, el arco de "clic"— y no gustó. Caja de 100 × 100;
 * la punta del índice está en (45, 12).
 */
const HAND_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">
    <defs>
      <linearGradient id="skin" gradientUnits="userSpaceOnUse" x1="40" y1="8" x2="70" y2="94">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#efe9dc"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2.2" stdDeviation="2.4" flood-color="#000" flood-opacity="0.45"/>
      </filter>
      <radialGradient id="glow">
        <stop offset="0" stop-color="#ffe7a3" stop-opacity="0.95"/>
        <stop offset="0.45" stop-color="#ffc53d" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#ffc53d" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="45" cy="13" r="12" fill="url(#glow)"/>
    <g filter="url(#shadow)" fill="url(#skin)">
      <rect x="38" y="8" width="14" height="56" rx="7"/>
      <rect x="51" y="33" width="13" height="32" rx="6.5"/>
      <rect x="63" y="39" width="12" height="28" rx="6"/>
      <rect x="74" y="46" width="10.5" height="24" rx="5.25"/>
      <path d="M38 52 H84.5 V70 C84.5 84 76 93 64 93 H55 C47 93 42 89 37 83 L24 66 C21 62 22 57 26 55 C29.5 53.3 33 54.5 35.5 57.5 L38 61 Z"/>
    </g>
    <g fill="none" stroke="#d9cfbb" stroke-width="1.1" stroke-linecap="round">
      <path d="M51.6 40 V58"/>
      <path d="M63.4 46 V60"/>
      <path d="M74.3 52 V63"/>
      <path d="M38.4 61.5 C40.5 66 43.5 69 47 70.5"/>
    </g>
  </svg>
`;
const FINGERTIP = { x: 0.45, y: 1 - 0.12 };

/**
 * El distintivo «2×» que acompaña al doble toque: un círculo dorado con el
 * número, que salta en cada golpe. La mano sola, tocando dos veces, se
 * confundía con un toque que se repite; con el «2×» se lee de un vistazo.
 */
const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
  <circle cx="32" cy="32" r="27" fill="#ffc53d" stroke="#ffffff" stroke-width="4"/>
  <text x="32" y="42" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="27" fill="#2a2c1c">2×</text>
</svg>`;
/** Tamaño del distintivo y dónde va respecto a la punta del dedo, en anchos de mapa. */
const BADGE_SIZE = 0.05;
const BADGE_OFFSET = { x: 0.055, y: 0.03 };
/** En el doble toque la mano sube más entre golpe y golpe: se ven DOS. */
const HAND_LIFT_DOUBLE = 0.055;

export class TapHint {
  readonly group = new Group();

  private readonly hand: Sprite;
  private readonly badge: Sprite;
  private readonly badgeTexture: Texture | null;
  /** 0 = sin distintivo, 1 = entero; aparece y se va con el doble toque. */
  private badgeShow = 0;
  private readonly waves: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  private readonly texture: Texture | null;
  private on = false;
  private urgent = false;
  private presses: readonly Press[] = SINGLE;
  /** 0 = oculta, 1 = entera. */
  private appear = 0;
  /** 0 = calma, 1 = urgente; se mueve poco a poco hacia el nivel pedido. */
  private energy = 0;
  /** Fase de la pulsación, 0–1, y el reloj de cada onda desde que salió. */
  private cycle = 0;
  private readonly waveAge: number[] = [];

  constructor() {
    this.texture = drawHand();
    this.hand = new Sprite(
      new SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    // La punta del dedo es el punto de apoyo: ahí queda clavada al animal.
    this.hand.center.set(FINGERTIP.x, FINGERTIP.y);
    this.hand.renderOrder = 12;
    this.group.add(this.hand);

    this.badgeTexture = svgTexture(BADGE_SVG);
    this.badge = new Sprite(
      new SpriteMaterial({ map: this.badgeTexture, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.badge.renderOrder = 13;
    this.group.add(this.badge);

    for (let i = 0; i < 3; i += 1) {
      const wave = new Mesh(
        new RingGeometry(0.8, 1, 48),
        new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      wave.position.z = 0.004;
      wave.renderOrder = 11;
      this.waves.push(wave);
      this.waveAge.push(Number.POSITIVE_INFINITY);
      this.group.add(wave);
    }
    // Es una indicación, no algo que tocar: que no le robe el toque al animal.
    this.group.traverse((object) => {
      object.raycast = () => {};
    });
    this.group.visible = false;
  }

  /** Qué enseñar (un toque o dos) y con cuánta insistencia; null la retira. */
  setHint(hint: Pick<HintSpec, 'gesture' | 'urgent'> | null): void {
    this.on = hint !== null;
    if (hint === null) return;
    this.urgent = hint.urgent;
    const presses = hint.gesture === 'double' ? DOUBLE : SINGLE;
    if (presses !== this.presses) {
      this.presses = presses;
      this.cycle = 0;
    }
  }

  get isShowing(): boolean {
    return this.group.visible;
  }

  advance(deltaSeconds: number): void {
    this.appear = step(this.appear, this.on ? 1 : 0, deltaSeconds / APPEAR_S);
    this.energy = step(this.energy, this.on && this.urgent ? 1 : 0, deltaSeconds / 0.8);
    this.group.visible = this.appear > 0.001;
    if (!this.group.visible) return;

    const double = this.presses === DOUBLE;
    const period = double
      ? lerp(PERIOD_DOUBLE_S, PERIOD_DOUBLE_URGENT_S, this.energy)
      : lerp(PERIOD_S, PERIOD_URGENT_S, this.energy);
    const before = this.cycle;
    const after = this.cycle + deltaSeconds / period;
    this.cycle = after % 1;
    // Cada vez que el dedo llega al papel, sale una onda.
    for (const press of this.presses) {
      if ((before < press.at && after >= press.at) || (after >= 1 && after - 1 >= press.at)) this.launchWave();
    }

    // La mano baja con aceleración, se apoya un instante y sube despacio.
    const press = pressAmount(this.cycle, this.presses);
    const size = lerp(HAND_SIZE, HAND_SIZE_URGENT, this.energy) * (1 - 0.1 * press);
    this.hand.scale.set(size, size, 1);
    this.hand.position.set(0, 0, 0.006 + (double ? HAND_LIFT_DOUBLE : HAND_LIFT) * (1 - press));
    this.hand.material.opacity = this.appear;

    // El «2×», solo en el doble toque: salta un poco en cada golpe.
    this.badgeShow = step(this.badgeShow, double ? 1 : 0, deltaSeconds / 0.3);
    const badgeSize = BADGE_SIZE * lerp(1, 1.2, this.energy) * (1 + 0.28 * press) * this.badgeShow;
    this.badge.visible = this.badgeShow > 0.01;
    this.badge.scale.set(badgeSize, badgeSize, 1);
    this.badge.position.set(BADGE_OFFSET.x, BADGE_OFFSET.y, 0.02 + HAND_LIFT_DOUBLE);
    this.badge.material.opacity = this.appear * this.badgeShow;

    const reach = lerp(WAVE_REACH, WAVE_REACH_URGENT, this.energy);
    const brightness = lerp(0.7, 1, this.energy);
    const lifetime = period * 1.5;
    this.waves.forEach((wave, index) => {
      this.waveAge[index]! += deltaSeconds;
      const t = this.waveAge[index]! / lifetime;
      if (t >= 1) {
        wave.visible = false;
        return;
      }
      wave.visible = true;
      const eased = 1 - Math.pow(1 - t, 3);
      const radius = 0.01 + (reach - 0.01) * eased;
      wave.scale.set(radius, radius, 1);
      wave.material.opacity = brightness * (1 - t) * this.appear;
    });
  }

  dispose(): void {
    this.texture?.dispose();
    this.hand.material.dispose();
    this.badgeTexture?.dispose();
    this.badge.material.dispose();
    for (const wave of this.waves) {
      wave.geometry.dispose();
      wave.material.dispose();
    }
  }

  /** La onda más vieja vuelve a salir desde el dedo: dos en calma, tres con prisa. */
  private launchWave(): void {
    const count = this.energy < 0.5 ? 2 : 3;
    let oldest = 0;
    for (let index = 1; index < count; index += 1) {
      if (this.waveAge[index]! > this.waveAge[oldest]!) oldest = index;
    }
    this.waveAge[oldest] = 0;
  }
}

/**
 * Una pulsación dentro del ciclo (fracciones de 0 a 1): llega al papel en
 * `at`, tras bajar durante `down`; se queda `hold` y sube durante `up`.
 */
interface Press {
  readonly at: number;
  readonly down: number;
  readonly hold: number;
  readonly up: number;
}

/** Un toque: baja despacio, se apoya y sube suave. */
const SINGLE: readonly Press[] = [{ at: 0.45, down: 0.45, hold: 0.12, up: 0.43 }];
/**
 * Dos toques. La primera versión levantaba el dedo apenas entre uno y
 * otro, y en el teléfono no se leía como un doble toque. Ahora son dos
 * golpes SEPARADOS: baja, golpea, sube del todo, vuelve a golpear —cada uno
 * con su onda y un salto del «2×»— y una pausa larga para que se lea como
 * UN gesto de dos golpes.
 */
const DOUBLE: readonly Press[] = [
  { at: 0.24, down: 0.22, hold: 0.05, up: 0.1 },
  { at: 0.5, down: 0.1, hold: 0.06, up: 0.28 },
];
const PERIOD_DOUBLE_S = 2.1;
const PERIOD_DOUBLE_URGENT_S = 1.5;

/** 0 arriba, 1 apoyada. */
function pressAmount(cycle: number, presses: readonly Press[]): number {
  let amount = 0;
  for (const { at, down, hold, up } of presses) {
    let value = 0;
    if (cycle >= at - down && cycle < at) {
      const t = (cycle - (at - down)) / down;
      value = t * t * t;
    } else if (cycle >= at && cycle <= at + hold) {
      value = 1;
    } else if (cycle > at + hold && cycle <= at + hold + up) {
      const t = (cycle - at - hold) / up;
      value = Math.pow(1 - t, 2);
    }
    amount = Math.max(amount, value);
  }
  return amount;
}

function step(from: number, to: number, amount: number): number {
  return from + Math.sign(to - from) * Math.min(Math.abs(to - from), amount);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * La textura de la mano, desde su SVG. Sin navegador —las pruebas— no hay
 * imagen que cargar: devuelve null y el sprite queda como un cuadrado
 * blanco que nadie ve.
 */
function drawHand(): Texture | null {
  return svgTexture(HAND_SVG);
}

function svgTexture(svg: string): Texture | null {
  if (typeof Image === 'undefined') return null;
  const texture = new TextureLoader().load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
