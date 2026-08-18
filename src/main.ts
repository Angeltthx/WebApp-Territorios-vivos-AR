import { buildContainer } from '@infrastructure/di/container';
import { ArView } from '@ui/ArView';

/**
 * Marcador por defecto: el archivo de ejemplo de la documentación de MindAR,
 * servido desde jsDelivr. Permite que la app funcione desde el primer
 * despliegue sin compilar tu propio target.
 *
 * Para producción: compila tu imagen en el compilador oficial de MindAR,
 * guarda el .mind en public/targets/ y usa '/targets/target.mind'.
 */
const TARGET_SRC =
  'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/examples/image-tracking/assets/card-example/card.mind';

const ROTATION_STEP = Math.PI / 12; // 15 grados
const SCALE_STEP = 1.15;

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
  switchModel,
  playModelSound,
  interaction,
  catalog,
} = buildContainer({
  container: arContainer,
  imageTargetSrc: TARGET_SRC,
  onSessionChange: (session) => view?.render(session),
});

view = new ArView(root, catalog, {
  onStart: async () => {
    const session = await startArExperience.execute('headphones');

    // Si el arranque falló, MindAR nunca creó el canvas y enganchar los
    // gestos lanzaría una excepción. Solo se conectan si hay sesión viva.
    if (!session.hasStarted || gesturesAttached) return;
    gesturesAttached = true;

    interaction.attach({
      onTapModel: () => void playModelSound.execute(),
      onRotate: (delta) => transformPlacement.rotateBy(delta),
      onScale: (factor) => transformPlacement.scaleBy(factor),
    });
  },
  onSelectModel: (modelId) => void switchModel.execute(modelId),
  onRotateLeft: () => transformPlacement.rotateBy(-ROTATION_STEP),
  onRotateRight: () => transformPlacement.rotateBy(ROTATION_STEP),
  onScaleUp: () => transformPlacement.scaleBy(SCALE_STEP),
  onScaleDown: () => transformPlacement.scaleBy(1 / SCALE_STEP),
  onCycleStabilization: () => {
    const next = startArExperience.current.stabilization.next();
    startArExperience.applyStabilization(next);
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
