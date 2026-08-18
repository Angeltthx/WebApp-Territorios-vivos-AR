import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Vector3 as ThreeVector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ArModel } from '@domain/entities/ArModel';
import type { Placement } from '@domain/entities/Placement';
import type { ModelId } from '@domain/value-objects/ModelId';
import { Stabilization } from '@domain/value-objects/Stabilization';
import type { ScenePort } from '@application/ports/ScenePort';
import type { MindArRuntime } from '../mindar/MindArRuntime';
import { createPrimitive } from './PrimitiveFactory';

const PULSE_DURATION_S = 0.45;
const PULSE_AMPLITUDE = 0.18;

/**
 * Adaptador de render.
 *
 * Jerarquía deliberada:
 *   scene → follower (pose del marcador, SUAVIZADA) → content (placement) → modelo
 *
 * El modelo NO cuelga directamente del anchor de MindAR. Colgarlo hace que
 * herede el temblor cuadro a cuadro del motor de visión. En su lugar
 * copiamos la pose del anchor cada frame con interpolación exponencial.
 * Es la mejora más perceptible en estabilidad, y el nivel se ajusta en
 * caliente desde la UI.
 */
export class ThreeSceneAdapter implements ScenePort {
  private readonly loader = new GLTFLoader();
  private readonly follower = new Group();
  private readonly content = new Group();
  private readonly spinner = new Group();
  private readonly library = new Map<string, Object3D>();

  private stabilization: Stabilization = Stabilization.default();
  private placementScale = 1;
  private pulseRemaining = 0;
  private hasPose = false;
  private mounted = false;
  private unsubscribeFrame: (() => void) | null = null;

  private readonly tmpPosition = new ThreeVector3();
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpScale = new ThreeVector3();

  constructor(private readonly runtime: MindArRuntime) {}

  async preload(models: readonly ArModel[]): Promise<void> {
    this.mount();

    const built = await Promise.all(models.map(async (model) => [model, await this.build(model)] as const));

    for (const [model, object] of built) {
      object.visible = false;
      this.spinner.add(object);
      this.library.set(model.id.value, object);
    }
  }

  setActiveModel(id: ModelId): void {
    for (const [key, object] of this.library) {
      object.visible = key === id.value;
    }
  }

  applyPlacement(placement: Placement): void {
    const { offset, rotationY, scale } = placement;
    this.content.position.set(offset.x, offset.y, offset.z);
    // La rotación del usuario va en `spinner`, no en `content`: así no
    // pisa la inclinación base que endereza el modelo sobre el marcador.
    this.spinner.rotation.y = rotationY;
    this.placementScale = scale.value;
    this.syncScale();
  }

  setStabilization(stabilization: Stabilization): void {
    this.stabilization = stabilization;
  }

  pulse(): void {
    this.pulseRemaining = PULSE_DURATION_S;
  }

  clear(): void {
    this.library.clear();
    this.spinner.clear();
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

  /** Objeto sobre el que hace raycast el adaptador de interacción. */
  get interactiveObject(): Object3D | null {
    return this.follower.visible ? this.content : null;
  }

  // ---------------------------------------------------------------- privado

  private mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    const mindar = this.runtime.init();
    this.configureRendering();
    this.addLights();

    // El plano del anchor de MindAR coincide con la imagen del marcador:
    // X e Y sobre la imagen, Z saliendo de ella. Si el marcador está
    // apoyado en una mesa, su Z apunta hacia arriba, así que hay que
    // inclinar el contenido 90 grados para que el modelo quede de pie.
    //
    // SI AL PROBAR EL OBJETO APARECE ACOSTADO O ENTERRADO: cambia el
    // signo de esta rotación. Es el único ajuste que no pude verificar
    // sin un dispositivo real.
    this.content.rotation.x = Math.PI / 2;
    this.content.add(this.spinner);

    this.follower.add(this.content);
    this.follower.add(this.buildContactRing());
    this.follower.visible = false;
    mindar.scene.add(this.follower);

    this.unsubscribeFrame = this.runtime.onFrame((delta) => this.onFrame(delta));
  }

  private onFrame(deltaSeconds: number): void {
    this.followAnchor(deltaSeconds);
    this.advancePulse(deltaSeconds);
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

  private advancePulse(deltaSeconds: number): void {
    if (this.pulseRemaining <= 0) return;
    this.pulseRemaining = Math.max(0, this.pulseRemaining - deltaSeconds);
    this.syncScale();
  }

  private syncScale(): void {
    const progress = this.pulseRemaining / PULSE_DURATION_S;
    const bump = 1 + PULSE_AMPLITUDE * Math.sin(progress * Math.PI);
    this.content.scale.setScalar(this.placementScale * bump);
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
      return createPrimitive('crystal', 0x888888);
    }
  }

  private configureRendering(): void {
    const renderer = this.runtime.mindar.renderer;
    // Tone mapping fílmico: evita que los blancos del modelo se "quemen"
    // contra la imagen real de la cámara.
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  }

  private addLights(): void {
    const scene = this.runtime.mindar.scene;

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

  /** Halo en el plano del marcador: ancla visualmente el objeto al mundo. */
  private buildContactRing(): Object3D {
    const ring = new Mesh(
      new RingGeometry(0.5, 0.56, 64),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.position.z = -0.001;
    return ring;
  }
}
