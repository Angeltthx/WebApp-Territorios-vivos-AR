/**
 * A qué distancia hay que acercar la cámara a un animal para que aparezca.
 *
 * Es una regla de la experiencia, no del motor 3D: "los animales no se
 * regalan por apuntar al mapa, hay que ir a buscarlos" seguiría siendo
 * cierto si mañana se cambia MindAR por WebXR. Medirla en el espacio de la
 * escena es trabajo del adaptador de render.
 *
 * La unidad es el ANCHO DEL MAPA, que es la unidad del anchor de MindAR.
 * `revealDistance = 1.2` significa "cuando la cámara esté a menos de 1,2
 * anchos de mapa de ese animal".
 *
 * HISTÉRESIS: hay dos distancias, no una. Con un solo umbral, quedarse
 * justo en el límite hace que el animal aparezca y desaparezca varias veces
 * por segundo con el temblor del pulso. Aparecer exige acercarse más de lo
 * que hace falta para seguir viéndolo, así que la zona intermedia mantiene
 * lo que ya estaba decidido.
 */
export class Proximity {
  private constructor(
    /** Hay que acercarse a MENOS de esto para que aparezca. */
    readonly revealDistance: number,
    /** Hay que alejarse a MÁS de esto para que se vuelva a esconder. */
    readonly hideDistance: number,
    /**
     * Cuánto puede desviarse el animal del centro de la pantalla, en
     * coordenadas normalizadas (0 = centrado, 1 = borde). Sin esto, acercarse
     * a la ballena revelaría también al cangrejo: sobre un mapa plano, todos
     * los animales quedan a una distancia parecida de la cámara. Lo que
     * distingue a cuál te estás acercando es a cuál APUNTAS.
     */
    readonly aimRadius: number,
  ) {
    Object.freeze(this);
  }

  static of(revealDistance: number, hideDistance: number, aimRadius: number): Proximity {
    if (revealDistance <= 0) {
      throw new RangeError(`revealDistance debe ser positiva: ${revealDistance}`);
    }
    if (hideDistance <= revealDistance) {
      throw new RangeError(
        `hideDistance (${hideDistance}) debe ser mayor que revealDistance ` +
          `(${revealDistance}), o no hay histéresis y el animal parpadea`,
      );
    }
    if (aimRadius <= 0 || aimRadius > 2) {
      throw new RangeError(`aimRadius fuera de rango: ${aimRadius}`);
    }
    return new Proximity(revealDistance, hideDistance, aimRadius);
  }

  /**
   * Valores de partida, PENDIENTES DE CALIBRAR CON EL MAPA IMPRESO.
   *
   * No se pueden deducir en el escritorio: dependen del campo de visión de
   * la cámara real y del tamaño al que se imprima el mapa. El adaptador
   * escribe en consola la distancia medida al animal más centrado, así que
   * se ajustan mirando ese número en el teléfono.
   */
  static default(): Proximity {
    return new Proximity(1.25, 1.6, 0.62);
  }

  /**
   * ¿Debe verse este animal, sabiendo si ya se veía?
   *
   * @param distance    distancia de la cámara al animal, en anchos de mapa
   * @param offCentre   cuánto se desvía del centro de la pantalla (0–1+)
   * @param wasRevealed si estaba visible en el fotograma anterior
   */
  decide(distance: number, offCentre: number, wasRevealed: boolean): boolean {
    if (offCentre > this.aimRadius) return false;
    return wasRevealed ? distance <= this.hideDistance : distance <= this.revealDistance;
  }
}
