export type StabilizationLevel = 'responsive' | 'balanced' | 'stable';

/**
 * Compromiso entre latencia y temblor (jitter).
 *
 * MindAR ya aplica su propio filtro, pero es insuficiente en marcadores
 * pequeños, con poca luz o con un pulso que tiembla — es una queja
 * documentada del proyecto. Encima va una segunda capa: un filtro One Euro
 * sobre la pose del anchor, el estándar en AR para esto.
 *
 * Su regla: la frecuencia de corte crece con la velocidad SOSTENIDA del
 * mapa. Quieto o temblando, el corte se queda en `restCutoffHz` y los
 * animales no se mueven; al barrer con el teléfono, sube y los sigue sin
 * retraso.
 *
 * - restCutoffHz: corte en reposo. Más bajo = más quieto.
 * - linearResponse: Hz extra por cada ancho de mapa por segundo de
 *   desplazamiento. Más alto = menos retraso al moverse.
 * - angularResponse: Hz extra por cada radián por segundo de giro.
 */
export class Stabilization {
  private constructor(
    readonly level: StabilizationLevel,
    readonly restCutoffHz: number,
    readonly linearResponse: number,
    readonly angularResponse: number,
  ) {
    Object.freeze(this);
  }

  static readonly RESPONSIVE = new Stabilization('responsive', 3, 8, 4);
  static readonly BALANCED = new Stabilization('balanced', 0.45, 6, 3);
  static readonly STABLE = new Stabilization('stable', 0.25, 4, 2);

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
