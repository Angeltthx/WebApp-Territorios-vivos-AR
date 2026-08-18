import type { ArModelSnapshot } from '@domain/entities/ArModel';
import type { ArSession, SessionStatus } from '@domain/entities/ArSession';
import type { StabilizationLevel } from '@domain/value-objects/Stabilization';

const HINTS: Record<SessionStatus, string> = {
  idle: 'Pulsa Iniciar para activar la cámara',
  preparing: 'Preparando la escena…',
  searching: 'Apunta la cámara al marcador',
  tracking: 'Tócalo para que suene · arrastra para girar · pellizca para escalar',
  lost: 'Marcador fuera de encuadre. Vuelve a apuntar',
  error: 'Ocurrió un problema',
};

const STABILIZATION_LABELS: Record<StabilizationLevel, string> = {
  responsive: 'Rápido',
  balanced: 'Equilibrado',
  stable: 'Estable',
};

export interface ArViewCallbacks {
  onStart: () => void;
  onSelectModel: (modelId: string) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onScaleUp: () => void;
  onScaleDown: () => void;
  onCycleStabilization: () => void;
}

/**
 * Capa externa: solo pinta estado y emite intenciones.
 * No conoce MindAR, ni Three.js, ni las reglas de escala o rotación.
 */
export class ArView {
  private readonly hint: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly stabilizationButton: HTMLButtonElement;
  private readonly modelButtons = new Map<string, HTMLButtonElement>();

  constructor(
    root: HTMLElement,
    catalog: readonly ArModelSnapshot[],
    callbacks: ArViewCallbacks,
  ) {
    this.hint = this.require(root, '#hint');
    this.startButton = this.require<HTMLButtonElement>(root, '#start');
    this.controls = this.require(root, '#controls');
    this.picker = this.require(root, '#picker');
    this.stabilizationButton = this.require<HTMLButtonElement>(root, '#stabilization');

    this.startButton.addEventListener('click', callbacks.onStart);
    this.require(root, '#rot-left').addEventListener('click', callbacks.onRotateLeft);
    this.require(root, '#rot-right').addEventListener('click', callbacks.onRotateRight);
    this.require(root, '#scale-up').addEventListener('click', callbacks.onScaleUp);
    this.require(root, '#scale-down').addEventListener('click', callbacks.onScaleDown);
    this.stabilizationButton.addEventListener('click', callbacks.onCycleStabilization);

    this.buildPicker(catalog, callbacks.onSelectModel);
  }

  render(session: ArSession): void {
    this.hint.textContent = session.error?.message ?? HINTS[session.status];
    this.hint.dataset['tone'] = session.status === 'error' ? 'error' : 'normal';

    this.startButton.hidden = !session.canStart;
    this.startButton.textContent = session.status === 'error' ? 'Reintentar' : 'Iniciar AR';

    this.controls.hidden = !session.hasStarted;
    this.picker.hidden = !session.hasStarted;

    this.stabilizationButton.textContent = STABILIZATION_LABELS[session.stabilization.level];

    const activeId = session.activeModelId?.value ?? null;
    for (const [id, button] of this.modelButtons) {
      button.dataset['active'] = String(id === activeId);
    }
  }

  private buildPicker(
    catalog: readonly ArModelSnapshot[],
    onSelect: (modelId: string) => void,
  ): void {
    for (const model of catalog) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = model.name;
      button.dataset['active'] = 'false';
      button.addEventListener('click', () => onSelect(model.id));
      this.picker.append(button);
      this.modelButtons.set(model.id, button);
    }
  }

  /** Falla ruidosamente si el HTML y la vista se desincronizan. */
  private require<T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (element === null) {
      throw new Error(`Falta el elemento "${selector}" en el HTML`);
    }
    return element;
  }
}
