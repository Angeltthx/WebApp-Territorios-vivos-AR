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

/** Ejecuta los clips de un GLB en la secuencia y los bucles del catálogo. */
export class IconAnimator {
  private readonly mixer: AnimationMixer | null;
  private readonly actions: readonly SequencedAction[];
  private current = 0;
  private completedLoops = 0;
  private running = false;
  /** Entrada o toque: el clip actual termina tras una sola vuelta. */
  private oneShot = false;

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
      return [{ name: step.name, action, loops: step.loops }];
    });

    this.mixer.addEventListener('loop', this.onLoop);
  }

  /** Empieza al descubrir el animal; antes de eso no consume CPU. */
  start(): void {
    if (this.running || this.actions.length === 0) return;
    this.running = true;
    this.play(this.indexOf(this.sequence?.entranceClip), this.sequence?.entranceClip !== null);
  }

  /** Reinicia inmediatamente el gesto expresivo configurado para el toque. */
  react(): void {
    if (this.actions.length === 0) return;
    const wasRunning = this.running;
    this.running = true;
    this.play(this.indexOf(this.sequence?.tapClip), true, wasRunning);
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
    const loops = this.oneShot ? 1 : active.loops;
    if (this.completedLoops < loops) return;

    if (this.actions.length < 2) {
      this.completedLoops = 0;
      this.oneShot = false;
      return;
    }

    this.oneShot = false;
    this.play((this.current + 1) % this.actions.length, false, true);
  };

  private indexOf(name: string | null | undefined): number {
    if (name === null || name === undefined) return 0;
    const index = this.actions.findIndex((entry) => entry.name === name);
    return index < 0 ? 0 : index;
  }

  private play(index: number, oneShot: boolean, crossFade = false): void {
    const previous = crossFade ? this.actions[this.current] : undefined;
    const next = this.actions[index]!;

    this.current = index;
    this.completedLoops = 0;
    this.oneShot = oneShot;
    next.action.stopFading().reset().setEffectiveWeight(1).play();

    if (previous !== undefined && previous.action !== next.action) {
      previous.action.crossFadeTo(next.action, this.sequence?.crossFadeSeconds ?? 0, false);
    }
  }
}
