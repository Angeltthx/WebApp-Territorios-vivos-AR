import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Texture,
} from 'three';
import type { ArModel } from '@domain/entities/ArModel';
import type { IconView } from '@domain/value-objects/IconPose';
import type { MarkerSpot } from '@domain/value-objects/MarkerSpot';
import {
  offsetOutline,
  prepareOutline,
  traceIconSilhouette,
  type SilhouettePoint,
} from './IconSilhouette';
import { SmokePuff } from './SmokePuff';
import { ICON_TARGET_SIZE, type LoadedIcon } from './IconLoader';
import { IconAnimator } from './IconAnimator';
import { TapChoreography } from './TapChoreography';
import { WaterSplash } from './WaterSplash';

const PULSE_DURATION_S = 0.45;
const PULSE_AMPLITUDE = 0.3;

/**
 * Los iconos se modelan a tamaño cómodo de leer en PrimitiveFactory y se
 * reducen aquí. A tamaño natural tapaban por completo al animal que están
 * señalando, que es justo lo contrario de lo que debe hacer una chincheta:
 * a esta escala la ilustración de debajo se sigue viendo.
 */
const ICON_SCALE = 0.72;
/**
 * Cuánto puede asomar un icono por fuera del borde de la imagen, en anchos
 * de mapa. Era un margen NEGATIVO (0.018 hacia dentro), y con él la pava
 * —dibujada casi tocando el borde derecho— no podía crecer más que una
 * uña por mucho que se subiera su `iconSize`. Asomar un poco no rompe
 * nada: el modelo flota en 3D delante del papel, no está impreso en él.
 */
const MAP_EDGE_OVERHANG = 0.03;
/** Holgura para poses de animación que sobresalen de la caja en reposo. */
const ANIMATION_EXTENT_MARGIN = 1.15;
/** Dónde rompe el agua respecto al centro del animal, en tamaños de animal. */
const WATERLINE = -0.12;
/** El salpicón va algo por delante del animal, para que no lo tape su cuerpo. */
const WATER_FRONT = 0.12;

/** Altura MÍNIMA a la que flota el icono sobre el papel, en anchos de mapa. */
const HOVER_HEIGHT = 0.11;
/** Holgura entre lo más bajo del icono y el papel, cuando hay que subirlo. */
const CLEARANCE = 0.02;
const BOB_AMPLITUDE = 0.016;
const BOB_SPEED = 1.7;

/** Cuánto crece el icono destacado. */
const EMPHASIS_SCALE = 0.2;
const EMPHASIS_SPEED = 6;

const TAP_RADIUS = 0.12;

/** Lo que tarda un animal en materializarse, y en volver a esconderse. */
const REVEAL_TIME_S = 0.55;
const CONCEAL_TIME_S = 0.3;

/**
 * El contorno punteado que marca donde hay un animal esperando.
 *
 * Su trabajo es decir "aqui hay algo, ven a buscarlo" sin tapar el dibujo
 * que hay debajo, y para eso tiene que GANARLE al dibujo, que es una
 * ilustracion a todo color y llena de detalle.
 *
 * DORADO Y NO BLANCO. Empezo blanco, para hablar el mismo idioma que el
 * visor de "Apunta al mapa", y en el telefono no lo veia nadie: el mapa ya
 * esta lleno de blancos —los rotulos, las etiquetas de cada especie, la
 * espuma de las olas, las nubes— asi que una linea blanca mas se lee como
 * parte de la ilustracion. El dorado no aparece en el mapa, y los cuatro
 * animales estan sobre fondos oscuros (mar turquesa tres de ellos, selva
 * verde la pava), que es justo donde un calido destaca.
 *
 * El visor de la guia sigue siendo blanco a proposito: encuadra el mapa
 * entero y no invita a acercarse a nada. Blanco = "encuadra aqui";
 * dorado = "hay algo que descubrir".
 *
 * Se construye con planos sueltos en vez de con LineDashedMaterial porque
 * el grosor de linea de WebGL esta clavado a 1 pixel en la practica: en un
 * movil de alta densidad, una linea de 1 px es invisible.
 */
const OUTLINE_DASHES = 68;
const OUTLINE_COLOUR = 0xffc53d;
const OUTLINE_THICKNESS = 0.0065;
const OUTLINE_OPACITY = 0.92;
/**
 * Separación entre un contorno CALCADO DEL DIBUJO y el borde del dibujo, en
 * anchos de mapa. Los calcados del modelo ya salen separados de fábrica
 * (IconSilhouette engorda la mancha antes de recorrerla).
 */
const DRAWN_OUTLINE_OFFSET = 0.009;
/**
 * El LATIDO del contorno: crece de golpe, vuelve, y descansa.
 *
 * Antes respiraba con un seno continuo de un 2%, y un movimiento lento y
 * constante es justo el que el ojo deja de ver a los dos segundos. Un
 * latido con silencio entre medias no: el silencio es lo que hace que el
 * siguiente se note. Sube y baja en `RISE` y espera hasta completar
 * `PERIOD`, y al crecer tambien se aclara —tamaño y brillo a la vez, para
 * que se vea igual en un movil al sol.
 *
 * Cada pin lleva su desfase (`phase`), asi que los cuatro no laten a la
 * vez: cuatro contornos sincronizados parecen un efecto de la pantalla;
 * desacompasados parecen cuatro cosas vivas.
 */
const OUTLINE_PULSE_PERIOD_S = 2.4;
const OUTLINE_PULSE_RISE_S = 0.62;
const OUTLINE_PULSE_SCALE = 0.11;
const OUTLINE_PULSE_GLOW = 0.08;

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
 * Los modelos vienen con +Y arriba y mirando hacia su +Z (comprobado con los
 * cuatro en /verify.html). El mapa está en el plano XY del anchor, con +Z
 * saliendo del papel hacia la cámara.
 *
 *   'front' sin giro: el +Y del modelo es el +Y del anchor y su frente, el
 *           +Z, sale del papel. El animal se yergue sobre el mapa MIRANDO A
 *           LA CÁMARA. Es la que usan los cuatro.
 *
 *   'top'   giro de 90° en X: el +Y del modelo pasa a ser el +Z del anchor.
 *           El animal se apoya sobre el papel y quien mira desde arriba le
 *           ve el lomo, como está dibujado un animal en planta.
 *
 *   'side'  giro de −90° en Y: el +Y del modelo sigue siendo el +Y del
 *           anchor y su frente cae sobre −X. Queda de perfil, como una
 *           figura de cartón levantada sobre el papel.
 *
 * En los tres casos el giro que hace el usuario (`Placement.rotationY`) se
 * aplica DENTRO de este grupo, sobre el eje Y propio del icono, así que
 * sigue girando en el sitio y no lo despega de su animal. Con 'front' ese
 * eje es la vertical del mapa: arrastrar el dedo los hace girar hacia los
 * lados, como una peana.
 */
function applyView(lift: Group, view: IconView): void {
  if (view === 'top') {
    lift.rotation.set(Math.PI / 2, 0, 0);
    return;
  }
  if (view === 'side') {
    lift.rotation.set(0, -Math.PI / 2, 0);
    return;
  }
  lift.rotation.set(0, 0, 0);
}

/**
 * Un icono clavado a un punto del mapa: zona de toque invisible y el icono
 * flotando hacia fuera.
 *
 * Hubo un halo —un anillo tumbado sobre el papel— que marcaba el sitio y
 * señalaba cuál era el último animal tocado. Se quitó: sobre la
 * ilustración se leía como un circulito translúcido pegado a cada animal y
 * ensuciaba el dibujo, que es exactamente lo que esta capa no debe hacer.
 * El destacado no se pierde, se mueve al propio icono: el elegido se queda
 * un 20% más grande (EMPHASIS_SCALE), y el toque sigue dando su pulso.
 *
 * Vive aparte de ThreeSceneAdapter a propósito: no depende de MindAR ni del
 * runtime, así que la página de verificación (`verify.html`) puede montar
 * exactamente estos mismos pines sobre una foto del mapa y comprobar que
 * caen donde deben, sin cámara ni teléfono.
 */
export class MarkerPin {
  readonly group = new Group();

  private readonly lift = new Group();
  private readonly outline = new Group();
  private readonly outlineMaterial: MeshBasicMaterial;
  private readonly smoke = new SmokePuff();
  private readonly splash: WaterSplash | null;
  private readonly icon: Object3D;
  private readonly animator: IconAnimator;
  private readonly choreography: TapChoreography;
  /** Segundo del clip de toque en que cae al agua (la ballena), o null. */
  private readonly splashAt: number | null;
  private lastTapClipTime: number | null = null;
  /** Lo que mide el icono a escala 1, para convertir "tamaños de animal" en distancia. */
  private readonly reach: number;
  /** Desfase del vaivén, para que los iconos no floten todos al unísono. */
  private readonly phase: number;

  /** Si este animal está a la vista o todavía escondido tras su contorno. */
  private revealed = false;
  /**
   * Si está en primer plano. Mientras lo esté, el icono NO cuelga de aquí:
   * se lo lleva el adaptador a su escenario delante de la cámara, y este
   * pin deja de tocarlo para no pelearse con él por la escala.
   */
  private focused = false;
  /** 0 = escondido del todo, 1 = materializado. Lo anima `advance`. */
  private revealProgress = 0;

  private pulseRemaining = 0;
  private emphasis = 0;
  private emphasisTarget = 0;
  private scale = 1;
  private spin = 0;
  private bob = 0;
  private idleSway = 0;
  /** 0 en reposo, 1 en la cima del latido. Lo calcula `advance`. */
  private outlinePulse = 0;
  /** Giro propio del animal, del catálogo. Se suma al del usuario. */
  private readonly facing: number;
  private readonly view: IconView;
  /**
   * Medio fondo del icono a escala 1, medido tras orientarlo.
   *
   * Un modelo largo puede extenderse hacia fuera del papel. Se mide su fondo
   * para elevarlo solo lo necesario: la vista AR no dibuja ningún plano que
   * oculte la parte del modelo que quede por detrás del papel.
   */
  private readonly halfDepth: number;
  /** Límite de escala para que ni el giro ni el pulso saquen el icono del mapa. */
  private readonly maxMapScale: number;
  private readonly idleTilt: number;

  constructor(
    model: ArModel,
    loaded: LoadedIcon,
    index: number,
    targetAspect: number,
  ) {
    this.icon = loaded.object;
    this.animator = new IconAnimator(this.icon, loaded.animations, model.animation);
    this.phase = index * 1.7;
    const tapMove = model.animation?.tapMove ?? 'none';
    this.choreography = new TapChoreography(tapMove);
    this.splashAt = loaded.splashAt;
    this.reach = ICON_TARGET_SIZE * model.pose.size;
    // Un balanceo leve y continuo, por encima del clip ambiental: el Idle
    // de la pava apenas mueve huesos y, sin esto, parecía una figura quieta.
    this.idleTilt = model.id.value === 'bird' ? 0.05 : model.id.value === 'crab' ? 0.02 : 0.03;
    // Solo salpica lo que vive en el agua y hace algo con ella al tocarlo.
    this.splash = tapMove === 'breach' || tapMove === 'dive' ? new WaterSplash() : null;

    const { x, y } = anchorPositionOf(model.spot, targetAspect);
    this.group.position.set(x, y, 0);
    // Cada icono lleva su id encima: así el raycast sabe a qué animal le
    // acertó sin depender del orden de la escena.
    this.group.userData['modelId'] = model.id.value;
    // El icono conserva su identidad cuando se presta al primer plano.
    this.icon.userData['modelId'] = model.id.value;

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
    this.view = model.pose.view;
    this.lift.position.z = HOVER_HEIGHT;
    this.lift.add(this.icon);
    this.group.add(this.lift);

    const bounds = measureIconBounds(this.group, this.lift, this.icon);
    this.halfDepth = bounds.halfDepth;
    const horizontalRoom = Math.min(model.spot.u, 1 - model.spot.u) + MAP_EDGE_OVERHANG;
    const verticalRoom = Math.min(model.spot.v, 1 - model.spot.v) * targetAspect + MAP_EDGE_OVERHANG;
    this.maxMapScale = Math.min(
      horizontalRoom / Math.max(bounds.horizontalRadius * ANIMATION_EXTENT_MARGIN, 0.001),
      verticalRoom / Math.max(bounds.verticalRadius * ANIMATION_EXTENT_MARGIN, 0.001),
    );

    // El contorno NO es un circulo: se CALCA del modelo. IconSilhouette lo
    // aplasta contra el papel desde la cara que diga el catalogo y recorre
    // el borde de la mancha que sale, asi que la pava sale con forma de
    // pava y la ballena con su cintura y su cola. Como se deduce del .glb,
    // cambiar un modelo redibuja su contorno solo.
    this.outlineMaterial = new MeshBasicMaterial({
      color: OUTLINE_COLOUR,
      transparent: true,
      opacity: OUTLINE_OPACITY,
      side: DoubleSide,
      depthWrite: false,
    });
    buildDashedSilhouette(
      this.outline,
      outlineLoopOf(model, this.icon, targetAspect),
      this.outlineMaterial,
    );
    this.outline.position.z = 0.002;
    this.group.add(this.outline);

    this.group.add(this.smoke.group);
    if (this.splash !== null) this.group.add(this.splash.group);

    this.sync();
  }

  highlight(on: boolean): void {
    this.emphasisTarget = on ? 1 : 0;
  }

  pulse(): void {
    this.pulseRemaining = PULSE_DURATION_S;
    this.animator.react();
    this.choreography.start();
    this.lastTapClipTime = null;
  }

  /** El salpicón, para que el primer plano lo cuelgue junto al icono prestado. */
  get waterGroup(): Group | null {
    return this.splash?.group ?? null;
  }

  /** Devuelve el salpicón a este pin cuando el icono vuelve del primer plano. */
  reclaimWater(): void {
    if (this.splash !== null) this.group.add(this.splash.group);
  }

  /**
   * Coloca el icono con el gesto de toque encima: lo usan este pin sobre el
   * mapa y el adaptador en el primer plano, así que el animal hace lo mismo
   * en los dos sitios. Quien llama ya ha puesto la escala base; aquí se le
   * suman desplazamiento, giros y profundidad.
   *
   * Los desplazamientos van en el eje Y del padre, que es "arriba" en
   * pantalla tanto de frente como de perfil (`applyView` solo gira en Y) y
   * en el escenario del primer plano.
   */
  poseIcon(yaw: number, roll = 0): void {
    const move = this.choreography.pose;
    const size = this.reach * this.icon.scale.x;
    this.icon.position.set(move.sway * size, move.rise * size, 0);
    this.icon.rotation.set(move.pitch, yaw + move.yaw, roll + move.roll);
    this.icon.scale.multiplyScalar(move.depth);
  }

  /** Pone el salpicón en la línea de agua del icono. `baseZ`: el frente del icono. */
  placeWater(baseZ: number): void {
    if (this.splash === null) return;
    const size = (this.reach * this.icon.scale.x) / this.choreography.pose.depth;
    this.splash.group.position.set(0, WATERLINE * size, baseZ + WATER_FRONT * size);
    this.splash.group.scale.setScalar(size);
  }

  /**
   * Saca al animal de su escondite, o lo devuelve a el.
   *
   * Quien decide esto es ThreeSceneAdapter, que es el unico que sabe donde
   * esta la camara. Aqui solo se dispara la animacion, y el humo, que se
   * lanza unicamente al aparecer: verlo tambien al esconderse convertiria
   * un detalle en un tic.
   */
  setRevealed(revealed: boolean): void {
    if (this.revealed === revealed) return;
    this.revealed = revealed;
    if (revealed) {
      this.smoke.burst();
      this.animator.start();
    }
  }

  get isRevealed(): boolean {
    return this.revealed;
  }

  /**
   * Suelta el icono para que lo muestre otro (el primer plano).
   *
   * A partir de aquí este pin deja de escribir su escala y su giro: si
   * siguiera haciéndolo lo devolvería al tamaño de chincheta en cada
   * fotograma. Se devuelve el objeto para que quien lo pide lo cuelgue
   * donde toque.
   */
  releaseIcon(): Object3D {
    this.focused = true;
    this.lift.remove(this.icon);
    return this.icon;
  }

  /** Recupera el icono y vuelve a mandar sobre él. */
  reclaimIcon(): void {
    if (!this.focused) return;
    this.focused = false;
    this.lift.add(this.icon);
    this.sync();
  }

  /**
   * Con qué giro empieza en el primer plano para enseñar la MISMA cara que
   * en el mapa. Allí el escenario no aplica `applyView`, así que la ballena
   * —de perfil sobre el mapa— salía de morro hacia la cámara.
   */
  get stageYaw(): number {
    return this.facing + (this.view === 'side' ? -Math.PI / 2 : 0);
  }

  get isFocused(): boolean {
    return this.focused;
  }

  /** Rotación y escala se aplican al icono SOBRE SÍ MISMO, nunca a su
   *  posición: debe seguir señalando a su animal pase lo que pase. */
  applyTransform(scale: number, spin: number): void {
    this.scale = scale;
    this.spin = spin;
    this.sync();
  }

  advance(deltaSeconds: number, elapsed: number): void {
    this.animator.update(deltaSeconds);
    let splash = this.choreography.advance(deltaSeconds);
    // La ballena salpica cuando SU CLIP la hace caer, no a un tiempo fijo:
    // así sigue cuadrando aunque cambie `tapSpeed`.
    const clipTime = this.animator.tapClipTime;
    if (this.splashAt !== null && clipTime !== null) {
      const before = this.lastTapClipTime ?? -1;
      if (before < this.splashAt && clipTime >= this.splashAt) splash = 1;
    }
    this.lastTapClipTime = clipTime;
    if (splash !== null) this.splash?.burst(splash);
    // Aparecer cuesta mas que desaparecer: la entrada tiene que dar tiempo
    // a mirarla, la salida solo tiene que no dar un tiron.
    const step = deltaSeconds / (this.revealed ? REVEAL_TIME_S : CONCEAL_TIME_S);
    this.revealProgress = clamp01(this.revealProgress + (this.revealed ? step : -step));

    this.smoke.advance(deltaSeconds);
    this.splash?.advance(deltaSeconds);

    if (this.pulseRemaining > 0) {
      this.pulseRemaining = Math.max(0, this.pulseRemaining - deltaSeconds);
    }
    this.emphasis +=
      (this.emphasisTarget - this.emphasis) * Math.min(1, deltaSeconds * EMPHASIS_SPEED);

    // Vaivén suave: da sensación de que el icono flota sobre el papel.
    this.bob = Math.sin(elapsed * BOB_SPEED + this.phase) * BOB_AMPLITUDE;
    this.idleSway = Math.sin(elapsed * 1.35 + this.phase) * this.idleTilt;

    // El contorno late: un contorno quieto sobre una ilustracion quieta no
    // se distingue de la propia ilustracion.
    const beat = (elapsed + this.phase) % OUTLINE_PULSE_PERIOD_S;
    this.outlinePulse =
      beat < OUTLINE_PULSE_RISE_S ? Math.sin((beat / OUTLINE_PULSE_RISE_S) * Math.PI) : 0;
    this.outline.scale.setScalar(1 + OUTLINE_PULSE_SCALE * this.outlinePulse);

    this.sync();
  }

  dispose(): void {
    this.animator.dispose();
    this.smoke.dispose();
    if (this.splash !== null) {
      this.splash.group.removeFromParent();
      this.splash.dispose();
    }
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

    // La materializacion se aplica a la escala del icono: sale creciendo
    // desde el papel, con un pelin de rebote al final.
    const materialised = easeOutBack(this.revealProgress);
    const applied = Math.min(size * ICON_SCALE * materialised, this.maxMapScale);

    this.lift.visible = this.revealProgress > 0.001 && !this.focused;
    if (!this.focused) this.icon.scale.setScalar(Math.max(applied, 0.0001));

    // El contorno se apaga a medida que el animal ocupa su sitio.
    this.outline.visible = this.revealProgress < 0.999;
    this.outlineMaterial.opacity =
      Math.min(1, OUTLINE_OPACITY + OUTLINE_PULSE_GLOW * this.outlinePulse) *
      (1 - this.revealProgress);

    // Los iconos flotan lo justo para quedar delante del papel: un modelo
    // de frente puede extenderse hacia la cámara, y se sube su medio fondo.
    const hover = Math.max(HOVER_HEIGHT, this.halfDepth * applied + CLEARANCE);
    this.lift.position.z = hover + this.bob;
    // Giro propio del animal (catálogo) MÁS el del usuario, sobre el mismo
    // eje: el Y local del icono, que `applyView` ya dejó donde toca.
    if (!this.focused) {
      this.poseIcon(this.facing + this.spin, this.idleSway);
      this.placeWater(this.lift.position.z);
    }
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
/**
 * Cuánto sobresale el icono hacia el papel, a escala 1 y ya orientado.
 *
 * Se mide sobre `lift` —no sobre el modelo suelto— porque es el giro de
 * `applyView` el que decide qué eje del modelo acaba apuntando a la cámara,
 * y por tanto cuál es el que puede hundirse.
 */
function measureIconBounds(
  group: Group,
  lift: Group,
  icon: Object3D,
): { halfDepth: number; horizontalRadius: number; verticalRadius: number } {
  const scale = icon.scale.clone();
  const z = lift.position.z;

  icon.scale.setScalar(1);
  lift.position.z = 0;
  group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(lift);

  // TRAMPA: setFromObject devuelve la caja en coordenadas de MUNDO, y este
  // grupo ya está trasladado hasta su animal. Sin descontar esa posición,
  // el "ancho" medido incluye la distancia desde el centro del mapa: la
  // pava, que está en el borde derecho, salía casi cuatro veces más ancha
  // de lo que es, y el cangrejo —que cae casi en el centro— era el único
  // que parecía correcto. En este punto el grupo aún no tiene padre y no
  // gira ni escala, así que restar su posición devuelve la caja local
  // exacta.
  box.translate(group.position.clone().negate());

  icon.scale.copy(scale);
  lift.position.z = z;
  group.updateMatrixWorld(true);

  if (box.isEmpty()) return { halfDepth: 0, horizontalRadius: 0, verticalRadius: 0 };
  const halfX = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
  const halfY = Math.max(Math.abs(box.min.y), Math.abs(box.max.y));
  const halfZ = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
  return {
    halfDepth: halfZ,
    // Lo que ocupa de lado TAL COMO SE VE, no girado. Contar el fondo como
    // si el usuario siempre lo tuviera girado a 90° encogía a la pava —con
    // la cola hacia atrás, es más honda que ancha— a la mitad, solo por
    // vivir junto al borde. Si alguien la gira, asoma un poco: se acepta.
    horizontalRadius: halfX,
    verticalRadius: halfY,
  };
}

/**
 * El contorno de este animal, ya en coordenadas del pin.
 *
 * Dos procedencias, y la del catálogo manda:
 *
 *  - `outlineShape` CALCADO DEL DIBUJO del mapa. Se usa cuando el dibujo
 *    está en una pose que el modelo no puede dar: la ballena del mapa bucea
 *    con la cola alzada y la aleta extendida, y ninguna proyección rígida
 *    del .glb —ni de frente, ni de perfil, ni desde arriba— se parece a eso.
 *    Sus puntos vienen en coordenadas de la IMAGEN, igual que `spot`, así
 *    que se convierten a coordenadas del anchor y se les resta la posición
 *    del pin, que ya está en el sitio.
 *  - Deducido del modelo con IconSilhouette, que es lo que hacen los otros
 *    tres. Ese viene en unidades de icono y hay que pasarlo a la escala a la
 *    que el icono se ve de verdad sobre el mapa (ICON_SCALE).
 */
function outlineLoopOf(
  model: ArModel,
  icon: Object3D,
  targetAspect: number,
): SilhouettePoint[] {
  if (model.outlineShape.length >= 3) {
    const origin = anchorPositionOf(model.spot, targetAspect);
    const drawn = model.outlineShape.map((point) => {
      const at = anchorPositionOf(point, targetAspect);
      return { x: at.x - origin.x, y: at.y - origin.y };
    });
    return offsetOutline(prepareOutline(drawn, OUTLINE_DASHES), DRAWN_OUTLINE_OFFSET);
  }

  const traced = traceIconSilhouette(icon, model.pose, OUTLINE_DASHES);
  return traced.map((point) => ({ x: point.x * ICON_SCALE, y: point.y * ICON_SCALE }));
}

/**
 * Cuelga de `target` los trazos discontinuos que siguen el contorno, EN UNA
 * SOLA MALLA.
 *
 * Cada trazo se orienta segun la direccion que llevan sus vecinos, no la
 * suya propia: usar el angulo del punto los dejaria todos apuntando al
 * centro, como los radios de una rueda, en vez de seguir el borde.
 *
 * UNA MALLA Y NO 68. Antes cada trazo era un `Mesh` con su propio
 * `PlaneGeometry`: 68 por animal, 272 en los cuatro, y cada uno es una
 * llamada de dibujo que la CPU tiene que preparar y enviar SESENTA VECES
 * POR SEGUNDO. En un iPhone reciente no se nota; en un Samsung de gama
 * baja, donde la CPU ya va justa con la deteccion de MindAR, ese trabajo
 * compite con el rastreo y es parte de por que los animales se quedaban
 * quietos y reaccionaban tarde al mover el telefono.
 *
 * Los trazos nunca se mueven por separado —el latido escala el grupo
 * entero—, asi que no hay ninguna razon para que sean objetos distintos:
 * se cosen aqui, ya girados y colocados, en un unico buffer de vertices.
 * Cuatro llamadas de dibujo en vez de 272, y el resultado en pantalla es
 * exactamente el mismo.
 */
function buildDashedSilhouette(
  target: Group,
  loop: readonly SilhouettePoint[],
  material: MeshBasicMaterial,
): void {
  const n = loop.length;
  const positions = new Float32Array(n * 6 * 3);
  const half = OUTLINE_THICKNESS / 2;
  let at = 0;

  const put = (x: number, y: number): void => {
    positions[at] = x;
    positions[at + 1] = y;
    positions[at + 2] = 0;
    at += 3;
  };

  for (let i = 0; i < n; i += 1) {
    const point = loop[i]!;
    const next = loop[(i + 1) % n]!;
    const previous = loop[(i - 1 + n) % n]!;

    const length = Math.max(Math.hypot(next.x - point.x, next.y - point.y) * 0.62, 0.004);
    const angle = Math.atan2(next.y - previous.y, next.x - previous.x);

    // Ejes del trazo: `a` lo recorre a lo largo, `b` lo engorda.
    const ax = (Math.cos(angle) * length) / 2;
    const ay = (Math.sin(angle) * length) / 2;
    const bx = -Math.sin(angle) * half;
    const by = Math.cos(angle) * half;

    // Dos triangulos por trazo, en el mismo orden que daba PlaneGeometry.
    put(point.x - ax + bx, point.y - ay + by);
    put(point.x - ax - bx, point.y - ay - by);
    put(point.x + ax + bx, point.y + ay + by);

    put(point.x - ax - bx, point.y - ay - by);
    put(point.x + ax - bx, point.y + ay - by);
    put(point.x + ax + bx, point.y + ay + by);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  target.add(new Mesh(geometry, material));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Entrada con un rebote corto al final. Un crecimiento lineal parece que la
 * app va lenta; el rebote hace que el animal se lea como que SALTA fuera
 * del papel.
 */
function easeOutBack(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function disposeMaterial(material: unknown): void {
  if (material === null || typeof material !== 'object') return;

  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }

  if ('dispose' in material && typeof material.dispose === 'function') {
    (material as { dispose(): void }).dispose();
  }
}
