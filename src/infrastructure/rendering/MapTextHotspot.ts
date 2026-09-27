import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import type { MapText } from '@domain/value-objects/MapText';
import { anchorPositionOf } from './MarkerPin';

/**
 * Holgura de la zona de toque alrededor del texto, en anchos de mapa: casi
 * nada. Era 0.02 y, sumada a la zona grande de los animales, hacía que
 * tocar cerca de uno cayera en el otro. Ahora se toca el texto.
 */
const TAP_MARGIN = 0.004;
/** Lo que tardan en aparecer los puntos al aceptar la invitación. */
const APPEAR_S = 0.8;
/**
 * Radio del punto, en anchos de mapa. Era 0.007 y blanco cálido: en el
 * teléfono no se veía —un puntito blanco más sobre un mapa lleno de rótulos
 * blancos—. Pasó a 0.012 y AMARILLO, con un anillo blanco que lo recorta
 * sobre cualquier fondo; y ese se veía DEMASIADO: una docena de puntos
 * amarillos opacos llenaban el mapa y tapaban la ilustración. Ahora, un
 * término medio: algo más pequeño y translúcido (ver las opacidades en
 * `advance`), amarillo igual para que se siga leyendo como "tócame".
 */
const DOT_RADIUS = 0.0095;
/** Hasta dónde llega cada onda antes de desvanecerse. */
const WAVE_REACH = 0.04;
const WAVE_PERIOD_S = 2;
const YELLOW = 0xffd23f;
const WHITE = 0xffffff;

/**
 * El punto que marca un texto del mapa como "tócame".
 *
 * Empezó siendo un puñado de estrellitas titilando sobre cada texto, y en el
 * teléfono no se entendía qué eran: purpurina repartida por todo el mapa se
 * lee como decoración, no como algo que tocar. Un punto con una onda que se
 * expande es el lenguaje que cualquiera reconoce de un mapa digital —"aquí
 * hay algo"—: pequeño, translúcido, en el centro del texto, sin taparlo.
 *
 * Dos ondas desfasadas media vuelta, para que siempre haya una en marcha; y
 * cada punto con su propio desfase (`seed`), para que no laten todos a la
 * vez, igual que los contornos de los animales.
 *
 * Como MarkerPin, no depende de MindAR: `verify.html` puede montarlos.
 */
export class MapTextHotspot {
  readonly group = new Group();

  private readonly hit: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly dot: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly halo: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly rim: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly waves: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  private readonly phase: number;
  private active = false;
  private appear = 0;

  constructor(text: MapText, targetAspect: number, seed: number) {
    const { u0, v0, u1, v1 } = text.area;
    const center = anchorPositionOf(text.center, targetAspect);
    const width = u1 - u0;
    const height = (v1 - v0) * targetAspect;
    this.group.position.set(center.x, center.y, 0);
    this.group.userData['textId'] = text.id;
    this.phase = (seed * 0.37) % 1;

    // Invisible pero tocable: `opacity: 0`, no `visible: false` (ver MarkerPin).
    this.hit = new Mesh(
      new PlaneGeometry(width + TAP_MARGIN * 2, height + TAP_MARGIN * 2),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    this.hit.position.z = 0.001;
    this.group.add(this.hit);

    const material = (color: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    this.halo = new Mesh(new CircleGeometry(DOT_RADIUS * 2.1, 32), material(YELLOW));
    this.halo.position.z = 0.005;
    // El anillo blanco, un pelo mayor que el punto, lo recorta del fondo.
    this.rim = new Mesh(new CircleGeometry(DOT_RADIUS * 1.28, 32), material(WHITE));
    this.rim.position.z = 0.0055;
    this.dot = new Mesh(new CircleGeometry(DOT_RADIUS, 32), material(YELLOW));
    this.dot.position.z = 0.006;
    this.group.add(this.halo, this.rim, this.dot);
    for (let i = 0; i < 2; i += 1) {
      // Anillo de radio 1: se escala al radio de la onda en cada fotograma.
      const wave = new Mesh(new RingGeometry(0.8, 1, 48), material(YELLOW));
      wave.position.z = 0.005;
      this.waves.push(wave);
      this.group.add(wave);
    }
    this.group.renderOrder = 6;
    this.group.visible = false;
  }

  /** Encendido cuando se puede tocar: invitación aceptada y nada abierto. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.group.visible = true;
  }

  get isActive(): boolean {
    return this.active;
  }

  advance(deltaSeconds: number, elapsed: number): void {
    const target = this.active ? 1 : 0;
    this.appear += Math.sign(target - this.appear) * Math.min(Math.abs(target - this.appear), deltaSeconds / APPEAR_S);
    this.group.visible = this.appear > 0.001;
    if (!this.group.visible) return;

    const show = this.appear;
    this.dot.material.opacity = 0.72 * show;
    this.rim.material.opacity = 0.55 * show;
    this.halo.material.opacity = 0.16 * show;
    this.waves.forEach((wave, index) => {
      // De 0 a 1 en cada periodo; la segunda onda, media vuelta detrás.
      const t = (elapsed / WAVE_PERIOD_S + this.phase + index * 0.5) % 1;
      const eased = 1 - Math.pow(1 - t, 2);
      const radius = DOT_RADIUS + (WAVE_REACH - DOT_RADIUS) * eased;
      wave.scale.set(radius, radius, 1);
      wave.material.opacity = 0.45 * (1 - t) * show;
    });
  }

  dispose(): void {
    this.hit.geometry.dispose();
    this.hit.material.dispose();
    for (const mesh of [this.dot, this.rim, this.halo, ...this.waves]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
