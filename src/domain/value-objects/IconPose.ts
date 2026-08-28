import { Scale } from './Scale';

/**
 * Desde qué cara se mira un icono cuando el mapa está sobre la mesa.
 *
 *  - `top`  el icono se apoya sobre el papel y se ve DESDE ARRIBA (su lomo).
 *           Es lo natural para un cangrejo o una tortuga, que en el mapa
 *           están dibujados en planta.
 *  - `side` el icono queda de perfil, como una figura de cartón levantada
 *           sobre el papel. Es lo natural para la ballena y la pava, que en
 *           el mapa están dibujadas de lado: vistas desde arriba se
 *           reconocen mucho peor.
 *
 * No es una preferencia estética suelta: cada animal se reconoce por una
 * silueta concreta, y es la misma que eligió la ilustradora del mapa.
 */
export type IconView = 'top' | 'side';

const VIEWS: readonly IconView[] = ['top', 'side'];

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
  ) {
    Object.freeze(this);
  }

  static of(view: IconView, size = 1): IconPose {
    if (!VIEWS.includes(view)) {
      throw new RangeError(`Vista desconocida: "${view}". Usa ${VIEWS.join(' o ')}.`);
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new RangeError(`Tamaño inválido: ${size}. Debe ser un número positivo.`);
    }
    // Se reutilizan los topes de Scale: un icono tampoco puede desaparecer
    // ni tragarse el mapa entero.
    return new IconPose(view, Math.min(Scale.MAX, Math.max(Scale.MIN, size)));
  }

  static default(): IconPose {
    return IconPose.of('top', 1);
  }
}
