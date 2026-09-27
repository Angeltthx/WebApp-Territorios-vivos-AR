import { buildContainer } from '@infrastructure/di/container';
import { ArView } from '@ui/ArView';
import { chooseLongSideFov } from '@infrastructure/mindar/CameraModel';

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
 * El campo de visión de la cámara (ver CameraModel). En un teléfono, 66°
 * sobre el lado largo; `?fov=70` lo cambia desde la barra de direcciones,
 * para afinarlo con el póster delante sin recompilar ni desplegar. Si los
 * animales "flotan" hacia fuera de su dibujo al inclinar el teléfono, se
 * prueba a subirlo o bajarlo de 3 en 3.
 */
function cameraFov(): number | null {
  const raw = new URLSearchParams(window.location.search).get('fov');
  const requested = raw === null ? null : Number(raw);
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  return chooseLongSideFov(requested, touch);
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
  tapModel,
  closeFocus,
  openMapText,
  discoverModel,
  tutorial,
  narration,
  mapTexts,
  interaction,
  audio,
} = buildContainer({
  container: arContainer,
  imageTargetSrc: TARGET_SRC,
  targetAspect: TARGET_ASPECT,
  cameraFov: cameraFov(),
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

  onToggleNarration: () => narration.toggleNarration(),

  // El volumen del menú. No necesita gesto: solo mueve una ganancia, y si el
  // audio aún no arrancó, se guarda para cuando lo haga.
  onVolumeChange: (level) => audio.setVolume(level),

  onStart: async () => {
    const session = await startArExperience.execute('whale');

    // Si el arranque falló, MindAR nunca creó el canvas y enganchar los
    // gestos lanzaría una excepción. Solo se conectan si hay sesión viva.
    if (!session.hasStarted) return;
    // También repone el catálogo si la precarga inicial falló y se reintentó.
    view.setCatalog((await startArExperience.prepare('whale')).catalog);

    // La camara ya da imagen: se puede retirar la portada. Hasta aqui
    // seguia puesta a proposito, con su cartel, para que el arranque no
    // fuera una pantalla negra (ver el manejador del boton en ArView).
    view.cameraReady();

    if (gesturesAttached) return;
    gesturesAttached = true;

    interaction.attach({
      onTapModel: (modelId) => void tapModel.execute(modelId),
      onDoubleTapModel: (modelId) => discoverModel.execute(modelId),
      onTapText: (textId) => void openMapText.execute(textId),
      onRotate: (modelId, yaw, pitch) => transformPlacement.rotateBy(modelId, yaw, pitch),
    });
  },
});

// El tutorial: el cartel sigue al mismo reloj que la mano del mapa.
tutorial.onChange((state) => view.setTutorial(state));

// El botón de la narración sigue a lo que suena: se detiene solo al acabar.
narration.onNarrationChange((state) => view.setNarration(state));

// Los textos del mapa para componerlos en grande al tocarlos.
view.setMapTexts(mapTexts);
view.render(startArExperience.current);

// Libera cámara y audio si el usuario cambia de pestaña o cierra.
window.addEventListener('pagehide', () => {
  if (gesturesAttached) {
    interaction.detach();
    gesturesAttached = false;
  }
  void startArExperience.stop();
});

// Al volver desde bfcache el JS sigue vivo, pero la cámara ya se liberó.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
