import {
  ACESFilmicToneMapping,
  CircleGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3 as ThreeVector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { ModelId } from '@domain/value-objects/ModelId';
import { Stabilization } from '@domain/value-objects/Stabilization';
import type { ScenePort } from '@application/ports/ScenePort';
import type { MindArRuntime } from '../mindar/MindArRuntime';
import { MarkerPin } from './MarkerPin';
import { createPrimitive } from './PrimitiveFactory';

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
export class ThreeSceneAdapter implements ScenePort {
  private readonly loader = new GLTFLoader();
  private readonly follower = new Group();
  private readonly overlay = new Group();
  private readonly pins = new Map<string, MarkerPin>();

  private stabilization: Stabilization = Stabilization.default();
  private elapsed = 0;
  private hasPose = false;
  private mounted = false;
  private unsubscribeFrame: (() => void) | null = null;

  private readonly tmpPosition = new ThreeVector3();
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpScale = new ThreeVector3();

  /**
   * @param targetAspect alto/ancho de la imagen compilada en el `.mind`.
   *   Sin esto no se puede convertir un MarkerSpot a coordenadas del
   *   anchor: la unidad vertical depende de la proporción de la imagen.
   */
  constructor(
    private readonly runtime: MindArRuntime,
    private readonly targetAspect: number,
  ) {}

  async preload(models: readonly ArModel[]): Promise<void> {
    this.mount();

    const icons = await Promise.all(
      models.map(async (model) => [model, await this.build(model)] as const),
    );

    icons.forEach(([model, icon], index) => {
      const pin = new MarkerPin(model.id.value, model.spot, icon, index, this.targetAspect);
      this.overlay.add(pin.group);
      this.pins.set(model.id.value, pin);
    });
  }

  setHighlightedModel(id: ModelId): void {
    for (const [key, pin] of this.pins) pin.highlight(key === id.value);
  }

  applyPlacement(placement: Placement): void {
    const { offset, rotationY, scale } = placement;

    // El offset mueve la capa entera; los iconos conservan su sitio
    // relativo sobre el mapa.
    this.overlay.position.set(offset.x, offset.y, offset.z);

    for (const pin of this.pins.values()) pin.applyTransform(scale.value, rotationY);
  }

  setStabilization(stabilization: Stabilization): void {
    this.stabilization = stabilization;
  }

  pulse(id: ModelId): void {
    this.pins.get(id.value)?.pulse();
  }

  clear(): void {
    for (const pin of this.pins.values()) {
      this.overlay.remove(pin.group);
      pin.dispose();
    }
    this.pins.clear();
    this.hasPose = false;
  }

  dispose(): void {
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.clear();
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
    if (!this.follower.visible) return null;
    const map = new Map<string, Object3D>();
    for (const [key, pin] of this.pins) map.set(key, pin.group);
    return map;
  }

  // ---------------------------------------------------------------- privado

  private mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    const mindar = this.runtime.init();
    this.configureRendering();
    addLights(mindar.scene);

    this.follower.add(this.overlay);
    this.follower.visible = false;
    mindar.scene.add(this.follower);

    this.unsubscribeFrame = this.runtime.onFrame((delta) => this.onFrame(delta));
  }

  private onFrame(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.followAnchor(deltaSeconds);
    for (const pin of this.pins.values()) pin.advance(deltaSeconds, this.elapsed);
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

  private async build(model: ArModel): Promise<Object3D> {
    if (model.source.kind === 'primitive') {
      return createPrimitive(model.source.shape, model.source.colorHex);
    }

    try {
      const gltf = await this.loader.loadAsync(model.source.url);
      return gltf.scene;
    } catch (error) {
      // Fallback deliberado: si un .glb falta o falla, el resto del catálogo
      // sigue funcionando en vez de tumbar toda la sesión.
      console.warn(`[ThreeSceneAdapter] No se pudo cargar ${model.source.url}`, error);
      return buildMissingMarker();
    }
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

/** Marcador gris y neutro para un modelo que no se pudo cargar. */
function buildMissingMarker(): Object3D {
  return new Mesh(
    new CircleGeometry(0.06, 20),
    new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9, side: DoubleSide }),
  );
}
