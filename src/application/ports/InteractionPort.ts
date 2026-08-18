export interface InteractionHandlers {
  /** Toque sobre el objeto (no sobre el fondo). */
  onTapModel(): void;
  /** Arrastre horizontal. Delta en radianes. */
  onRotate(deltaRadians: number): void;
  /** Pellizco. Factor multiplicativo respecto a la escala actual. */
  onScale(factor: number): void;
}

export interface InteractionPort {
  attach(handlers: InteractionHandlers): void;
  detach(): void;
}
