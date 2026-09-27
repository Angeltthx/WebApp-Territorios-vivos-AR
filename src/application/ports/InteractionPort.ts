export interface InteractionHandlers {
  /**
   * Toque sobre uno de los iconos (no sobre el fondo ni sobre el mapa).
   * Recibe el id del icono tocado: con varios en pantalla a la vez, saber
   * "se tocó algo" ya no basta.
   */
  onTapModel(modelId: string): void;
  /**
   * Dos toques seguidos sobre el MISMO animal. El primero ya llegó como
   * `onTapModel` (y el animal ya está haciendo su gesto); el segundo, en vez
   * de otro toque, llega aquí: es el gesto que abre su primer plano.
   */
  onDoubleTapModel(modelId: string): void;
  /**
   * Toque sobre un texto del mapa marcado con destellos (solo existen
   * cuando ya se encontraron todos los animales).
   */
  onTapText(textId: string): void;
  /**
   * Arrastre sobre UN animal: el que había bajo el dedo al empezar, o el
   * que está en primer plano. Deltas en radianes: `yaw` del arrastre
   * horizontal (girarlo de lado), `pitch` del vertical (inclinarlo).
   *
   * No hay pellizco para escalar: se quitó a propósito. Cada animal tiene su
   * tamaño calibrado en el catálogo y agrandarlo a mano rompía esa
   * jerarquía (y lo sacaba de encima de su dibujo).
   */
  onRotate(modelId: string, yawRadians: number, pitchRadians: number): void;
}

export interface InteractionPort {
  attach(handlers: InteractionHandlers): void;
  detach(): void;
}
