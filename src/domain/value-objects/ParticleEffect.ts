/**
 * Un efecto de partículas que acompaña al animal cuando se mueve: unas hojas
 * que le caen a la pava al mover la cabeza, unos granos de arena que saltan
 * de las patas del cangrejo cuando corretea deprisa.
 *
 * Es vocabulario, como `TapMove`: el catálogo dice QUÉ y DESDE DÓNDE (qué
 * huesos del esqueleto), y la capa de render sabe dibujarlo. Las
 * animaciones no se tocan: el efecto mira cuánto se mueve cada hueso y
 * suelta partículas cuando se mueve deprisa, así que nace del gesto mismo,
 * sea el de un toque o el de su bucle.
 *
 *   'leaves'  unas hojas que caen desde arriba, meciéndose
 *   'sand'    granitos de arena que saltan de la pata y caen al suelo
 *
 * La ballena, la tortuga y la rana no llevan: se probaron burbujas, rocío y
 * luciérnagas, y estaban mejor sin nada.
 */
export type ParticleKind = 'leaves' | 'sand';
const KINDS: readonly ParticleKind[] = ['leaves', 'sand'];

export interface ParticleEffectSnapshot {
  readonly kind: ParticleKind;
  /**
   * De qué huesos salen: cómo TERMINA su nombre tal como lo deja three
   * (`'Foot_F_jnt'` casa con `RIG_CangrejoLeftFoot_F_jnt` y el derecho).
   * Por el final y no por un trozo cualquiera, para no casar con huesos de
   * control (`IK_…`, `…_main`). Sin huesos que casen, no sale nada.
   */
  readonly from: readonly string[];
  /**
   * A partir de qué velocidad del hueso empieza a soltar, en tamaños del
   * animal por segundo. Cada animal se mueve a su manera: se calibra
   * mirando el gesto (ver CLAUDE.md).
   */
  readonly threshold?: number;
  /** Cuántas partículas por cada tamaño por segundo por encima del umbral. */
  readonly rate?: number;
  /**
   * Tamaño de las partículas respecto al de su tipo, que se mide en tamaños
   * del animal, y un animal grande las haría enormes.
   */
  readonly scale?: number;
  /**
   * Cuándo suelta: siempre que el hueso vaya deprisa ('always', por
   * defecto) o solo durante el gesto del toque ('gesture'). El cangrejo
   * mueve las patas casi igual caminando tranquilo que correteando, y la
   * arena se pidió solo para el correteo.
   */
  readonly during?: 'always' | 'gesture';
}

export class ParticleEffect {
  private constructor(
    readonly kind: ParticleKind,
    readonly from: readonly string[],
    readonly threshold: number,
    readonly rate: number,
    readonly scale: number,
    readonly during: 'always' | 'gesture',
  ) {
    Object.freeze(this.from);
    Object.freeze(this);
  }

  static of(snapshot: ParticleEffectSnapshot): ParticleEffect {
    if (!KINDS.includes(snapshot.kind)) {
      throw new RangeError(`Efecto de partículas desconocido: ${String(snapshot.kind)}`);
    }
    const from = snapshot.from.map((name) => name.trim()).filter((name) => name.length > 0);
    if (from.length === 0) throw new RangeError(`El efecto "${snapshot.kind}" necesita al menos un hueso`);
    const threshold = snapshot.threshold ?? 1;
    const rate = snapshot.rate ?? 10;
    if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError(`Umbral inválido: ${threshold}`);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 2000) throw new RangeError(`Ritmo inválido: ${rate}`);
    const scale = snapshot.scale ?? 1;
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 5) throw new RangeError(`Escala inválida: ${scale}`);
    const during = snapshot.during ?? 'always';
    if (during !== 'always' && during !== 'gesture') throw new RangeError(`Momento inválido: ${String(during)}`);
    return new ParticleEffect(snapshot.kind, from, threshold, rate, scale, during);
  }
}
