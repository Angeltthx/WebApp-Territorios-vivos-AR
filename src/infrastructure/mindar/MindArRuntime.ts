import { MindARThree, type MindARAnchor } from 'mind-ar/dist/mindar-image-three.prod.js';

export type FrameCallback = (deltaSeconds: number) => void;

export interface MindArTuning {
  readonly maxTrack: number;
  readonly filterMinCF: number;
  readonly filterBeta: number;
  readonly warmupTolerance: number;
  readonly missTolerance: number;
}

/**
 * Parámetros de tracking. Semántica verificada en la documentación oficial
 * de MindAR (quick-start/tracking-config):
 *
 *  - filterMinCF: frecuencia de corte. BAJAR reduce el temblor. Def. 0.001
 *  - filterBeta:  coeficiente de velocidad. SUBIR reduce el retardo. Def. 1000
 *  - warmupTolerance: frames consecutivos detectando antes de dar por
 *    encontrado el marcador. Def. 5. Bajarlo acelera la aparición pero
 *    aumenta los falsos positivos.
 *  - missTolerance: frames consecutivos sin detectar antes de darlo por
 *    perdido. Def. 5. SUBIRLO evita parpadeos cuando el marcador se sale
 *    un instante del encuadre — la mejora más notoria en uso real.
 *
 * Estos valores están afinados para "el usuario camina alrededor del
 * marcador": priorizan continuidad sobre reacción inmediata.
 */
export const DEFAULT_TUNING: MindArTuning = {
  maxTrack: 1,
  filterMinCF: 0.0005,
  filterBeta: 2000,
  warmupTolerance: 3,
  missTolerance: 12,
};

/**
 * MindAR es dueño del renderer, la escena, la cámara Y los anchors a la vez.
 * En vez de duplicar esa instancia entre adaptadores, la encapsulo aquí y
 * la inyecto en todos.
 *
 * Este acoplamiento es interno a infrastructure/ y no cruza hacia adentro,
 * así que no rompe la regla de dependencias.
 */
export class MindArRuntime {
  private instance: MindARThree | null = null;
  private anchorRef: MindARAnchor | null = null;
  private readonly frameCallbacks = new Set<FrameCallback>();
  private lastFrameMs = 0;
  private looping = false;
  private anchorVisibleFlag = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly imageTargetSrc: string,
    private readonly tuning: MindArTuning = DEFAULT_TUNING,
  ) {}

  init(): MindARThree {
    if (this.instance !== null) return this.instance;

    this.instance = new MindARThree({
      container: this.container,
      imageTargetSrc: this.imageTargetSrc,
      maxTrack: this.tuning.maxTrack,
      filterMinCF: this.tuning.filterMinCF,
      filterBeta: this.tuning.filterBeta,
      warmupTolerance: this.tuning.warmupTolerance,
      missTolerance: this.tuning.missTolerance,
      // Desactivo la UI por defecto de MindAR: nuestra capa ui/ es la
      // única responsable de mostrar estados. Una sola fuente de verdad.
      uiLoading: 'no',
      uiScanning: 'no',
      uiError: 'no',
    });

    this.anchorRef = this.instance.addAnchor(0);
    this.configureRenderer();
    return this.instance;
  }

  /** Registra trabajo por frame (suavizado, animaciones). */
  onFrame(callback: FrameCallback): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  startLoop(): void {
    if (this.looping) return;
    const { renderer, scene, camera } = this.mindar;
    this.looping = true;
    this.lastFrameMs = performance.now();

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const delta = Math.min((now - this.lastFrameMs) / 1000, 0.1);
      this.lastFrameMs = now;

      // Las poses de MindAR se escriben en las matrices locales de forma
      // asíncrona respecto al render, así que hay que refrescar el árbol
      // antes de leerlas para el suavizado.
      scene.updateMatrixWorld(true);
      this.frameCallbacks.forEach((callback) => callback(delta));

      renderer.render(scene, camera);
    });
  }

  stopLoop(): void {
    if (!this.looping || this.instance === null) return;
    this.instance.renderer.setAnimationLoop(null);
    this.looping = false;
  }

  /**
   * Visibilidad del anchor mantenida por eventos found/lost del adaptador
   * de tracking, en vez de leer propiedades internas de MindAR que no
   * están documentadas. Determinista y verificable.
   */
  setAnchorVisible(visible: boolean): void {
    this.anchorVisibleFlag = visible;
  }

  get anchorVisible(): boolean {
    return this.anchorVisibleFlag;
  }

  get mindar(): MindARThree {
    if (this.instance === null) throw new Error('MindArRuntime.init() no fue llamado');
    return this.instance;
  }

  get anchor(): MindARAnchor {
    if (this.anchorRef === null) throw new Error('MindArRuntime.init() no fue llamado');
    return this.anchorRef;
  }

  get isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Ajustes de render que mejoran mucho cómo se integra el objeto con la
   * imagen real de la cámara: gestión de color correcta, tone mapping
   * fílmico y densidad de píxeles limitada para no fundir la batería.
   */
  private configureRenderer(): void {
    const renderer = this.mindar.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}
