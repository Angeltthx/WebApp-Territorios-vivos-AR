import { AnimalSoundscape } from '@application/use-cases/AnimalSoundscape';
import { CloseFocus } from '@application/use-cases/CloseFocus';
import { DiscoverNearbyModel } from '@application/use-cases/DiscoverNearbyModel';
import { OpenMapText } from '@application/use-cases/OpenMapText';
import { TapModel } from '@application/use-cases/TapModel';
import { PlayGestureSound } from '@application/use-cases/PlayGestureSound';
import { StartArExperience } from '@application/use-cases/StartArExperience';
import { TransformPlacement } from '@application/use-cases/TransformPlacement';
import type { ArSession } from '@domain/entities/ArSession';
import { Proximity } from '@domain/value-objects/Proximity';
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
  /** A qué distancia sale cada animal. Se calibra con el mapa delante. */
  proximity: Proximity;
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
  const runtime = new MindArRuntime(config.container, config.imageTargetSrc);

  // ↓↓↓ Las dos líneas que cambiarías al migrar de motor de tracking ↓↓↓
  const tracking = new MindArTrackingAdapter(runtime);
  const mapTexts = new StaticMapTextRepository(NUQUI_MAP_TEXTS);
  const scene = new ThreeSceneAdapter(runtime, config.targetAspect, mapTexts.all);
  // ↑↑↑

  const audio = new WebAudioAdapter();
  const analytics = new ConsoleAnalyticsAdapter();
  const interaction = new PointerInteractionAdapter(runtime, scene);
  const models = new StaticModelRepository(NUQUI_CATALOG);

  const startArExperience = new StartArExperience(
    tracking,
    scene,
    audio,
    models,
    analytics,
    config.onSessionChange,
  );

  const getSession = () => startArExperience.current;

  const transformPlacement = new TransformPlacement(scene, getSession, (session) =>
    startArExperience.update(session),
  );

  const sounds = new AnimalSoundscape(audio, getSession);
  const tapModel = new TapModel(scene, models, analytics, getSession);

  // Los animales no se regalan por apuntar al mapa: hay que acercarse. La
  // medida la hace el adaptador de escena, que es el unico que sabe donde
  // esta la camara; que acercarse signifique DESCUBRIR —desbloquear para
  // siempre y abrir la ficha— lo decide el caso de uso.
  const emit = (session: ArSession) => startArExperience.update(session);
  const discoverNearbyModel = new DiscoverNearbyModel(scene, models, sounds, analytics, getSession, emit);
  // El primer plano bloquea a los demás animales; al cerrarlo, el que
  // estuviera cerca se descubre ahora (ver DiscoverNearbyModel).
  const closeFocus = new CloseFocus(scene, sounds, analytics, getSession, emit, (closed) =>
    discoverNearbyModel.resume(closed),
  );

  // Con los cuatro animales encontrados, los textos del mapa se leen en grande.
  const openMapText = new OpenMapText(scene, mapTexts, models, sounds, analytics, getSession, emit);

  scene.setProximity(config.proximity);
  scene.onNearbyModel((modelId) => discoverNearbyModel.execute(modelId));
  // Cada sonido de un gesto suena en su fotograma: el del toque cuando la
  // animación llega a él, el chapuzón cuando se ve el salpicón.
  const gestureSound = new PlayGestureSound(sounds, models);
  scene.onTapSound((modelId) => void gestureSound.tapped(modelId));
  scene.onSplash((modelId, strength) => void gestureSound.splashed(modelId, strength));

  return {
    startArExperience,
    transformPlacement,
    tapModel,
    closeFocus,
    openMapText,
    mapTexts: mapTexts.all,
    interaction,
    // Se expone para poder desbloquearlo en el PRIMER toque del usuario.
    // Al quitar el boton de inicio se perdio el gesto que lo desbloqueaba,
    // y sin un gesto real iOS deja el audio suspendido para siempre.
    audio,
  } as const;
}
