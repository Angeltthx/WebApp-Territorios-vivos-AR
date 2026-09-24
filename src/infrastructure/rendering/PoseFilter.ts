import { Quaternion, Vector3 } from 'three';
import type { Stabilization } from '@domain/value-objects/Stabilization';

/**
 * Corte con que se suaviza la VELOCIDAD antes de usarla para abrir el
 * filtro. Es lo que distingue un temblor de un movimiento: un temblor va y
 * vuelve varias veces por segundo y su velocidad media es casi cero, así
 * que por debajo de este corte no llega a abrir nada; un barrido con el
 * teléfono lleva la misma dirección un buen rato y sí lo abre.
 */
const VELOCITY_CUTOFF_HZ = 0.8;

/**
 * Filtro One Euro sobre la pose del mapa (posición, giro y escala).
 *
 * Sustituye a un suavizado que miraba el salto de CADA fotograma: por
 * encima de un umbral lo daba por un movimiento de verdad y dejaba de
 * suavizar. En un teléfono con seguimiento ruidoso, o en una mano que
 * tiembla, un solo fotograma malo ya pasaba ese umbral y el temblor llegaba
 * entero a los animales —que vibraban más o menos según el dispositivo—.
 * Aquí la decisión no se toma con un fotograma sino con la velocidad
 * filtrada: el temblor no la mueve, el gesto sí.
 *
 * Una sola frecuencia de corte para posición, giro y escala, calculada con
 * las dos velocidades: si cada parte se suavizara a su ritmo, al mover el
 * teléfono los animales se desplazarían antes de girar y parecerían
 * deslizarse sobre el papel.
 */
export class PoseFilter {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly scale = new Vector3(1, 1, 1);

  /** En anchos de mapa por segundo, ya filtrada. */
  private readonly linearVelocity = new Vector3();
  /** En radianes por segundo, ya filtrada. */
  private readonly angularVelocity = new Vector3();
  private primed = false;

  private readonly tmpVector = new Vector3();
  private readonly tmpQuaternion = new Quaternion();

  /** La próxima pose se toma tal cual (el mapa se acaba de encontrar). */
  reset(): void {
    this.primed = false;
  }

  update(
    position: Vector3,
    quaternion: Quaternion,
    scale: Vector3,
    deltaSeconds: number,
    stabilization: Stabilization,
  ): void {
    if (!this.primed) {
      this.position.copy(position);
      this.quaternion.copy(quaternion);
      this.scale.copy(scale);
      this.linearVelocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.primed = true;
      return;
    }
    if (deltaSeconds <= 0) return;

    const velocityAlpha = alphaFor(VELOCITY_CUTOFF_HZ, deltaSeconds);

    // La escala del anchor es el ancho del mapa: dividir por ella deja la
    // velocidad en anchos de mapa, igual cerca que lejos.
    const unit = Math.max(scale.x, 1e-6);
    const linear = this.tmpVector
      .subVectors(position, this.position)
      .divideScalar(unit * deltaSeconds);
    this.linearVelocity.lerp(linear, velocityAlpha);

    const delta = this.tmpQuaternion.copy(this.quaternion).invert().multiply(quaternion);
    // El camino corto: q y -q son el mismo giro.
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const w = Math.min(1, delta.w);
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    const angle = 2 * Math.acos(w);
    const angular = this.tmpVector.set(0, 0, 0);
    if (sinHalf > 1e-6) {
      angular.set(delta.x, delta.y, delta.z).multiplyScalar(angle / (sinHalf * deltaSeconds));
    }
    this.angularVelocity.lerp(angular, velocityAlpha);

    const cutoff =
      stabilization.restCutoffHz +
      stabilization.linearResponse * this.linearVelocity.length() +
      stabilization.angularResponse * this.angularVelocity.length();
    const alpha = alphaFor(cutoff, deltaSeconds);

    this.position.lerp(position, alpha);
    this.quaternion.slerp(quaternion, alpha);
    this.scale.lerp(scale, alpha);
  }
}

/**
 * Cuánto del camino recorre en este fotograma un paso bajo de primer orden
 * con ese corte. Depende del tiempo transcurrido, así que el resultado es
 * el mismo a 30 fps que a 60.
 */
function alphaFor(cutoffHz: number, deltaSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / deltaSeconds);
}
