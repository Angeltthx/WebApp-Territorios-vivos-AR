export type TrackingEvent = 'anchor-found' | 'anchor-lost';
export type Unsubscribe = () => void;

export class CameraPermissionDeniedError extends Error {
  constructor() {
    super('Permiso de cámara denegado');
    this.name = 'CameraPermissionDeniedError';
  }
}

/**
 * PUERTO CLAVE del proyecto.
 *
 * Todo lo que cambia entre MindAR, WebXR, Zappar y 8th Wall vive detrás
 * de esta interfaz. El día que Apple habilite WebXR en Safari, o que
 * decidas pagar Zappar, escribes un adaptador nuevo y cambias una línea
 * en container.ts. Dominio, casos de uso y UI no se tocan.
 */
export interface TrackingPort {
  /** ¿Este navegador/dispositivo puede correr este motor de tracking? */
  isSupported(): Promise<boolean>;

  /**
   * Pide permiso de cámara y arranca el motor de visión.
   * @throws CameraPermissionDeniedError si el usuario rechaza la cámara.
   */
  start(): Promise<void>;

  stop(): Promise<void>;

  on(event: TrackingEvent, handler: () => void): Unsubscribe;

  /**
   * Congela el anchor en su posición actual.
   *
   * En image tracking (MindAR) es un no-op: el anchor ya está atado a la
   * imagen objetivo. En instant world tracking (Zappar/WebXR) sería la
   * acción real del botón "Place". Está declarado aquí para que la UI no
   * cambie el día que migres de motor.
   */
  confirmAnchor(): void;
}
