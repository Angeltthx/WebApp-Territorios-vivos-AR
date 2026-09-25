import {
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from 'three';
import type { PrimitiveShape } from '@domain/value-objects/ModelSource';

/**
 * Iconos generados por código, sin archivos externos.
 *
 * CONVENCIÓN: todos se construyen con +Y hacia ARRIBA y apoyados
 * alrededor del origen. Quien los monta (ThreeSceneAdapter) gira el grupo
 * contenedor para que ese +Y local apunte hacia fuera del mapa. Así estas
 * geometrías se escriben con la orientación natural de Three.js y no hay
 * que pensar en el sistema de coordenadas de MindAR aquí.
 *
 * El tamaño está en unidades del marcador, donde el ANCHO DEL MAPA = 1.
 * Un icono ocupa ~0.16, es decir un 16% del ancho del mapa: se ve sin
 * tapar la ilustración que hay debajo.
 */
export function createPrimitive(shape: PrimitiveShape, colorHex: number): Object3D {
  switch (shape) {
    case 'whale':
      return buildWhale(colorHex);
    case 'bird':
      return buildBird(colorHex);
    case 'crab':
      return buildCrab(colorHex);
    case 'turtle':
      return buildTurtle(colorHex);
  }
}

function skin(colorHex: number, roughness = 0.62, metalness = 0.05): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: colorHex, roughness, metalness });
}

/** Esfera deformada: la base de casi todos los cuerpos de animal. */
function blob(
  radius: number,
  scale: readonly [number, number, number],
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 24, 18), material);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}

/** Ballena jorobada: cuerpo alargado, aleta dorsal y cola bífida. */
function buildWhale(colorHex: number): Object3D {
  const group = new Group();
  const body = skin(colorHex);
  const belly = skin(0xd8e6ef, 0.75);

  group.add(blob(0.075, [1.5, 0.72, 0.85], body));

  // Vientre claro, ligeramente por debajo y por delante.
  const under = blob(0.06, [1.5, 0.42, 0.72], belly);
  under.position.set(0.012, -0.026, 0);
  group.add(under);

  const dorsal = new Mesh(new ConeGeometry(0.022, 0.05, 12), body);
  dorsal.position.set(-0.022, 0.06, 0);
  dorsal.rotation.z = -0.35;
  group.add(dorsal);

  // Cola: dos lóbulos abiertos en V al final del cuerpo.
  for (const side of [-1, 1]) {
    const fluke = new Mesh(new ConeGeometry(0.026, 0.062, 10), body);
    fluke.scale.z = 0.35;
    fluke.position.set(-0.115, 0.012, side * 0.026);
    fluke.rotation.set(side * 0.5, 0, 1.5);
    group.add(fluke);
  }

  // Aletas pectorales, largas y blancas: el rasgo que identifica a la jorobada.
  for (const side of [-1, 1]) {
    const flipper = new Mesh(new ConeGeometry(0.018, 0.08, 8), belly);
    flipper.scale.z = 0.3;
    flipper.position.set(0.02, -0.02, side * 0.05);
    flipper.rotation.set(0, 0, side * 0.9);
    group.add(flipper);
  }

  return group;
}

/** Pava: cuerpo robusto, cuello erguido y cola larga hacia atrás. */
function buildBird(colorHex: number): Object3D {
  const group = new Group();
  const feather = skin(colorHex, 0.78);
  const throat = skin(0xc0392b, 0.6);
  const beak = skin(0x2b2b2b, 0.45);

  group.add(blob(0.062, [1.25, 0.95, 0.9], feather));

  const neck = blob(0.03, [0.8, 1.5, 0.8], feather);
  neck.position.set(0.036, 0.062, 0);
  neck.rotation.z = -0.3;
  group.add(neck);

  const head = blob(0.03, [1, 0.92, 0.95], feather);
  head.position.set(0.056, 0.104, 0);
  group.add(head);

  // Papada roja: la marca de la pava del Baudó.
  const wattle = blob(0.014, [0.9, 1.3, 0.9], throat);
  wattle.position.set(0.06, 0.076, 0);
  group.add(wattle);

  const bill = new Mesh(new ConeGeometry(0.012, 0.034, 10), beak);
  bill.position.set(0.086, 0.104, 0);
  bill.rotation.z = -Math.PI / 2;
  group.add(bill);

  const tail = new Mesh(new ConeGeometry(0.032, 0.085, 10), feather);
  tail.scale.z = 0.45;
  tail.position.set(-0.078, 0.022, 0);
  tail.rotation.z = 1.9;
  group.add(tail);

  return group;
}

/** Cangrejo: caparazón aplanado, pinzas al frente y patas a los lados. */
function buildCrab(colorHex: number): Object3D {
  const group = new Group();
  const shell = skin(colorHex, 0.5, 0.12);
  const eye = skin(0x1b1b1b, 0.3);

  group.add(blob(0.07, [1.15, 0.5, 0.95], shell));

  for (const side of [-1, 1]) {
    // Pinza: brazo + tenaza.
    const arm = blob(0.017, [1.5, 0.7, 0.7], shell);
    arm.position.set(0.058, 0.006, side * 0.05);
    arm.rotation.y = side * -0.5;
    group.add(arm);

    const claw = blob(0.026, [1.1, 0.75, 0.6], shell);
    claw.position.set(0.094, 0.01, side * 0.072);
    claw.rotation.y = side * -0.5;
    group.add(claw);

    // Ojos pedunculados sobre el caparazón.
    const stalk = blob(0.008, [0.7, 1.6, 0.7], shell);
    stalk.position.set(0.03, 0.036, side * 0.022);
    group.add(stalk);

    const pupil = blob(0.009, [1, 1, 1], eye);
    pupil.position.set(0.03, 0.05, side * 0.022);
    group.add(pupil);

    // Cuatro patas por costado, abiertas en abanico.
    for (let i = 0; i < 4; i++) {
      const leg = blob(0.011, [1.9, 0.5, 0.5], shell);
      leg.position.set(0.022 - i * 0.028, -0.012, side * 0.062);
      leg.rotation.y = side * (0.7 + i * 0.22);
      group.add(leg);
    }
  }

  return group;
}

/** Tortuga golfina: caparazón abombado, cabeza y cuatro aletas. */
function buildTurtle(colorHex: number): Object3D {
  const group = new Group();
  const shell = skin(colorHex, 0.55);
  const hide = skin(0x9cb87a, 0.7);

  group.add(blob(0.08, [1.05, 0.52, 0.9], shell));

  // Plastrón: el vientre claro que cierra el caparazón por debajo.
  const plastron = blob(0.07, [1.05, 0.22, 0.9], hide);
  plastron.position.y = -0.014;
  group.add(plastron);

  const head = blob(0.026, [1.2, 0.85, 0.9], hide);
  head.position.set(0.086, 0.004, 0);
  group.add(head);

  // Aletas: las delanteras largas (propulsión), las traseras cortas (timón).
  for (const side of [-1, 1]) {
    const front = blob(0.019, [2.1, 0.35, 0.85], hide);
    front.position.set(0.042, -0.004, side * 0.064);
    front.rotation.y = side * -0.7;
    group.add(front);

    const back = blob(0.014, [1.5, 0.35, 0.85], hide);
    back.position.set(-0.058, -0.006, side * 0.052);
    back.rotation.y = side * 0.8;
    group.add(back);
  }

  return group;
}
