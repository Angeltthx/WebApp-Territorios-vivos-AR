import { Scale } from './Scale';

/**
 * Desde qué cara se mira un icono cuando el mapa está sobre la mesa.
 *
 *  - `front` el icono se levanta del papel MIRANDO A QUIEN SOSTIENE EL
 *            teléfono. Es la que usan hoy los cuatro animales: da una
 *            lectura uniforme, y como el dedo los hace girar sobre su eje
 *            vertical, quien quiera verlos de lado los gira y ya.
 *  - `top`   el icono se apoya sobre el papel y se ve DESDE ARRIBA (su
 *            lomo), como está dibujado un cangrejo o una tortuga en planta.
 *  - `side`  el icono queda de perfil, como una figura de cartón levantada
 *            sobre el papel.
 *
 * `top` y `side` ya no las usa ningún animal, pero se quedan porque son el
 * vocabulario con el que se ajusta el catálogo: volver a poner a la tortuga
 * en planta es cambiar una palabra, no reescribir MarkerPin.
 */
export type IconView = 'front' | 'top' | 'side';

const VIEWS: readonly IconView[] = ['front', 'top', 'side'];

/**
 * Cómo se presenta un icono sobre el mapa: desde qué cara se mira y cuánto
 * ocupa respecto al tamaño base.
 *
 * Vive en el dominio porque es una propiedad del animal, no del motor de
 * render: una ballena es enorme y se reconoce de perfil, y eso seguiría
 * siendo cierto si mañana se cambia MindAR por WebXR. Traducirlo a
 * rotaciones y escalas de Three.js es trabajo de MarkerPin e IconLoader.
 */
export class IconPose {
  private constructor(
    readonly view: IconView,
    /** Multiplica el tamaño base del icono. 1 = como los demás. */
    readonly size: number,
    /**
     * Hacia dónde mira, en RADIANES, girando sobre su propio eje vertical.
     *
     * Hace falta porque cada modelo viene mirando hacia donde le convino a
     * quien lo esculpió, y sobre el mapa cada animal tiene que mirar hacia
     * donde mira su dibujo. Se compone con el giro que hace el usuario, así
     * que sigue siendo un giro EN EL SITIO: no despega al icono de su punto.
     */
    readonly facing: number,
  ) {
    Object.freeze(this);
  }

  /** @param facingDegrees grados; es como se lee y se ajusta en el catálogo. */
  static of(view: IconView, size = 1, facingDegrees = 0): IconPose {
    if (!VIEWS.includes(view)) {
      throw new RangeError(`Vista desconocida: "${view}". Usa ${VIEWS.join(' o ')}.`);
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new RangeError(`Tamaño inválido: ${size}. Debe ser un número positivo.`);
    }
    if (!Number.isFinite(facingDegrees)) {
      throw new RangeError(`Giro inválido: ${facingDegrees}. Debe ser un número de grados.`);
    }
    // Se reutilizan los topes de Scale: un icono tampoco puede desaparecer
    // ni tragarse el mapa entero.
    return new IconPose(
      view,
      Math.min(Scale.MAX, Math.max(Scale.MIN, size)),
      (facingDegrees * Math.PI) / 180,
    );
  }

  static default(): IconPose {
    return IconPose.of('front', 1, 0);
  }
}
