import { buildContainer } from '@infrastructure/di/container';
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
const TARGET_ASPECT = 1280 / 880;

const ROTATION_STEP = Math.PI / 12; // 15 grados
const SCALE_STEP = 1.15;

const root = document.querySelector<HTMLElement>('#app');
const arContainer = document.querySelector<HTMLElement>('#ar-container');

if (root === null || arContainer === null) {
  throw new Error('El HTML no contiene #app o #ar-container');
}

let view: ArView;
let gesturesAttached = false;

const { startArExperience, transformPlacement, playModelSound, interaction } = buildContainer({
  container: arContainer,
  imageTargetSrc: TARGET_SRC,
  targetAspect: TARGET_ASPECT,
  onSessionChange: (session) => view?.render(session),
});

view = new ArView(root, {
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
