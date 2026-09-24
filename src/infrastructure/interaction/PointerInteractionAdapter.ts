import { Object3D, Raycaster, SkinnedMesh, Vector2 } from 'three';
import type { InteractionHandlers, InteractionPort } from '@application/ports/InteractionPort';
import type { MindArRuntime } from '../mindar/MindArRuntime';

/**
 * Umbrales para distinguir un toque de un arrastre.
 *
 * Eran 12 px y 350 ms, medidas de ratón. Con el teléfono en una mano y el
 * mapa en la otra, un dedo se desplaza más que eso solo por el pulso, y
 * quien toca un animal esperando oírlo se queda apoyado bastante más de un
 * tercio de segundo. Cada vez que se pasaba de cualquiera de los dos, el
 * toque se descartaba como arrastre y no sonaba nada. Se ensanchan hasta
 * donde sigue sin confundirse con el gesto de girar, que es continuo y
 * recorre mucho más de 20 px.
 */
const TAP_MAX_MOVE_PX = 20;
const TAP_MAX_DURATION_MS = 650;
const ROTATION_PER_PIXEL = 0.008;

export interface InteractiveSource {
  /** Objetos tocables indexados por id, o null si no hay nada a la vista. */
  readonly pickables: ReadonlyMap<string, Object3D> | null;
}

/**
 * Traduce eventos de puntero en intenciones del dominio:
 * toque sobre el objeto y arrastre para rotar (sin pellizco: el tamaño es fijo).
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
  private moved = false;

  private readonly onPointerDown = (event: PointerEvent) => this.handleDown(event);
  private readonly onPointerMove = (event: PointerEvent) => this.handleMove(event);
  private readonly onPointerUp = (event: PointerEvent) => this.handleUp(event);
  private readonly onPointerCancel = () => {
    this.active.clear();
    this.moved = true;
  };

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
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);
  }

  detach(): void {
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.active.clear();
    this.handlers = null;
  }

  private handleDown(event: PointerEvent): void {
    this.canvas.setPointerCapture(event.pointerId);
    this.active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.active.size === 1) {
      this.startX = event.clientX;
      this.startY = event.clientY;
      this.lastX = event.clientX;
      this.startedAt = performance.now();
      this.moved = false;
      return;
    }

    // Un segundo dedo anula el toque, pero ya no escala: el tamaño de cada
    // animal es fijo (ver InteractionPort).
    if (this.active.size >= 2) this.moved = true;
  }

  private handleMove(event: PointerEvent): void {
    if (!this.active.has(event.pointerId) || this.handlers === null) return;
    this.active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.active.size >= 2) {
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

    if (this.handlers === null || !wasSinglePointer || this.moved) return;

    const elapsed = performance.now() - this.startedAt;
    if (elapsed > TAP_MAX_DURATION_MS) return;

    const target = this.targetAt(event.clientX, event.clientY);
    if (target === null) return;

    if (target.kind === 'text') this.handlers.onTapText(target.id);
    else this.handlers.onTapModel(target.id);
  }

  /**
   * Qué icono hay bajo el dedo, o null si se tocó el fondo.
   *
   * Se lanza el rayo contra los cuatro a la vez y gana el más cercano a la
   * cámara: con iconos que pueden solaparse en pantalla según el ángulo,
   * comprobarlos por separado daría el equivocado.
   */
  private targetAt(clientX: number, clientY: number): TapTarget | null {
    const targets = this.source.pickables;
    if (targets === null || targets.size === 0) return null;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.runtime.mindar.camera);
    for (const target of targets.values()) refreshSkinnedBounds(target);
    const hits = this.raycaster.intersectObjects([...targets.values()], true);

    // intersectObjects devuelve ordenado por distancia, así que el primero
    // que tenga un id asociado es el icono de delante. Dos excepciones:
    //  - Lo invisible no cuenta. El raycaster de three lo atraviesa igual
    //    que lo visible, y un objeto oculto no puede ser lo que se tocó.
    //  - La zona de cortesía de un animal (su huella sobre el papel) cede
    //    ante un texto: el animal flota por encima del mapa, así que su
    //    zona siempre queda delante del texto y tocar un punto de texto al
    //    lado de un animal lo animaba a él. El cuerpo del animal sí gana.
    let courtesy: TapTarget | null = null;
    for (const hit of hits) {
      if (!isShown(hit.object)) continue;
      const target = findTarget(hit.object);
      if (target === null) continue;
      if (hit.object.userData['tapZone'] === true) {
        courtesy ??= target;
        continue;
      }
      return target;
    }
    return courtesy;
  }

  private get canvas(): HTMLCanvasElement {
    return this.runtime.mindar.renderer.domElement;
  }
}

/**
 * Recalcula la caja y la esfera de cada malla animada en la postura de
 * AHORA, antes de lanzar el rayo.
 *
 * Three las calcula una sola vez —en la postura de ese momento— y las usa
 * como filtro previo en cada toque. Los animales se mueven con sus clips,
 * así que el cuerpo acababa fuera de esa caja vieja y el toque se
 * descartaba antes de mirar el cuerpo. El primer toque siempre funcionaba
 * (era el que las calculaba, para los cuatro a la vez), y a partir de ahí
 * tocar otro animal fallaba. El humo invisible, enorme, lo tapaba; al
 * dejar de ser tocable salió a la luz. Recalcular cuesta recorrer los
 * vértices, y solo se hace al levantar el dedo.
 */
function refreshSkinnedBounds(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    object.computeBoundingSphere();
    object.computeBoundingBox();
  });
}

/** Visible de verdad: ella y todos sus padres. */
function isShown(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current !== null) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/**
 * El rayo acierta a una malla suelta (una aleta, la zona de toque…), no al
 * grupo del icono. Subimos por el árbol hasta encontrar quién lleva el id.
 */
interface TapTarget {
  readonly kind: 'model' | 'text';
  readonly id: string;
}

/**
 * Sube desde la malla tocada hasta encontrar a quién pertenece: un animal
 * (`userData.modelId`, en su MarkerPin) o un texto del mapa
 * (`userData.textId`, en su MapTextHotspot). Si un animal y un texto se
 * solapan, gana el que esté delante, que es el primero de `hits`.
 */
function findTarget(object: Object3D): TapTarget | null {
  let current: Object3D | null = object;
  while (current !== null) {
    const modelId: unknown = current.userData['modelId'];
    if (typeof modelId === 'string') return { kind: 'model', id: modelId };
    const textId: unknown = current.userData['textId'];
    if (typeof textId === 'string') return { kind: 'text', id: textId };
    current = current.parent;
  }
  return null;
}
