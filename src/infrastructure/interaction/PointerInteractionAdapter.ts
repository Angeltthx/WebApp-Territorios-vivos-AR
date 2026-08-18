import { Object3D, Raycaster, Vector2 } from 'three';
import type { InteractionHandlers, InteractionPort } from '@application/ports/InteractionPort';
import type { MindArRuntime } from '../mindar/MindArRuntime';

/** Umbrales para distinguir un toque de un arrastre. */
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_DURATION_MS = 350;
const ROTATION_PER_PIXEL = 0.008;

export interface InteractiveSource {
  readonly interactiveObject: Object3D | null;
}

/**
 * Traduce eventos de puntero en intenciones del dominio:
 * toque sobre el objeto, arrastre para rotar, pellizco para escalar.
 *
 * Usa Pointer Events, que unifican ratón y táctil y funcionan en Safari iOS
 * desde la versión 13. No hay ramas separadas para touch y mouse.
 */
export class PointerInteractionAdapter implements InteractionPort {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly active = new Map<number, { x: number; y: number }>();

  private handlers: InteractionHandlers | null = null;
  private startX = 0;
  private startY = 0;
  private startedAt = 0;
  private lastX = 0;
  private pinchDistance = 0;
  private moved = false;

  private readonly onPointerDown = (event: PointerEvent) => this.handleDown(event);
  private readonly onPointerMove = (event: PointerEvent) => this.handleMove(event);
  private readonly onPointerUp = (event: PointerEvent) => this.handleUp(event);

  constructor(
    private readonly runtime: MindArRuntime,
    private readonly source: InteractiveSource,
  ) {}

  attach(handlers: InteractionHandlers): void {
    this.handlers = handlers;
    const canvas = this.canvas;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  detach(): void {
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.active.clear();
    this.handlers = null;
  }

  private handleDown(event: PointerEvent): void {
    this.active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.active.size === 1) {
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.lastX = event.clientX;
      this.startedAt = performance.now();
      this.moved = false;
      return;
    }

    if (this.active.size === 2) {
      this.pinchDistance = this.currentPinchDistance();
    }
  }

  private handleMove(event: PointerEvent): void {
    if (!this.active.has(event.pointerId) || this.handlers === null) return;
    this.active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.active.size >= 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0 && distance > 0) {
        this.handlers.onScale(distance / this.pinchDistance);
      }
      this.pinchDistance = distance;
      this.moved = true;
      return;
    }

    const totalDelta = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
    if (totalDelta > TAP_MAX_MOVE_PX) {
      this.moved = true;
      this.handlers.onRotate((event.clientX - this.lastX) * ROTATION_PER_PIXEL);
    }
    this.lastX = event.clientX;
  }

  private handleUp(event: PointerEvent): void {
    const wasSinglePointer = this.active.size === 1;
    this.active.delete(event.pointerId);

    if (this.active.size < 2) this.pinchDistance = 0;
    if (this.handlers === null || !wasSinglePointer || this.moved) return;

    const elapsed = performance.now() - this.startedAt;
    if (elapsed > TAP_MAX_DURATION_MS) return;
    if (!this.hitsModel(event.clientX, event.clientY)) return;

    this.handlers.onTapModel();
  }

  private hitsModel(clientX: number, clientY: number): boolean {
    const target = this.source.interactiveObject;
    if (target === null || !target.visible) return false;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.runtime.mindar.camera);
    return this.raycaster.intersectObject(target, true).length > 0;
  }

  private currentPinchDistance(): number {
    const points = [...this.active.values()];
    const first = points[0];
    const second = points[1];
    if (first === undefined || second === undefined) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  private get canvas(): HTMLCanvasElement {
    return this.runtime.mindar.renderer.domElement;
  }
}
