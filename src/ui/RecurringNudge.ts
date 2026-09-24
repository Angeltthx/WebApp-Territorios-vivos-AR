/** Temporizadores inyectables: las pruebas avanzan el reloj a mano. */
export interface NudgeTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: NudgeTimers = {
  set: (callback, ms) => window.setTimeout(callback, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};

/**
 * Un aviso que sale, se aparta solo y VUELVE si el usuario no hace nada.
 *
 * Es el ciclo de la invitación «¿Quieres conocer más del Chocó?»: sale en
 * cuanto puede (`eligible`), se va a los `visibleMs`, y si sigue pudiendo
 * salir y pasan `idleMs` sin que deje de poder —sin que se abra nada—,
 * vuelve. En cuanto deja de poder (se abrió un texto o una ficha) se
 * aparta y el reloj de inactividad se reinicia al volver.
 *
 * Aparte de ArView para poder probar el ciclo sin DOM y sin esperar: en
 * una pestaña en segundo plano Chrome retrasa los temporizadores
 * encadenados hasta un minuto, así que comprobarlo en el navegador engaña.
 */
export class RecurringNudge {
  private visible = false;
  private shownOnce = false;
  private eligible = false;
  private hideTimer: unknown = null;
  private idleTimer: unknown = null;

  constructor(
    private readonly show: () => void,
    private readonly hide: () => void,
    private readonly visibleMs: number,
    private readonly idleMs: number,
    private readonly timers: NudgeTimers = browserTimers,
  ) {}

  /** Si ahora mismo el aviso tiene sentido. Se llama en cada render. */
  update(eligible: boolean): void {
    this.eligible = eligible;
    if (!eligible) {
      this.clear('hide');
      this.clear('idle');
      if (this.visible) {
        this.visible = false;
        this.hide();
      }
      return;
    }
    if (this.visible || this.idleTimer !== null) return;
    if (!this.shownOnce) {
      this.showNow();
      return;
    }
    this.idleTimer = this.timers.set(() => {
      this.idleTimer = null;
      if (this.eligible) this.showNow();
    }, this.idleMs);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.clear('hide');
    this.clear('idle');
  }

  private showNow(): void {
    this.shownOnce = true;
    this.visible = true;
    this.show();
    this.hideTimer = this.timers.set(() => {
      this.hideTimer = null;
      this.visible = false;
      this.hide();
      // Se fue por tiempo, no por uso: empieza a contar la inactividad.
      this.update(this.eligible);
    }, this.visibleMs);
  }

  private clear(which: 'hide' | 'idle'): void {
    const handle = which === 'hide' ? this.hideTimer : this.idleTimer;
    if (handle !== null) this.timers.clear(handle);
    if (which === 'hide') this.hideTimer = null;
    else this.idleTimer = null;
  }
}
