import type { ArSession } from '@domain/entities/ArSession';
import type { Placement } from '@domain/entities/Placement';
import type { ScenePort } from '../ports/ScenePort';
import type { SessionListener } from './StartArExperience';

/**
 * Rotar los animales en su sitio. La regla (normalización del ángulo) vive
 * en el dominio; este caso de uso solo coordina dominio y escena. Escalar
 * a mano se quitó: cada animal tiene su tamaño fijo en el catálogo.
 */
export class TransformPlacement {
  constructor(
    private readonly scene: ScenePort,
    private readonly getSession: () => ArSession,
    private readonly onSessionChange: SessionListener,
  ) {}

  rotateBy(radians: number): void {
    this.apply((placement) => placement.rotatedBy(radians));
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
