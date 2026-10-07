/**
 * Un efecto de partículas que acompaña al animal cuando se mueve: unas hojas
 * que le caen a la pava al mover la cabeza, el polvito de arena de cada paso
 * del cangrejo, las luciérnagas que se espantan cuando salta la rana.
 *
 * Es vocabulario, como `TapMove`: el catálogo dice QUÉ y DESDE DÓNDE (qué
 * huesos del esqueleto), y la capa de render sabe dibujarlo. Las
 * animaciones no se tocan: el efecto mira cuánto se mueve cada hueso y
 * suelta partículas cuando se mueve deprisa, así que nace del gesto mismo,
 * sea el de un toque o el de su bucle.
 *
 *   'leaves'     unas pocas hojas que caen desde arriba, meciéndose
 *   'sand'       nubecillas de polvo de arena que se abren a ras de suelo
 *   'fireflies'  luciérnagas que suben, vagan y parpadean
 *
 * La ballena y la tortuga no llevan: tuvieron burbujas y sobraban.
 */
export type ParticleKind = 'leaves' | 'sand' | 'fireflies';
const KINDS: readonly ParticleKind[] = ['leaves', 'sand', 'fireflies'];

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
}

export class ParticleEffect {
  private constructor(
    readonly kind: ParticleKind,
    readonly from: readonly string[],
    readonly threshold: number,
    readonly rate: number,
    readonly scale: number,
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
    if (!Number.isFinite(rate) || rate <= 0 || rate > 500) throw new RangeError(`Ritmo inválido: ${rate}`);
    const scale = snapshot.scale ?? 1;
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 5) throw new RangeError(`Escala inválida: ${scale}`);
    return new ParticleEffect(snapshot.kind, from, threshold, rate, scale);
  }
}
