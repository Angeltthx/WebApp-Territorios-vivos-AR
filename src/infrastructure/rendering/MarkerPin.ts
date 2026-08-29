import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  Texture,
} from 'three';
import type { ArModel } from '@domain/entities/ArModel';
import type { IconView } from '@domain/value-objects/IconPose';
import type { MarkerSpot } from '@domain/value-objects/MarkerSpot';

const PULSE_DURATION_S = 0.45;
const PULSE_AMPLITUDE = 0.3;

/**
 * Los iconos se modelan a tamaño cómodo de leer en PrimitiveFactory y se
 * reducen aquí. A tamaño natural tapaban por completo al animal que están
 * señalando, que es justo lo contrario de lo que debe hacer una chincheta:
 * a esta escala el halo queda por fuera y la ilustración se sigue viendo.
 */
const ICON_SCALE = 0.58;

/** Altura a la que flota el icono sobre el papel, en anchos de mapa. */
const HOVER_HEIGHT = 0.11;
const BOB_AMPLITUDE = 0.016;
const BOB_SPEED = 1.7;

/** Cuánto crece y cuánto se ilumina el halo del icono destacado. */
const EMPHASIS_SCALE = 0.2;
const EMPHASIS_SPEED = 6;

const HALO_INNER = 0.085;
const HALO_OUTER = 0.1;
const TAP_RADIUS = 0.12;

/**
 * Convierte un punto de la imagen del marcador a coordenadas del anchor.
 *
 * SISTEMA DE COORDENADAS DEL ANCHOR, verificado en el código de MindAR
 * (`image-target/three.js` líneas 214-229, y el comentario que documenta
 * `controller.js:_glModelViewMatrix`):
 *
 *   - El origen es el CENTRO de la imagen del marcador.
 *   - El ANCHO de la imagen mide 1 unidad; el alto mide `targetAspect`.
 *   - +X va a la derecha y +Y hacia ARRIBA. Ojo: MindAR invierte el eje Y
 *     de la imagen (`y' = h - y`), así que v=0 (arriba del archivo) es +Y.
 *   - +Z sale del papel hacia la cámara.
 */
export function anchorPositionOf(
  spot: MarkerSpot,
  targetAspect: number,
): { readonly x: number; readonly y: number } {
  return {
    x: spot.u - 0.5,
    y: (0.5 - spot.v) * targetAspect,
  };
}

/**
 * Tumba el icono sobre el mapa según desde qué cara hay que mirarlo.
 *
 * Los modelos vienen con +Y arriba y su eje largo en +Z. El mapa está en el
 * plano XY del anchor, con +Z saliendo del papel hacia la cámara.
 *
 *   'top'   giro de 90° en X: el +Y del modelo pasa a ser el +Z del anchor.
 *           El animal se apoya sobre el papel y quien mira el mapa desde
 *           arriba le ve el lomo. Es lo que quieres para el cangrejo y la
 *           tortuga, dibujados en planta.
 *
 *   'side'  giro de −90° en Y, sin tocar X: el +Y del modelo sigue siendo el
 *           +Y del anchor (arriba EN EL PLANO del mapa) y su eje largo cae
 *           sobre −X. El animal queda de perfil, como una figura de cartón
 *           levantada sobre el papel, y desde arriba se le ve el costado.
 *           Es lo que quieres para la ballena y la pava.
 *
 * En ambos casos el giro que hace el usuario (`Placement.rotationY`) se
 * aplica DENTRO de este grupo, sobre el eje Y propio del icono, así que
 * sigue girando en el sitio y no lo despega de su animal.
 */
function applyView(lift: Group, view: IconView): void {
  if (view === 'side') {
    lift.rotation.set(0, -Math.PI / 2, 0);
    return;
  }
  lift.rotation.set(Math.PI / 2, 0, 0);
}

/**
 * Un icono clavado a un punto del mapa: halo tumbado sobre el papel, zona
 * de toque, y el icono flotando hacia fuera.
 *
 * Vive aparte de ThreeSceneAdapter a propósito: no depende de MindAR ni del
 * runtime, así que la página de verificación (`verify.html`) puede montar
 * exactamente estos mismos pines sobre una foto del mapa y comprobar que
 * caen donde deben, sin cámara ni teléfono.
 */
export class MarkerPin {
  readonly group = new Group();

  private readonly lift = new Group();
  private readonly halo: Mesh;
  private readonly haloMaterial: MeshBasicMaterial;
  /** Desfase del vaivén, para que los iconos no floten todos al unísono. */
  private readonly phase: number;

  private pulseRemaining = 0;
  private emphasis = 0;
  private emphasisTarget = 0;
  private scale = 1;
  private spin = 0;
  /** Giro propio del animal, del catálogo. Se suma al del usuario. */
  private readonly facing: number;

  constructor(
    model: ArModel,
    private readonly icon: Object3D,
    index: number,
    targetAspect: number,
  ) {
    this.phase = index * 1.7;

    const { x, y } = anchorPositionOf(model.spot, targetAspect);
    this.group.position.set(x, y, 0);
    // Cada icono lleva su id encima: así el raycast sabe a qué animal le
    // acertó sin depender del orden de la escena.
    this.group.userData['modelId'] = model.id.value;

    this.haloMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    // RingGeometry ya nace en el plano XY, que es justo el plano del mapa.
    this.halo = new Mesh(new RingGeometry(HALO_INNER, HALO_OUTER, 48), this.haloMaterial);
    this.halo.position.z = 0.002;
    this.group.add(this.halo);

    // Zona de toque generosa e invisible: acertarle a un icono pequeño con
    // el dedo, a pulso y con el teléfono en la mano, es difícil. Se usa
    // `opacity: 0` en vez de `visible: false` porque el raycaster sí
    // atraviesa lo invisible, pero no lo transparente.
    const hit = new Mesh(
      new CircleGeometry(TAP_RADIUS, 24),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.position.z = 0.001;
    this.group.add(hit);

    // Los iconos se modelan con +Y arriba (lo natural en Three.js). Cómo se
    // tumba ese "arriba" sobre el mapa depende del animal: ver applyView.
    applyView(this.lift, model.pose.view);
    this.facing = model.pose.facing;
    this.lift.position.z = HOVER_HEIGHT;
    this.lift.add(icon);
    this.group.add(this.lift);

    this.sync();
  }

  highlight(on: boolean): void {
    this.emphasisTarget = on ? 1 : 0;
  }

  pulse(): void {
    this.pulseRemaining = PULSE_DURATION_S;
  }

  /** Rotación y escala se aplican al icono SOBRE SÍ MISMO, nunca a su
   *  posición: debe seguir señalando a su animal pase lo que pase. */
  applyTransform(scale: number, spin: number): void {
    this.scale = scale;
    this.spin = spin;
    this.sync();
  }

  advance(deltaSeconds: number, elapsed: number): void {
    if (this.pulseRemaining > 0) {
      this.pulseRemaining = Math.max(0, this.pulseRemaining - deltaSeconds);
    }
    this.emphasis +=
      (this.emphasisTarget - this.emphasis) * Math.min(1, deltaSeconds * EMPHASIS_SPEED);

    // Vaivén suave: da sensación de que el icono flota sobre el papel.
    this.lift.position.z = HOVER_HEIGHT + Math.sin(elapsed * BOB_SPEED + this.phase) * BOB_AMPLITUDE;

    this.sync();
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const material: unknown = object.material;
      if (Array.isArray(material)) {
        material.forEach(disposeMaterial);
      } else {
        disposeMaterial(material);
      }
    });
  }

  private sync(): void {
    const progress = this.pulseRemaining / PULSE_DURATION_S;
    const bump = 1 + PULSE_AMPLITUDE * Math.sin(progress * Math.PI);
    const emphasised = 1 + EMPHASIS_SCALE * this.emphasis;
    const size = this.scale * emphasised * bump;

    this.icon.scale.setScalar(size * ICON_SCALE);
    // Giro propio del animal (catálogo) MÁS el del usuario, sobre el mismo
    // eje: el Y local del icono, que `applyView` ya dejó donde toca.
    this.icon.rotation.y = this.facing + this.spin;

    this.halo.scale.setScalar(size);
    this.haloMaterial.opacity = 0.22 + 0.5 * this.emphasis + 0.25 * (bump - 1);
  }
}

/**
 * Libera un material y TAMBIÉN sus texturas.
 *
 * Con los iconos procedurales daba igual: no tenían ninguna. Los .glb de la
 * fauna traen tres mapas cada uno (color, normal, metallic-roughness), que
 * son varios megas de memoria de GPU. `material.dispose()` NO libera las
 * texturas —three las trata como recursos compartidos, porque dos
 * materiales pueden apuntar al mismo mapa—, así que hay que recorrer sus
 * propiedades y soltarlas a mano o se filtran en cada `clear()`.
 */
function disposeMaterial(material: unknown): void {
  if (material === null || typeof material !== 'object') return;

  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }

  if ('dispose' in material && typeof material.dispose === 'function') {
    (material as { dispose(): void }).dispose();
  }
}
