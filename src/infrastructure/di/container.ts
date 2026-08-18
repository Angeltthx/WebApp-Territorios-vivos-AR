import { PlayModelSound } from '@application/use-cases/PlayModelSound';
import { StartArExperience } from '@application/use-cases/StartArExperience';
import { SwitchModel } from '@application/use-cases/SwitchModel';
import { TransformPlacement } from '@application/use-cases/TransformPlacement';
import type { ArSession } from '@domain/entities/ArSession';
import { ConsoleAnalyticsAdapter } from '../analytics/ConsoleAnalyticsAdapter';
import { WebAudioAdapter } from '../audio/WebAudioAdapter';
import { PointerInteractionAdapter } from '../interaction/PointerInteractionAdapter';
import { MindArRuntime } from '../mindar/MindArRuntime';
import { DEMO_CATALOG, StaticModelRepository } from '../repositories/StaticModelRepository';
import { ThreeSceneAdapter } from '../rendering/ThreeSceneAdapter';
import { MindArTrackingAdapter } from '../tracking/MindArTrackingAdapter';

export interface ContainerConfig {
  container: HTMLElement;
  imageTargetSrc: string;
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
  const scene = new ThreeSceneAdapter(runtime);
  // ↑↑↑

  const audio = new WebAudioAdapter();
  const analytics = new ConsoleAnalyticsAdapter();
  const interaction = new PointerInteractionAdapter(runtime, scene);
  const models = new StaticModelRepository(DEMO_CATALOG);

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

  const switchModel = new SwitchModel(scene, audio, models, analytics, getSession, (session) =>
    startArExperience.update(session),
  );

  const playModelSound = new PlayModelSound(audio, scene, models, analytics, getSession);

  return {
    startArExperience,
    transformPlacement,
    switchModel,
    playModelSound,
    interaction,
    catalog: DEMO_CATALOG,
  } as const;
}
