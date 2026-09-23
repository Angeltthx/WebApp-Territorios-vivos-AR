import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3 as ThreeVector3,
} from 'three';
import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { Discovery } from '@domain/value-objects/Discovery';
import { ModelId } from '@domain/value-objects/ModelId';
import { Proximity } from '@domain/value-objects/Proximity';
import { Stabilization } from '@domain/value-objects/Stabilization';
import type { ScenePort } from '@application/ports/ScenePort';
import type { MindArRuntime } from '../mindar/MindArRuntime';
import { IconLoader } from './IconLoader';
import { MarkerPin } from './MarkerPin';

/**
 * Adaptador de render.
 *
 * Jerarquía deliberada:
 *   scene → follower (pose del marcador, SUAVIZADA)
 *             → overlay (ajuste global)
 *               → MarkerPin ×4 (uno por animal, CLAVADO a su punto del mapa)
 *
 * El contenido NO cuelga directamente del anchor de MindAR. Colgarlo hace
 * que herede el temblor cuadro a cuadro del motor de visión. En su lugar
 * copiamos la pose del anchor cada frame con interpolación exponencial.
 * Es la mejora más perceptible en estabilidad, y el nivel se ajusta en
 * caliente desde la UI.
 *
 * La geometría de cada pin y la conversión de coordenadas viven en
 * MarkerPin, que no depende de MindAR y por eso se puede verificar sin
 * cámara.
 */
/**
 * A qué distancia de la cámara se planta el animal en primer plano, medido
 * en anchos de mapa. Tiene que quedar MÁS CERCA que el marcador para que se
 * dibuje por delante de él: el mapa suele estar a más de un ancho.
 */
const STAGE_DISTANCE = 0.5;
/** Cuánto del alto de la pantalla puede ocupar el animal en primer plano. */
const STAGE_FILL = 0.42;
/** Giro lento de cortesía, para que se vea que es un objeto y no una foto. */
const STAGE_IDLE_SPIN = 0.25;

export class ThreeSceneAdapter implements ScenePort {
  private readonly follower = new Group();
  private readonly overlay = new Group();
  private readonly stage = new Group();
  /** Superficie invisible y generosa para que el primer plano sea fácil de tocar. */
  private readonly stageHit = new Mesh(
    new CircleGeometry(1, 24),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
  );
  private readonly pins = new Map<string, MarkerPin>();

  private stabilization: Stabilization = Stabilization.default();
  private proximity: Proximity = Proximity.default();
  private elapsed = 0;
  private hasPose = false;
  private mounted = false;
  private unsubscribeFrame: (() => void) | null = null;

  /** Qué animal está dentro del alcance de la cámara ahora mismo. */
  private nearbyId: string | null = null;
  private nearbyListener: ((modelId: string | null) => void) | null = null;

  /** El animal en primer plano: su id, su icono prestado y sus medidas naturales. */
  private focusedId: string | null = null;
  private stagedIcon: Object3D | null = null;
  private readonly stagedNaturalSize = new ThreeVector3(1, 1, 1);
  private stageIdle = 0;
  /** Giro que el usuario imprime con el dedo. */
  private spin = 0;
  private scale = 1;
  private stagePulse = 0;
  /**
   * Cuánto mide un ancho de mapa en unidades de mundo, del último fotograma
   * con marcador a la vista. Se guarda para que el primer plano siga
   * colocado aunque el mapa se salga de cuadro: alejar la cámara no debe
   * cerrar la ficha.
   */
  private unit = 1;
  /** Para no inundar la consola: la calibración se registra una vez por segundo. */
  private sinceLastLog = 0;

  private readonly tmpPosition = new ThreeVector3();
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpScale = new ThreeVector3();
  private readonly tmpWorld = new ThreeVector3();
  private readonly tmpView = new ThreeVector3();
  private readonly tmpNdc = new ThreeVector3();
  private readonly tmpUnit = new ThreeVector3();

  /**
   * @param targetAspect alto/ancho de la imagen compilada en el `.mind`.
   *   Sin esto no se puede convertir un MarkerSpot a coordenadas del
   *   anchor: la unidad vertical depende de la proporción de la imagen.
   */
  constructor(
    private readonly runtime: MindArRuntime,
    private readonly targetAspect: number,
  ) {
    this.stageHit.visible = false;
    this.stageHit.position.z = 0.02;
    this.stage.add(this.stageHit);
  }

  async preload(models: readonly ArModel[]): Promise<void> {
    const loader = new IconLoader();
    const [runtime, loaded] = await Promise.allSettled([
      this.runtime.prepare(),
      Promise.all(models.map(async (model) => [model, await loader.load(model)] as const))
        .finally(() => loader.dispose()),
    ]);
    if (loaded.status === 'rejected') throw loaded.reason;
    const icons = loaded.value;

    icons.forEach(([model, icon], index) => {
      const pin = new MarkerPin(model, icon, index, this.targetAspect);
      this.overlay.add(pin.group);
      this.pins.set(model.id.value, pin);
    });
    if (runtime.status === 'rejected') {
      this.clear();
      throw runtime.reason;
    }
    try {
      this.mount();
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  setHighlightedModel(id: ModelId): void {
    for (const [key, pin] of this.pins) pin.highlight(key === id.value);
  }

  applyPlacement(placement: Placement): void {
    const { offset, rotationY, scale } = placement;

    // El offset mueve la capa entera; los iconos conservan su sitio
    // relativo sobre el mapa.
    this.overlay.position.set(offset.x, offset.y, offset.z);

    this.spin = rotationY;
    this.scale = scale.value;
    for (const pin of this.pins.values()) pin.applyTransform(scale.value, rotationY);
  }

  /**
   * Pone la escena de acuerdo con lo descubierto.
   *
   * Fíjate en que revelar es solo hacia adelante: `setRevealed(true)` sobre
   * un animal ya revelado no hace nada, y nunca se llama con `false`. Lo
   * que se descubrió se queda.
   */
  applyDiscovery(discovery: Discovery): void {
    for (const [key, pin] of this.pins) {
      if (discovery.isUnlocked(ModelId.of(key))) pin.setRevealed(true);
    }
    this.setFocus(discovery.focused?.value ?? null);
  }

  setStabilization(stabilization: Stabilization): void {
    this.stabilization = stabilization;
  }

  setProximity(proximity: Proximity): void {
    this.proximity = proximity;
  }

  /**
   * Presta el icono de un animal al escenario de primer plano, o lo
   * devuelve a su sitio sobre el mapa.
   *
   * Se MUEVE el objeto en vez de duplicarlo: una copia serían varios megas
   * más de texturas en la GPU, y además tendría que mantenerse igual que el
   * original. Mientras está prestado, su MarkerPin deja de tocarlo.
   */
  private setFocus(id: string | null): void {
    if (this.focusedId === id) return;

    if (this.focusedId !== null) {
      this.pins.get(this.focusedId)?.reclaimIcon();
      this.stagedIcon = null;
    }

    this.focusedId = id;
    this.stageIdle = 0;
    this.stageHit.visible = false;
    delete this.stage.userData['modelId'];

    if (id !== null) {
      const pin = this.pins.get(id);
      if (pin !== undefined) {
        const icon = pin.releaseIcon();
        // Se mide AHORA, mientras el icono no cuelga de nadie: una vez
        // dentro del escenario su caja de mundo llevaría encima la
        // transformación del escenario y saldría otro número.
        icon.scale.setScalar(1);
        icon.rotation.set(0, 0, 0);
        icon.updateMatrixWorld(true);
        new Box3().setFromObject(icon).getSize(this.stagedNaturalSize);
        this.stagedNaturalSize.set(
          this.stagedNaturalSize.x || 1,
          this.stagedNaturalSize.y || 1,
          this.stagedNaturalSize.z || 1,
        );

        this.stage.add(icon);
        this.stagedIcon = icon;
        this.stage.userData['modelId'] = id;
        this.stageHit.visible = true;
      }
    }

    this.stage.visible = this.stagedIcon !== null;
  }

  /**
   * Coloca el primer plano delante de la cámara, fotograma a fotograma.
   *
   * No se cuelga de la cámara como hijo porque MindAR no mete su cámara en
   * la escena, y three solo dibuja lo que cuelga de la escena. Copiar su
   * pose cada fotograma da el mismo resultado y no depende de ese detalle.
   */
  private updateStage(deltaSeconds: number): void {
    const icon = this.stagedIcon;
    if (icon === null) return;

    const camera = this.runtime.mindar.camera;
    const distance = STAGE_DISTANCE * this.unit;

    this.stage.quaternion.copy(camera.quaternion);
    this.stage.position.set(0, 0, -distance).applyQuaternion(camera.quaternion).add(camera.position);

    const fov = (camera.fov * Math.PI) / 180;
    const visibleHeight = 2 * distance * Math.tan(fov / 2);
    this.stagePulse = Math.max(0, this.stagePulse - deltaSeconds);
    const bump = 1 + 0.3 * Math.sin((this.stagePulse / 0.45) * Math.PI);

    this.stageIdle += deltaSeconds * STAGE_IDLE_SPIN;
    const yaw = this.spin + this.stageIdle;
    icon.rotation.set(0, yaw, 0);

    // Ajusta por la silueta que realmente ve la cámara. Usar la dimensión 3D
    // máxima hacía que la ballena fuera diminuta de frente (su largo apunta a
    // la cámara) y enorme al girarla. La proyección X/Z mantiene el volumen
    // visual estable durante todo el giro.
    const projectedWidth =
      Math.abs(Math.cos(yaw)) * this.stagedNaturalSize.x +
      Math.abs(Math.sin(yaw)) * this.stagedNaturalSize.z;
    const availableHeight = visibleHeight * STAGE_FILL;
    const availableWidth = visibleHeight * camera.aspect * 0.76;
    const fittedScale = Math.min(
      availableHeight / this.stagedNaturalSize.y,
      availableWidth / Math.max(projectedWidth, this.stagedNaturalSize.z * 0.6),
    );
    icon.scale.setScalar(fittedScale * this.scale * bump);
    // El círculo tiene radio 1: queda algo mayor que el animal para que sea
    // fácil acertarle con un dedo y el teléfono en movimiento.
    this.stageHit.scale.setScalar(Math.min(availableWidth, availableHeight) * this.scale * 0.65);
  }

  onNearbyModel(listener: (modelId: string | null) => void): void {
    this.nearbyListener = listener;
  }

  pulse(id: ModelId): void {
    if (this.focusedId === id.value) this.stagePulse = 0.45;
    this.pins.get(id.value)?.pulse();
  }

  clear(): void {
    this.setFocus(null);
    for (const pin of this.pins.values()) {
      this.overlay.remove(pin.group);
      pin.dispose();
    }
    this.pins.clear();
    this.hasPose = false;
    this.nearbyId = null;
    this.focusedId = null;
    this.stagedIcon = null;
    this.follower.visible = false;
  }

  dispose(): void {
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.clear();
    this.stageHit.geometry.dispose();
    this.stageHit.material.dispose();
    if (this.runtime.isInitialized) {
      this.runtime.mindar.renderer.dispose();
    }
  }

  /**
   * Objetos sobre los que hace raycast el adaptador de interacción,
   * indexados por id. `null` mientras el mapa no está a la vista: no tiene
   * sentido acertarle a un icono que no se está mostrando.
   */
  get pickables(): ReadonlyMap<string, Object3D> | null {
    const map = new Map<string, Object3D>();

    // El animal en primer plano es tocable siempre, esté el mapa a la vista
    // o no: es lo único que se está mirando.
    if (this.focusedId !== null && this.stagedIcon !== null) {
      map.set(this.focusedId, this.stage);
      return map;
    }

    if (!this.follower.visible) return null;

    // Solo lo revelado es tocable. Un animal que todavía es un contorno
    // punteado no debe sonar: la recompensa por acercarse dejaría de serlo
    // si se pudiera cobrar desde lejos.
    for (const [key, pin] of this.pins) {
      if (pin.isRevealed) map.set(key, pin.group);
    }
    return map;
  }

  // ---------------------------------------------------------------- privado

  private mount(): void {
    if (this.mounted) return;

    const mindar = this.runtime.init();
    this.configureRendering();
    addLights(mindar.scene);

    this.follower.add(this.overlay);
    this.follower.visible = false;
    mindar.scene.add(this.follower);

    // El escenario NO cuelga del marcador: por eso el primer plano sigue
    // ahí cuando el mapa se sale de cuadro.
    this.stage.visible = false;
    mindar.scene.add(this.stage);

    this.unsubscribeFrame = this.runtime.onFrame((delta) => this.onFrame(delta));
    this.mounted = true;
  }

  private onFrame(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.followAnchor(deltaSeconds);
    this.evaluateProximity(deltaSeconds);
    this.updateStage(deltaSeconds);
    for (const pin of this.pins.values()) {
      // Con el mapa fuera de cuadro solo se anima el animal que permanece en
      // primer plano. Los demás quedan pausados para ahorrar CPU y batería.
      if (this.follower.visible || pin.isFocused) pin.advance(deltaSeconds, this.elapsed);
    }
  }

  /**
   * ¿A qué animal se está acercando la cámara?
   *
   * Dos medidas por icono, y las dos hacen falta:
   *
   *  - DISTANCIA de la cámara al icono, que dice si te has acercado.
   *  - DESVÍO respecto al centro de la pantalla, que dice a cuál. Sobre un
   *    mapa plano los cuatro animales quedan a distancias parecidas, así
   *    que sin esto acercarse a la ballena sacaría también al cangrejo.
   *
   * Gana el más centrado, y solo sale si además está lo bastante cerca. La
   * histéresis vive en `Proximity`, en el dominio: aquí solo se mide.
   */
  private evaluateProximity(deltaSeconds: number): void {
    if (!this.follower.visible || this.pins.size === 0) {
      this.publishNearby(null);
      return;
    }

    const camera = this.runtime.mindar.camera;
    // Las poses se acaban de escribir en followAnchor, así que las matrices
    // de mundo de los pines son de hace un fotograma si no se refrescan.
    this.follower.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    // CUÁNTO MIDE UN ANCHO DE MAPA EN ESTE MUNDO.
    //
    // MindAR no trabaja en unidades de mapa: su `postMatrix` escala el
    // contenido por el ancho de la imagen compilada EN PÍXELES (1000 aquí),
    // así que una distancia cruda a un icono sale en miles. Los umbrales de
    // `Proximity` están en anchos de mapa —la única unidad que significa
    // algo para una regla del dominio—, así que hay que dividir. Sin esta
    // división la comparación era contra un número mil veces mayor y
    // ningún animal salía por más que uno se acercara.
    const unit = this.follower.getWorldScale(this.tmpUnit).x;
    if (unit <= 0) return;
    this.unit = unit;

    let bestId: string | null = null;
    let bestOffCentre = Number.POSITIVE_INFINITY;
    let bestDistance = 0;

    for (const [id, pin] of this.pins) {
      pin.group.getWorldPosition(this.tmpWorld);

      const view = this.tmpView.copy(this.tmpWorld).applyMatrix4(camera.matrixWorldInverse);
      // En Three.js la cámara mira hacia su -Z: un z positivo queda detrás.
      if (view.z > 0) continue;

      const ndc = this.tmpNdc.copy(this.tmpWorld).project(camera);
      const offCentre = Math.hypot(ndc.x, ndc.y);
      if (offCentre >= bestOffCentre) continue;

      bestOffCentre = offCentre;
      bestDistance = view.length() / unit;
      bestId = id;
    }

    this.logCalibration(deltaSeconds, bestId, bestDistance, bestOffCentre);

    if (bestId === null) {
      this.publishNearby(null);
      return;
    }

    const wasRevealed = this.nearbyId === bestId;
    const reveal = this.proximity.decide(bestDistance, bestOffCentre, wasRevealed);
    this.publishNearby(reveal ? bestId : null);
  }

  /**
   * Avisa hacia fuera, solo si cambió algo.
   *
   * Ya NO revela nada por su cuenta: quién sale y quién no lo decide el
   * caso de uso, que es donde vive la regla de que lo descubierto se queda
   * descubierto. Aquí solo se mide y se avisa.
   */
  private publishNearby(id: string | null): void {
    if (this.nearbyId === id) return;
    this.nearbyId = id;
    this.nearbyListener?.(id);
  }

  /**
   * Escribe en consola la distancia medida, una vez por segundo.
   *
   * Los umbrales de `Proximity` NO se pueden deducir en el escritorio:
   * dependen del campo de visión de la cámara real y del tamaño al que se
   * imprima el mapa. Este registro es la única forma de calibrarlos, y por
   * eso se queda.
   */
  private logCalibration(
    deltaSeconds: number,
    id: string | null,
    distance: number,
    offCentre: number,
  ): void {
    this.sinceLastLog += deltaSeconds;
    if (this.sinceLastLog < 1) return;
    this.sinceLastLog = 0;
    if (id === null) return;

    console.info(
      `[Proximity] ${id}  distancia=${distance.toFixed(2)}  desvío=${offCentre.toFixed(2)}  ` +
        `(sale por debajo de ${this.proximity.revealDistance})`,
    );
  }

  /**
   * Interpolación exponencial independiente del framerate: el resultado es
   * el mismo a 30 fps que a 60 fps, cosa que un lerp con factor fijo no
   * garantiza.
   */
  private followAnchor(deltaSeconds: number): void {
    const visible = this.runtime.anchorVisible;
    this.follower.visible = visible;

    if (!visible) {
      this.hasPose = false;
      return;
    }

    this.runtime.anchor.group.matrixWorld.decompose(
      this.tmpPosition,
      this.tmpQuaternion,
      this.tmpScale,
    );

    if (!this.hasPose) {
      this.follower.position.copy(this.tmpPosition);
      this.follower.quaternion.copy(this.tmpQuaternion);
      this.follower.scale.copy(this.tmpScale);
      this.hasPose = true;
      return;
    }

    const factor = this.stabilization.smoothingFactor;
    const step = factor >= 1 ? 1 : 1 - Math.pow(1 - factor, deltaSeconds * 60);

    this.follower.position.lerp(this.tmpPosition, step);
    this.follower.quaternion.slerp(this.tmpQuaternion, step);
    this.follower.scale.lerp(this.tmpScale, step);
  }

  private configureRendering(): void {
    const renderer = this.runtime.mindar.renderer;
    // Tone mapping fílmico: evita que los blancos del modelo se "quemen"
    // contra la imagen real de la cámara.
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }
}

/**
 * Iluminación compartida con la página de verificación, para que los
 * iconos se vean allí igual que sobre la cámara.
 */
export function addLights(scene: Object3D): void {
  // Hemisférica: simula rebote del suelo y del techo. Integra mucho mejor
  // el objeto con la escena real que una ambiental plana.
  scene.add(new HemisphereLight(0xffffff, 0x404050, 1.6));

  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(1, 2.5, 1.5);
  scene.add(key);

  const fill = new DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(-1.5, 0.5, -1);
  scene.add(fill);
}
