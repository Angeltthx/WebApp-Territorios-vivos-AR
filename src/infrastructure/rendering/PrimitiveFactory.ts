import {
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
} from 'three';
import type { PrimitiveShape } from '@domain/value-objects/ModelSource';

/**
 * Geometrías generadas por código, sin archivos externos.
 *
 * Esto permite desplegar y probar la app completa antes de tener assets.
 * Cuando tengas tus .glb, cambia el ModelSource en el repositorio y este
 * archivo deja de usarse — no hay que tocar nada más.
 */
export function createPrimitive(shape: PrimitiveShape, colorHex: number): Object3D {
  switch (shape) {
    case 'torus-knot':
      return buildTorusKnot(colorHex);
    case 'crystal':
      return buildCrystal(colorHex);
    case 'headphones':
      return buildHeadphones(colorHex);
  }
}

function buildTorusKnot(colorHex: number): Object3D {
  return new Mesh(
    new TorusKnotGeometry(0.28, 0.09, 160, 32),
    new MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.45 }),
  );
}

function buildCrystal(colorHex: number): Object3D {
  const group = new Group();

  const core = new Mesh(
    new IcosahedronGeometry(0.3, 0),
    new MeshStandardMaterial({
      color: colorHex,
      roughness: 0.1,
      metalness: 0.2,
      flatShading: true,
    }),
  );

  const halo = new Mesh(
    new SphereGeometry(0.42, 32, 24),
    new MeshStandardMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.14,
      roughness: 1,
    }),
  );

  group.add(core, halo);
  return group;
}

/** Guiño al ejemplo original: banda oscura y almohadillas de color. */
function buildHeadphones(colorHex: number): Object3D {
  const group = new Group();

  const bandMaterial = new MeshStandardMaterial({
    color: 0x1c1c1e,
    roughness: 0.55,
    metalness: 0.15,
  });
  const cushionMaterial = new MeshStandardMaterial({
    color: colorHex,
    roughness: 0.85,
    metalness: 0,
  });

  const band = new Mesh(new TorusGeometry(0.34, 0.032, 20, 64, Math.PI), bandMaterial);
  group.add(band);

  for (const side of [-1, 1]) {
    const shell = new Mesh(new CylinderGeometry(0.13, 0.13, 0.07, 32), bandMaterial);
    shell.rotation.z = Math.PI / 2;
    shell.position.set(side * 0.34, 0, 0);

    const cushion = new Mesh(new CylinderGeometry(0.1, 0.1, 0.075, 32), cushionMaterial);
    cushion.rotation.z = Math.PI / 2;
    cushion.position.set(side * 0.3, 0, 0);

    group.add(shell, cushion);
  }

  return group;
}
