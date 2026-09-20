import { buildContainer } from '@infrastructure/di/container';
import { Proximity } from '@domain/value-objects/Proximity';
import { ArView } from '@ui/ArView';

/**
 * Marcador: el mapa ilustrado de Nuquí (Chocó).
 *
 * El `.mind` se genera desde la imagen con:
 *     npm run compile-target
 *
 * TARGET_ASPECT tiene que coincidir con la imagen que se compiló — es lo
 * que convierte los MarkerSpot del catálogo en coordenadas del anchor. Si
 * cambias el mapa, cambia también este número (y vuelve a medir los spots).
 */
const TARGET_SRC = '/targets/map.mind';
const TARGET_ASPECT = 1432 / 1000;

/**
 * Umbrales de cercanía, ajustables por URL:
 *
 *     ?reveal=0.9&hide=1.2&aim=0.6
 *
 * Existe porque estos números NO se pueden calcular aquí: dependen del
 * campo de visión de la cámara real y del tamaño al que esté impreso —o en
 * pantalla— el mapa. Poder moverlos desde la barra de direcciones permite
 * calibrarlos con el teléfono en la mano, sin recompilar ni desplegar.
 */
function tunedProximity(): Proximity {
  const params = new URLSearchParams(window.location.search);
  const base = Proximity.default();

  const value = (key: string, fallback: number): number => {
    const raw = params.get(key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  try {
    return Proximity.of(
      value('reveal', base.revealDistance),
      value('hide', base.hideDistance),
      value('aim', base.aimRadius),
    );
  } catch (error) {
    // Una combinación inválida en la URL no puede tumbar la experiencia.
    console.warn('[main] Umbrales de cercanía inválidos; se usan los de serie', error);
    return base;
  }
}

const root = document.querySelector<HTMLElement>('#app');
const arContainer = document.querySelector<HTMLElement>('#ar-container');

if (root === null || arContainer === null) {
  throw new Error('El HTML no contiene #app o #ar-container');
}

let view: ArView;
let gesturesAttached = false;

const {
  startArExperience,
  transformPlacement,
  playModelSound,
  closeFocus,
  interaction,
  audio,
} = buildContainer({
  container: arContainer,
  imageTargetSrc: TARGET_SRC,
  targetAspect: TARGET_ASPECT,
  proximity: tunedProximity(),
  onSessionChange: (session) => view?.render(session),
});

// El audio se desbloquea en el PRIMER toque en cualquier sitio.
//
// El desbloqueo bueno lo hace "Iniciar experiencia AR", que es un gesto de
// usuario de verdad y llama a `unlock()` como primera instruccion (ver
// StartArExperience.execute). Esto es el cinturon ademas de los tirantes:
// si algun dia vuelve a arrancarse sin boton, el audio sigue funcionando.
// `capture: true` para llegar antes que cualquier otro manejador, y
// `once: true` porque desbloquear dos veces no aporta nada.
window.addEventListener('pointerdown', () => void audio.unlock(), {
  once: true,
  capture: true,
});

view = new ArView(root, {
  // Arranca la descarga de los .glb mientras se ve la bienvenida. Si falla,
  // se calla: `execute` volverá a intentarlo y ahí sí se muestra el error.
  onPrepare: () => {
    void startArExperience
      .prepare('whale')
      // La vista necesita el catálogo para poder escribir el nombre y la
      // ficha del animal que se mire de cerca.
      .then(({ catalog }) => view.setCatalog(catalog))
      .catch(() => {});
  },

  onCloseFocus: () => closeFocus.execute(),

  onStart: async () => {
    const session = await startArExperience.execute('whale');

    // Si el arranque falló, MindAR nunca creó el canvas y enganchar los
    // gestos lanzaría una excepción. Solo se conectan si hay sesión viva.
    if (!session.hasStarted || gesturesAttached) return;
    gesturesAttached = true;

    interaction.attach({
      onTapModel: (modelId) => void playModelSound.execute(modelId),
      onRotate: (delta) => transformPlacement.rotateBy(delta),
      onScale: (factor) => transformPlacement.scaleBy(factor),
    });
  },
});

view.render(startArExperience.current);

// Libera cámara y audio si el usuario cambia de pestaña o cierra.
window.addEventListener('pagehide', () => {
  if (gesturesAttached) {
    interaction.detach();
    gesturesAttached = false;
  }
  void startArExperience.stop();
});
