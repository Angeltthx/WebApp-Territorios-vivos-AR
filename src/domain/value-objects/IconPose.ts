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
    /**
     * Desde qué cara se calca el contorno punteado del suelo.
     *
     * Se separa de `view` porque son dos preguntas distintas: `view` decide
     * cómo se levanta el MODELO sobre el mapa, y esto decide desde dónde se
     * mira para dibujar su SILUETA sobre el papel. La ballena está de
     * frente para que se le vea la cara, pero en el mapa está dibujada de
     * perfil, así que su contorno hay que sacarlo de perfil o no se parece
     * en nada al dibujo.
     */
    readonly outlineView: IconView,
    /** Giro del contorno para cuadrarlo con el dibujo, en RADIANES. */
    readonly outlineSpin: number,
    /**
     * Si el contorno va ESPEJADO respecto al modelo.
     *
     * Un perfil tiene dos lados y el ilustrador eligió uno por animal: la
     * pava del mapa mira a la izquierda y la ballena a la derecha, y el
     * modelo solo puede dar uno de los dos. Girar 180° no sirve como
     * espejo, porque eso además deja al animal panza arriba.
     */
    readonly outlineMirror: boolean,
    /**
     * Multiplica el tamaño en PRIMER PLANO, y solo ahí. Allí el animal se
     * encaja a la pantalla, no al mapa, así que `size` no le afecta: esto
     * es lo que deja ajustar uno sin tocar a los demás. 1 = como encaja.
     */
    readonly focusSize: number = 1,
  ) {
    Object.freeze(this);
  }

  /** @param facingDegrees grados; es como se lee y se ajusta en el catálogo. */
  static of(
    view: IconView,
    size = 1,
    facingDegrees = 0,
    outlineView: IconView = view,
    outlineSpinDegrees = 0,
    outlineMirror = false,
    focusSize = 1,
  ): IconPose {
    if (!Number.isFinite(focusSize) || focusSize <= 0 || focusSize > 1) {
      throw new RangeError(`Tamaño en primer plano inválido: ${focusSize}. Entre 0 y 1.`);
    }
    if (!VIEWS.includes(view)) {
      throw new RangeError(`Vista desconocida: "${view}". Usa ${VIEWS.join(' o ')}.`);
    }
    if (!VIEWS.includes(outlineView)) {
      throw new RangeError(`Vista de contorno desconocida: "${outlineView}".`);
    }
    if (!Number.isFinite(outlineSpinDegrees)) {
      throw new RangeError(`Giro de contorno inválido: ${outlineSpinDegrees}.`);
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
      outlineView,
      (outlineSpinDegrees * Math.PI) / 180,
      outlineMirror,
      focusSize,
    );
  }

  static default(): IconPose {
    return IconPose.of('front', 1, 0);
  }
}
