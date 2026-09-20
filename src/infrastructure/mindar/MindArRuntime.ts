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
 *    aumenta los falsos positivos. En 1 porque lo que tarda es ENCONTRAR
 *    el mapa, no confirmarlo: cada frame de warmup se suma a una espera
 *    que ya se nota, y una vez hay emparejamiento con inliers el
 *    seguimiento del frame siguiente casi nunca lo desmiente.
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
  warmupTolerance: 1,
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
  /** El `.mind` ya descargado, como blob: URL. Ver `prefetchTarget`. */
  private localTargetSrc: string | null = null;
  private prefetching = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly imageTargetSrc: string,
    private readonly tuning: MindArTuning = DEFAULT_TUNING,
  ) {}

  /**
   * Baja el `.mind` mientras se ve la bienvenida.
   *
   * MindAR pide el target DESPUÉS de conceder la cámara, dentro de
   * `start()`: `_startVideo` primero, y solo entonces `_startAR` hace el
   * `fetch`. Son casi 900 KB, así que en datos móviles esa descarga se
   * interpone entera entre el "Permitir" y el primer intento de detección.
   *
   * Lo que se descarga aquí se queda en memoria como `blob:` URL y se le
   * pasa a MindAR en su lugar. Se elige blob y no confiar en la caché del
   * navegador porque Netlify sirve estos archivos con `must-revalidate`:
   * la caché ahorra el cuerpo, pero no el viaje de ida y vuelta.
   *
   * Silencioso a propósito: si falla, `imageTargetSrc` sigue siendo la URL
   * de siempre y MindAR la descargará él mismo como hasta ahora.
   */
  prefetchTarget(): void {
    if (this.prefetching || this.localTargetSrc !== null) return;
    this.prefetching = true;

    void fetch(this.imageTargetSrc)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        // Si la sesión ya arrancó, MindAR se quedó con la URL original y
        // cambiarla ahora no sirve de nada.
        if (blob === null || this.instance !== null) return;
        this.localTargetSrc = URL.createObjectURL(blob);
      })
      .catch(() => {
        // Sin red o con un 404, `init()` usará la URL normal.
      });
  }

  init(): MindARThree {
    if (this.instance !== null) return this.instance;

    this.instance = new MindARThree({
      container: this.container,
      imageTargetSrc: this.localTargetSrc ?? this.imageTargetSrc,
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

    // MindAR mete SIEMPRE un CSS3DRenderer en el contenedor, se use o no
    // (three.js:42-43), y lo añade DESPUÉS del canvas WebGL. Su div queda
    // por encima, a pantalla completa y transparente... pero con
    // pointer-events por defecto: `viewElement` sí lleva 'none' dentro de
    // three, el div exterior NO. Un div transparente se traga los eventos
    // igual que uno opaco, así que ningún toque llegaba nunca al canvas y
    // el raycast no se ejecutaba jamás: tocar un animal no hacía nada.
    //
    // No usamos anclas CSS3D en ningún sitio, así que la capa se marca
    // como no tocable y los punteros vuelven a caer en el canvas.
    this.mindar.cssRenderer.domElement.style.pointerEvents = 'none';
  }
}
