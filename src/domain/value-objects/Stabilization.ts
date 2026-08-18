export type StabilizationLevel = 'responsive' | 'balanced' | 'stable';

/**
 * Compromiso entre latencia y temblor (jitter).
 *
 * MindAR ya aplica su propio filtro, pero es insuficiente en marcadores
 * pequeños o con poca luz — es una queja documentada del proyecto. Añadimos
 * una segunda capa de suavizado exponencial sobre la pose del anchor.
 *
 * smoothingFactor: fracción del camino hacia la pose real que recorremos
 * por frame. 1 = sin suavizado (respuesta inmediata, tiembla);
 * valores bajos = más estable pero con retardo perceptible al mover rápido.
 */
export class Stabilization {
  private constructor(
    readonly level: StabilizationLevel,
    readonly smoothingFactor: number,
  ) {
    Object.freeze(this);
  }

  static readonly RESPONSIVE = new Stabilization('responsive', 1);
  static readonly BALANCED = new Stabilization('balanced', 0.35);
  static readonly STABLE = new Stabilization('stable', 0.15);

  static default(): Stabilization {
    return Stabilization.BALANCED;
  }

  /** Cicla entre los tres niveles, para un botón único en la UI. */
  next(): Stabilization {
    if (this.level === 'responsive') return Stabilization.BALANCED;
    if (this.level === 'balanced') return Stabilization.STABLE;
    return Stabilization.RESPONSIVE;
  }
}
