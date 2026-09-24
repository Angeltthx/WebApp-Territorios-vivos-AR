export interface InteractionHandlers {
  /**
   * Toque sobre uno de los iconos (no sobre el fondo ni sobre el mapa).
   * Recibe el id del icono tocado: con varios en pantalla a la vez, saber
   * "se tocó algo" ya no basta.
   */
  onTapModel(modelId: string): void;
  /**
   * Arrastre horizontal. Delta en radianes.
   *
   * No hay pellizco para escalar: se quitó a propósito. Cada animal tiene su
   * tamaño calibrado en el catálogo y agrandarlo a mano rompía esa
   * jerarquía (y lo sacaba de encima de su dibujo).
   */
  onRotate(deltaRadians: number): void;
}

export interface InteractionPort {
  attach(handlers: InteractionHandlers): void;
  detach(): void;
}
