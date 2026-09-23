import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopRepeat,
  Object3D,
} from 'three';
import type { AnimationSequence } from '@domain/value-objects/AnimationSequence';

interface SequencedAction {
  readonly action: AnimationAction;
  readonly loops: number;
}

/** Ejecuta los clips de un GLB en la secuencia y los bucles del catálogo. */
export class IconAnimator {
  private readonly mixer: AnimationMixer | null;
  private readonly actions: readonly SequencedAction[];
  private current = 0;
  private completedLoops = 0;
  private running = false;

  constructor(
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
    private readonly sequence: AnimationSequence | null,
  ) {
    if (sequence === null || clips.length === 0) {
      this.mixer = null;
      this.actions = [];
      return;
    }

    this.mixer = new AnimationMixer(root);
    this.actions = sequence.steps.flatMap((step) => {
      const clip = clips.find((candidate) => candidate.name === step.name);
      if (clip === undefined) {
        console.warn(`[IconAnimator] Falta el clip "${step.name}"`);
        return [];
      }
      const action = this.mixer!.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      return [{ action, loops: step.loops }];
    });

    this.mixer.addEventListener('loop', this.onLoop);
  }

  /** Empieza al descubrir el animal; antes de eso no consume CPU. */
  start(): void {
    if (this.running || this.actions.length === 0) return;
    this.running = true;
    this.current = 0;
    this.completedLoops = 0;
    this.actions[0]!.action.reset().play();
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

  private readonly onLoop = (event: { readonly action: AnimationAction }): void => {
    const active = this.actions[this.current];
    if (!this.running || active === undefined || event.action !== active.action) return;

    this.completedLoops += 1;
    if (this.completedLoops < active.loops || this.actions.length < 2) return;

    this.completedLoops = 0;
    this.current = (this.current + 1) % this.actions.length;
    const next = this.actions[this.current]!;
    next.action.reset().play();
    active.action.crossFadeTo(next.action, this.sequence?.crossFadeSeconds ?? 0, false);
  };
}
