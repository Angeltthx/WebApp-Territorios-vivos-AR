import { AnimalSoundscape } from '@application/use-cases/AnimalSoundscape';
import { CloseFocus } from '@application/use-cases/CloseFocus';
import { DiscoverModel } from '@application/use-cases/DiscoverModel';
import { Tutorial } from '@application/use-cases/Tutorial';
import { OpenMapText } from '@application/use-cases/OpenMapText';
import { TapModel } from '@application/use-cases/TapModel';
import { PlayGestureSound } from '@application/use-cases/PlayGestureSound';
import { StartArExperience } from '@application/use-cases/StartArExperience';
import { TransformPlacement } from '@application/use-cases/TransformPlacement';
import type { ArSession } from '@domain/entities/ArSession';
import type { Language } from '@domain/value-objects/Language';
import { ConsoleAnalyticsAdapter } from '../analytics/ConsoleAnalyticsAdapter';
import { WebAudioAdapter } from '../audio/WebAudioAdapter';
import { PointerInteractionAdapter } from '../interaction/PointerInteractionAdapter';
import { MindArRuntime } from '../mindar/MindArRuntime';
import { NUQUI_CATALOG, StaticModelRepository } from '../repositories/StaticModelRepository';
import { NUQUI_MAP_TEXTS, StaticMapTextRepository } from '../repositories/StaticMapTextRepository';
import { ThreeSceneAdapter } from '../rendering/ThreeSceneAdapter';
import { MindArTrackingAdapter } from '../tracking/MindArTrackingAdapter';

export interface ContainerConfig {
  container: HTMLElement;
  imageTargetSrc: string;
  /** Alto/ancho de la imagen compilada en `imageTargetSrc`. */
  targetAspect: number;
  /**
   * Campo de visión de la cámara sobre el lado largo, en grados, o null para
   * el de MindAR. Sin él, los animales flotan fuera de su dibujo en un
   * teléfono (ver CameraModel).
   */
  cameraFov: number | null;
  /** El idioma en uso (lo decide la vista): qué narraciones se bajan primero. */
  language: () => Language;
  onSessionChange: (session: ArSession) => void;
}

/**
 * COMPOSITION ROOT: el ÚNICO lugar del proyecto donde se decide qué
 * implementación concreta se usa.
 *
 * Migrar de MindAR a Zappar, WebXR u 8th Wall es cambiar las dos líneas
 * marcadas abajo. Ni el dominio, ni los casos de uso, ni la UI se enteran.
 */
export function buildContainer(config: ContainerConfig) {
  const runtime = new MindArRuntime(config.container, config.imageTargetSrc, undefined, config.cameraFov);

  // ↓↓↓ Las dos líneas que cambiarías al migrar de motor de tracking ↓↓↓
  const tracking = new MindArTrackingAdapter(runtime);
  const mapTexts = new StaticMapTextRepository(NUQUI_MAP_TEXTS);
  const scene = new ThreeSceneAdapter(runtime, config.targetAspect, mapTexts.all);
  // ↑↑↑

  const audio = new WebAudioAdapter();
  const analytics = new ConsoleAnalyticsAdapter();
  const interaction = new PointerInteractionAdapter(runtime, scene);
  const models = new StaticModelRepository(NUQUI_CATALOG);

  // El tutorial: la mano sobre el mapa (escena) y el cartel (vista) siguen
  // el mismo reloj. Recorre los cinco animales y luego los textos.
  const tutorial = new Tutorial(
    NUQUI_CATALOG.map((entry) => entry.id),
    mapTexts.all.map((text) => text.id),
  );
  tutorial.onChange((state) => scene.setHint(state.hint));

  const startArExperience = new StartArExperience(
    tracking,
    scene,
    audio,
    models,
    analytics,
    // Cada cambio de sesión pasa también por el tutorial.
    (session) => {
      tutorial.update(session);
      config.onSessionChange(session);
    },
    config.language,
  );

  const getSession = () => startArExperience.current;

  const transformPlacement = new TransformPlacement(scene, getSession, (session) =>
    startArExperience.update(session),
  );

  const sounds = new AnimalSoundscape(audio, getSession);
  // Los animales se descubren TOCÁNDOLOS: sobre el mapa, un toque lo abre en
  // primer plano (DiscoverModel); ya en primer plano, un toque es su gesto
  // (TapModel). Antes se abrían al acercar el teléfono.
  const emit = (session: ArSession) => startArExperience.update(session);
  const discoverModel = new DiscoverModel(scene, models, sounds, analytics, getSession, emit);
  const tapModel = new TapModel(
    scene,
    models,
    analytics,
    getSession,
    (id) => discoverModel.execute(id),
    () => tutorial.focusedAnimalTapped(),
  );
  const closeFocus = new CloseFocus(scene, sounds, analytics, getSession, emit);

  // Con los cinco animales encontrados, los textos del mapa se leen en grande.
  const openMapText = new OpenMapText(scene, mapTexts, models, sounds, analytics, getSession, emit);

  // Cada sonido de un gesto suena en su fotograma: el del toque cuando la
  // animación llega a él, el chapuzón cuando se ve el salpicón.
  const gestureSound = new PlayGestureSound(sounds, models);
  scene.onTapSound((modelId) => void gestureSound.tapped(modelId));
  // En las pausas de la narración, el animal hace su gesto: el mismo que
  // al tocarlo, con su sonido en su momento.
  sounds.setPerformer((id) => scene.pulse(id));
  // Cuando la narración calla, el tutorial señala la ✕ (sin narración, al
  // tocar al animal).
  sounds.onNarrationChange(({ playing, available }) => tutorial.narrationChanged(playing, available));
  scene.onSplash((modelId, strength) => void gestureSound.splashed(modelId, strength));

  return {
    startArExperience,
    transformPlacement,
    tapModel,
    closeFocus,
    openMapText,
    tutorial,
    // El botón de la ficha: escuchar o detener la narración del animal.
    narration: sounds,
    mapTexts: mapTexts.all,
    interaction,
    // Se expone para poder desbloquearlo en el PRIMER toque del usuario.
    // Al quitar el boton de inicio se perdio el gesto que lo desbloqueaba,
    // y sin un gesto real iOS deja el audio suspendido para siempre.
    audio,
  } as const;
}
