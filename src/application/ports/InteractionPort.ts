export interface InteractionHandlers {
  /**
   * Toque sobre uno de los iconos (no sobre el fondo ni sobre el mapa).
   * Recibe el id del icono tocado: con varios en pantalla a la vez, saber
   * "se tocó algo" ya no basta.
   */
  onTapModel(modelId: string): void;
  /** Arrastre horizontal. Delta en radianes. */
  onRotate(deltaRadians: number): void;
  /** Pellizco. Factor multiplicativo respecto a la escala actual. */
  onScale(factor: number): void;
}

export interface InteractionPort {
  attach(handlers: InteractionHandlers): void;
  detach(): void;
}
