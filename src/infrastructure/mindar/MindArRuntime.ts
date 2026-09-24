import type { MindARThree, MindARAnchor } from 'mind-ar/dist/mindar-image-three.prod.js';

import { FrameLockedBackground } from './FrameLockedBackground';

/**
 * Trabajo por fotograma. Devuelve `true` si ha dejado algo que pintar: si
 * nadie lo hace, el fotograma no se renderiza (ver `startLoop`).
 */
export type FrameCallback = (deltaSeconds: number) => boolean | void;

/**
 * Cuánto se le pide a la GPU. 'full' es lo de siempre; 'lite' pinta a menos
 * resolución y a 30 fps, que en un gama media es la diferencia entre que el
 * seguimiento vaya fluido o a trompicones: three y TensorFlow comparten GPU,
 * y cada milisegundo que gasta el render se lo quita al detector.
 */
export type RenderProfile = 'full' | 'lite';

const PROFILE = {
  full: { maxPixelRatio: 1.5, pixelBudget: 1_500_000, frameMs: 1000 / 60 },
  lite: { maxPixelRatio: 1, pixelBudget: 700_000, frameMs: 1000 / 30 },
} as const;

/** Por encima de esto (media móvil del intervalo real entre fotogramas) el teléfono no llega. */
const STRUGGLING_FRAME_MS = 1000 / 38;
/** Segundos seguidos sin llegar antes de bajar a 'lite'. Nunca se vuelve a subir: oscilar se ve peor. */
const STRUGGLING_SECONDS = 2.5;

/**
 * El punto de partida por dispositivo. `deviceMemory` solo existe en
 * Chrome/Android —justo donde está la gama media— y redondea a la baja:
 * un teléfono de 4 GB informa 4. iPhone no lo expone y arranca en 'full';
 * si no llegara, el gobernador de `startLoop` lo baja solo.
 */
export function initialRenderProfile(): RenderProfile {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 4 ? 'lite' : 'full';
}

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
  private readonly frameLock = new FrameLockedBackground();
  private profile: RenderProfile = initialRenderProfile();
  private averageFrameMs = 1000 / 60;
  private strugglingSeconds = 0;
  private drewLastFrame = true;
  private lastFrameMs = 0;
  private looping = false;
  private anchorVisibleFlag = false;
  /** El `.mind` ya descargado, como blob: URL. Ver `prefetchTarget`. */
  private localTargetSrc: string | null = null;
  private preparation: Promise<void> | null = null;
  private constructorRef: typeof MindARThree | null = null;

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
   * Silencioso durante la portada. Si falla, prepare permite reintentarlo;
   * nunca entregamos una URL fallida al arranque interno de MindAR, cuya
   * promesa puede quedarse pendiente si falla addImageTargets.
   */
  prefetchTarget(): void {
    void this.prepare().catch(() => {});
  }

  /** Motor y target en paralelo; nunca se crea MindAR antes de tener ambos. */
  prepare(): Promise<void> {
    if (this.preparation !== null) return this.preparation;
    this.preparation = Promise.all([
      import('mind-ar/dist/mindar-image-three.prod.js').then(({ MindARThree }) => {
        this.constructorRef = MindARThree;
      }),
      this.downloadTarget(),
    ]).then(() => {}).catch((error: unknown) => {
      this.preparation = null;
      throw error;
    });
    return this.preparation;
  }

  private async downloadTarget(): Promise<void> {
    if (this.localTargetSrc !== null) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(this.imageTargetSrc, { signal: controller.signal });
      if (!response.ok) throw new Error(`No se pudo cargar el mapa (${response.status}). Reintenta.`);
      this.localTargetSrc = URL.createObjectURL(await response.blob());
    } finally {
      window.clearTimeout(timeout);
    }
  }

  init(): MindARThree {
    if (this.instance !== null) return this.instance;

    if (this.constructorRef === null || this.localTargetSrc === null) {
      throw new Error('El motor y el mapa deben prepararse antes de iniciar');
    }
    this.instance = new this.constructorRef({
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
      // Pantallas de 90/120/144 Hz no necesitan duplicar el trabajo de AR,
      // y en 'lite' se pinta a 30.
      if (now - this.lastFrameMs < PROFILE[this.profile].frameMs - 1) return;
      const elapsedMs = now - this.lastFrameMs;
      const delta = Math.min(elapsedMs / 1000, 0.1);
      this.lastFrameMs = now;

      // Las poses de MindAR se escriben en las matrices locales de forma
      // asíncrona respecto al render, así que hay que refrescar el árbol
      // antes de leerlas para el suavizado.
      scene.updateMatrixWorld(true);
      let drew = false;
      this.frameCallbacks.forEach((callback) => {
        if (callback(delta) === true) drew = true;
      });

      // Sin nada en escena (buscando el mapa) no se pinta: la GPU queda
      // entera para el detector, que es lo que hay que acelerar entonces.
      // Un último render deja el lienzo limpio al desaparecer todo.
      if (drew || this.drewLastFrame) renderer.render(scene, camera);
      this.drewLastFrame = drew;
      if (drew) this.govern(elapsedMs, delta);
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

  /**
   * Visible Y con una pose que corresponde a lo que se ve. Con el fondo
   * sincronizado, un seguimiento perdido por un tirón oculta los animales
   * en vez de dejarlos flotando donde estaba el mapa (ver FrameLockedBackground).
   */
  get anchorVisible(): boolean {
    return this.anchorVisibleFlag && !this.frameLock.isStale;
  }

  /**
   * Engancha la vigilancia de poses viejas. Tras `mindar.start()`. El fondo
   * sigue siendo el vídeo en vivo: sincronizarlo con la pose hacía vibrar
   * la imagen (ver FrameLockedBackground).
   */
  lockBackgroundToPose(): void {
    const mindar = this.mindar;
    const installed = this.frameLock.install(
      (mindar as unknown as { controller?: unknown }).controller,
      mindar.video,
      this.container,
      { lockBackground: false },
    );
    if (!installed) console.info('[MindArRuntime] Sin vigilancia de poses: MindAR no expone su controlador');
  }

  unlockBackground(): void {
    this.frameLock.uninstall();
  }

  get renderProfile(): RenderProfile {
    return this.profile;
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
  /**
   * Baja a 'lite' si el teléfono no sostiene el ritmo. Solo cuenta los
   * fotogramas que sí se pintan: buscando el mapa no se renderiza nada y
   * ese intervalo no dice nada de la GPU.
   */
  private govern(elapsedMs: number, delta: number): void {
    if (this.profile === 'lite') return;
    this.averageFrameMs += (Math.min(elapsedMs, 200) - this.averageFrameMs) * 0.1;
    this.strugglingSeconds = this.averageFrameMs > STRUGGLING_FRAME_MS
      ? this.strugglingSeconds + delta
      : 0;
    if (this.strugglingSeconds < STRUGGLING_SECONDS) return;
    this.profile = 'lite';
    this.applyPixelRatio();
    console.info(`[MindArRuntime] Perfil lite: ${this.averageFrameMs.toFixed(0)} ms por fotograma`);
  }

  private applyPixelRatio(): void {
    // Limita el trabajo de fragmentos también en tablets y pantallas retina.
    // No cambia la resolución del detector ni la proyección de la cámara.
    const { maxPixelRatio, pixelBudget } = PROFILE[this.profile];
    const area = Math.max(1, this.container.clientWidth * this.container.clientHeight);
    this.mindar.renderer.setPixelRatio(Math.max(0.75, Math.min(
      window.devicePixelRatio || 1,
      maxPixelRatio,
      Math.sqrt(pixelBudget / area),
    )));
  }

  private configureRenderer(): void {
    this.applyPixelRatio();
    window.addEventListener('resize', () => this.applyPixelRatio());

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
