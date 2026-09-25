import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopRepeat,
  Object3D,
} from 'three';
import type { AnimationSequence } from '@domain/value-objects/AnimationSequence';

interface SequencedAction {
  readonly name: string;
  readonly action: AnimationAction;
  readonly loops: number;
}

/** Qué está sonando: el bucle de siempre, la entrada o la respuesta a un toque. */
type Mode = 'ambient' | 'entrance' | 'tap';

/**
 * Ejecuta los clips de un GLB en la secuencia y los bucles del catálogo.
 *
 * Dos capas: el bucle AMBIENTAL (`steps`), que no para nunca y es lo que
 * hace que el animal parezca vivo, y los gestos EXPRESIVOS —la entrada al
 * descubrirlo y la respuesta al tocarlo— que interrumpen ese bucle, dan sus
 * vueltas y le devuelven el sitio exactamente donde estaba.
 */
export class IconAnimator {
  private readonly mixer: AnimationMixer | null;
  /** Primero los pasos ambientales, en orden; si el clip de toque no es uno de ellos, va al final. */
  private readonly actions: readonly SequencedAction[];
  private readonly ambientCount: number;
  private current = 0;
  /** Paso ambiental al que se vuelve cuando termina un gesto expresivo. */
  private resumeIndex = 0;
  private completedLoops = 0;
  private running = false;
  private mode: Mode = 'ambient';

  constructor(
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
    private readonly sequence: AnimationSequence | null,
  ) {
    if (sequence === null || clips.length === 0) {
      this.mixer = null;
      this.actions = [];
      this.ambientCount = 0;
      return;
    }

    const mixer = new AnimationMixer(root);
    this.mixer = mixer;
    const actionOf = (name: string, loops: number): SequencedAction[] => {
      const clip = clips.find((candidate) => candidate.name === name);
      if (clip === undefined) {
        console.warn(`[IconAnimator] Falta el clip "${name}"`);
        return [];
      }
      const action = mixer.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      return [{ name, action, loops }];
    };

    const ambient = sequence.steps.flatMap((step) => actionOf(step.name, step.loops));
    this.ambientCount = ambient.length;
    const tapClip = sequence.tapClip;
    const tapIsAmbient = tapClip === null || ambient.some((entry) => entry.name === tapClip);
    this.actions = tapIsAmbient ? ambient : [...ambient, ...actionOf(tapClip, 1)];

    mixer.addEventListener('loop', this.onLoop);
  }

  /** Empieza al descubrir el animal; antes de eso no consume CPU. */
  start(): void {
    if (this.running || this.ambientCount === 0) return;
    this.running = true;
    const entrance = this.sequence?.entranceClip ?? null;
    if (entrance === null) {
      this.play(0, 'ambient');
      return;
    }
    const index = this.indexOf(entrance);
    if (index < 0) {
      this.play(0, 'ambient');
      return;
    }
    // Tras la entrada, el bucle sigue por el paso SIGUIENTE: repetir justo
    // el clip que acaba de sonar se ve como un tartamudeo.
    this.resumeIndex = index < this.ambientCount ? (index + 1) % this.ambientCount : 0;
    this.play(index, 'entrance');
  }

  /** Reinicia el gesto de toque; al terminar, el bucle sigue donde estaba. */
  react(): void {
    const tapClip = this.sequence?.tapClip ?? null;
    if (tapClip === null || this.mixer === null) return;
    const index = this.indexOf(tapClip);
    if (index < 0) return;
    if (this.mode === 'ambient') this.resumeIndex = this.current;
    const wasRunning = this.running;
    this.running = true;
    this.play(index, 'tap', wasRunning);
  }

  /** Si está respondiendo a un toque. */
  get isReacting(): boolean {
    return this.running && this.mode === 'tap';
  }

  /**
   * Por dónde va el gesto de toque, en segundos DEL CLIP (no de reloj: con
   * `tapSpeed` distinto de 1 no coinciden). Sirve para sincronizar efectos
   * con un fotograma concreto del clip, como el salpicón de la ballena.
   */
  get tapClipTime(): number | null {
    if (!this.isReacting) return null;
    const entry = this.actions[this.current];
    return entry === undefined ? null : entry.action.time;
  }

  update(deltaSeconds: number): void {
    if (!this.running || this.mixer === null) return;
    this.mixer.update(deltaSeconds);
  }

  dispose(): void {
    if (this.mixer === null) return;
    this.mixer.removeEventListener('loop', this.onLoop);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }

  private readonly onLoop = (event: { readonly action: AnimationAction; readonly loopDelta?: number }): void => {
    const active = this.actions[this.current];
    if (!this.running || active === undefined || event.action !== active.action) return;

    // Un fotograma largo —o un clip corto acelerado— puede dar varias
    // vueltas de golpe, y three avisa UNA vez con cuántas fueron.
    this.completedLoops += Math.max(1, Math.abs(event.loopDelta ?? 1));
    const loops = this.mode === 'tap'
      ? this.sequence?.tapLoops ?? 1
      : this.mode === 'entrance' ? 1 : active.loops;
    if (this.completedLoops < loops) return;

    if (this.mode === 'ambient') {
      this.play((this.current + 1) % this.ambientCount, 'ambient', true);
    } else {
      this.play(this.resumeIndex, 'ambient', true);
    }
  };

  private indexOf(name: string): number {
    return this.actions.findIndex((entry) => entry.name === name);
  }

  private play(index: number, mode: Mode, crossFade = false): void {
    const previous = crossFade ? this.actions[this.current] : undefined;
    const next = this.actions[index];
    if (next === undefined) return;

    this.current = index;
    this.completedLoops = 0;
    this.mode = mode;
    // Tocar al cangrejo mientras camina, o a la tortuga mientras nada, pide
    // el MISMO clip que ya suena: se sigue desde donde va. Reiniciarlo
    // desde el fotograma 0 hacía saltar la pose de golpe.
    if (previous !== undefined && previous.action === next.action && next.action.isRunning()) {
      next.action.setEffectiveTimeScale(mode === 'tap' ? this.sequence?.tapSpeed ?? 1 : 1);
      return;
    }
    next.action
      .stopFading()
      .reset()
      .setEffectiveTimeScale(mode === 'tap' ? this.sequence?.tapSpeed ?? 1 : 1)
      .setEffectiveWeight(1)
      .play();

    if (previous !== undefined && previous.action !== next.action) {
      previous.action.crossFadeTo(next.action, this.sequence?.crossFadeSeconds ?? 0, false);
    }
  }
}
