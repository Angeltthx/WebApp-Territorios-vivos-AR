import type { ArSession } from '@domain/entities/ArSession';
import type { Placement } from '@domain/entities/Placement';
import { ModelId } from '@domain/value-objects/ModelId';
import type { ScenePort } from '../ports/ScenePort';
import type { SessionListener } from './StartArExperience';

/**
 * Girar UN animal en su sitio: de lado y hacia arriba o abajo. La regla
 * (normalización del ángulo, tope de la inclinación) vive en el dominio;
 * este caso de uso solo coordina dominio y escena. Escalar a mano se quitó:
 * cada animal tiene su tamaño fijo en el catálogo.
 */
export class TransformPlacement {
  constructor(
    private readonly scene: ScenePort,
    private readonly getSession: () => ArSession,
    private readonly onSessionChange: SessionListener,
  ) {}

  rotateBy(modelId: string, yawRadians: number, pitchRadians = 0): void {
    const id = ModelId.of(modelId);
    this.apply((placement) => placement.rotatedBy(id, yawRadians, pitchRadians));
  }

  private apply(transform: (placement: Placement) => Placement): void {
    const session = this.getSession();
    const current = session.placement;
    if (current === null) return;

    const updated = transform(current);
    this.scene.applyPlacement(updated);
    this.onSessionChange(session.withPlacement(updated));
  }
}
