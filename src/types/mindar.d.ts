/**
 * ADVERTENCIA DE HONESTIDAD:
 * mind-ar@1.2.5 no publica tipos de TypeScript para sus bundles `.prod.js`.
 * Estas declaraciones las escribí a mano tras inspeccionar el bundle real:
 * verifiqué que los identificadores addAnchor, onTargetFound, onTargetLost,
 * imageTargetSrc, maxTrack, filterMinCF, filterBeta, warmupTolerance,
 * missTolerance, uiLoading, uiScanning y uiError existen dentro de
 * dist/mindar-image-three.prod.js.
 *
 * No son tipos oficiales. Si algo no compila o se comporta distinto,
 * la fuente de verdad es el bundle, no este archivo.
 */
declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type { Group, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

  export interface MindARAnchor {
    group: Group;
    targetIndex: number;
    visible?: boolean;
    onTargetFound?: () => void;
    onTargetLost?: () => void;
  }

  export interface MindARThreeOptions {
    container: HTMLElement;
    imageTargetSrc: string;
    /** Máximo de marcadores rastreados a la vez. Por defecto 1. */
    maxTrack?: number;
    /** Frecuencia de corte del filtro. Bajar reduce el temblor. Def. 0.001 */
    filterMinCF?: number;
    /** Coeficiente de velocidad. Subir reduce el retardo. Def. 1000 */
    filterBeta?: number;
    /** Frames consecutivos detectando para dar por encontrado. Def. 5 */
    warmupTolerance?: number;
    /** Frames consecutivos sin detectar para dar por perdido. Def. 5 */
    missTolerance?: number;
    uiLoading?: string;
    uiScanning?: string;
    uiError?: string;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);
    readonly renderer: WebGLRenderer;
    readonly scene: Scene;
    readonly camera: PerspectiveCamera;
    addAnchor(targetIndex: number): MindARAnchor;
    start(): Promise<void>;
    stop(): void;
  }
}
