import { Box3, type BufferGeometry, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import type { IconPose, IconView } from '@domain/value-objects/IconPose';

/**
 * Calca la silueta de un icono como un POLÍGONO CERRADO.
 *
 * Sustituye al método anterior, que medía el radio máximo del modelo en cada
 * sector angular alrededor de su centro. Aquel truco es barato y funciona
 * con bichos redondos, pero tiene dos defectos que en la ballena se ven a
 * la primera:
 *
 *  - Un polígono en estrella NO PUEDE VOLVER HACIA DENTRO, así que la
 *    cintura entre el cuerpo y la cola desaparece y el animal sale como una
 *    mancha convexa.
 *  - Los sectores son iguales en ÁNGULO, no en recorrido. En una forma tan
 *    alargada como una ballena casi todos caen en los costados, y a la
 *    punta del morro y a la cola les toca uno o dos: justo los rasgos por
 *    los que se reconoce el animal se quedan sin resolución.
 *
 * Lo que se hace aquí es lo que haría cualquiera con papel de calco:
 *
 *  1. Se aplasta el modelo contra el papel (`projectForOutline`) y se
 *     RASTERIZAN sus triángulos en un retículo de ocupación. Triángulos, no
 *     vértices: una nube de vértices deja agujeros por todas partes y el
 *     contorno no sabría por dónde pasar.
 *  2. Se ENGORDA la mancha unas celdas (`grow`). Eso hace dos cosas a la
 *     vez: separa el trazo del animal, y cierra los huecos finos —entre las
 *     patas, entre las aletas— que convertirían el contorno en un zigzag.
 *  3. Se rellenan los huecos que hayan quedado encerrados (`fillPockets`),
 *     para que el trazo siga el borde EXTERIOR y no se meta por dentro.
 *  4. Se recorre ese borde (`traceBoundary`, vecindad de Moore), se
 *     remuestrea a pasos iguales y se suaviza.
 *
 * El resultado es un anillo de puntos en el espacio del icono, listo para
 * pintarlo a trazos. Sigue siendo una aproximación —un contorno exterior,
 * sin los huecos internos del dibujo—, pero respeta cinturas, salientes y
 * proporciones, que es de lo que vive el reconocimiento.
 */

/** Celdas del retículo sobre el lado mayor de la silueta. */
const GRID = 120;

/**
 * Cuánto se separa el trazo del animal, como fracción de su lado mayor.
 *
 * Relativo y no absoluto a propósito: en unidades de icono la ballena mide
 * más del doble que el cangrejo (el `iconSize` del catálogo va dentro), así
 * que una holgura fija se comería al pequeño y no se vería en la grande.
 */
const OFFSET_RATIO = 0.035;

/** Pasadas de suavizado. Quitan el diente de sierra del retículo. */
const SMOOTHING = 1;

/** Círculo de respaldo si el icono no tiene geometría legible. */
const FALLBACK_RADIUS = 0.06;

export interface SilhouettePoint {
  readonly x: number;
  readonly y: number;
}

interface Bounds {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}

interface Occupancy {
  readonly cells: Uint8Array;
  readonly nx: number;
  readonly ny: number;
  readonly minX: number;
  readonly minY: number;
  readonly cell: number;
  /** Radio del engorde, en celdas. */
  readonly radius: number;
}

/** Aplasta un vértice y le aplica el giro y el espejo del catálogo. */
type Flattener = (vertex: Vector3) => SilhouettePoint;

/**
 * El contorno de `icon` visto como lo pide `pose`, con `points` vértices.
 *
 * Se mide en el espacio PROPIO del icono, con su escala y su giro puestos a
 * cero: lo que se busca es la forma del bicho, no cómo está colocado ahora
 * mismo sobre el mapa. La escala del catálogo (`iconSize`) sí cuenta,
 * porque IconLoader la deja en un nodo interior.
 */
export function traceIconSilhouette(
  icon: Object3D,
  pose: IconPose,
  points: number,
): SilhouettePoint[] {
  const scale = icon.scale.clone();
  const rotation = icon.rotation.clone();
  icon.scale.setScalar(1);
  icon.rotation.set(0, 0, 0);
  icon.updateMatrixWorld(true);

  const loop = trace(icon, pose, points);

  icon.scale.copy(scale);
  icon.rotation.copy(rotation);
  icon.updateMatrixWorld(true);

  return loop;
}

function trace(icon: Object3D, pose: IconPose, points: number): SilhouettePoint[] {
  const toIconSpace = new Matrix4().copy(icon.matrixWorld).invert();
  const flatten = flattenerFor(pose);

  const bounds = projectedBounds(icon, toIconSpace, flatten);
  if (bounds === null) return circleLoop(FALLBACK_RADIUS, points);

  const grid = makeGrid(bounds);
  if (grid === null) return circleLoop(FALLBACK_RADIUS, points);

  rasterize(grid, icon, toIconSpace, flatten);
  grow(grid);
  fillPockets(grid);

  const boundary = traceBoundary(grid);
  if (boundary.length < 8) return circleLoop(FALLBACK_RADIUS, points);

  return smoothLoop(resampleLoop(boundary, points), SMOOTHING);
}

/**
 * Aplasta un vértice contra el papel según desde dónde se mire al animal.
 *
 *  - `front` de frente: se ve su ancho y su alto.
 *  - `top`   desde arriba: se ve su ancho y su LARGO, que es como está
 *            dibujado en el mapa un animal visto en planta —la tortuga
 *            nadando, el cangrejo en la arena.
 *  - `side`  de perfil: se ve su largo y su alto, como la pava y la
 *            ballena del dibujo.
 */
function projectForOutline(vertex: Vector3, view: IconView): SilhouettePoint {
  if (view === 'top') return { x: vertex.x, y: -vertex.z };
  if (view === 'side') return { x: -vertex.z, y: vertex.y };
  return { x: vertex.x, y: vertex.y };
}

/**
 * El aplastador completo: proyección, espejo y giro.
 *
 * El espejo hace falta porque el perfil de un modelo tiene dos lados y el
 * dibujo del mapa eligió uno: la pava mira a la izquierda —el lado que da
 * la proyección— y la ballena a la derecha. Girar 180° no sirve, porque eso
 * la dejaría además panza arriba.
 *
 * Devuelve siempre el MISMO objeto: esto se llama una vez por vértice de
 * cada modelo, y crear cien mil objetos de dos números para tirarlos acto
 * seguido se nota en el arranque.
 */
function flattenerFor(pose: IconPose): Flattener {
  const cos = Math.cos(pose.outlineSpin);
  const sin = Math.sin(pose.outlineSpin);
  const mirror = pose.outlineMirror ? -1 : 1;
  const out = { x: 0, y: 0 };

  return (vertex) => {
    const flat = projectForOutline(vertex, pose.outlineView);
    const x = flat.x * mirror;
    out.x = x * cos - flat.y * sin;
    out.y = x * sin + flat.y * cos;
    return out;
  };
}

/**
 * Los límites de la silueta, para saber qué retículo hace falta.
 *
 * Se saca de las CAJAS de cada malla, no de sus vértices: ocho esquinas por
 * malla en vez de decenas de miles, y para dimensionar el retículo sobra
 * —la caja de una malla girada da un poco de más, y de más solo significa
 * unas celdas vacías de propina.
 */
function projectedBounds(
  icon: Object3D,
  toIconSpace: Matrix4,
  flatten: Flattener,
): Bounds | null {
  const bounds: Bounds = {
    minU: Infinity,
    minV: Infinity,
    maxU: -Infinity,
    maxV: -Infinity,
  };
  const corner = new Vector3();
  let seen = false;

  icon.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const box = localBox(object.geometry);
    if (box === null) return;

    for (let i = 0; i < 8; i += 1) {
      corner.set(
        (i & 1) === 0 ? box.min.x : box.max.x,
        (i & 2) === 0 ? box.min.y : box.max.y,
        (i & 4) === 0 ? box.min.z : box.max.z,
      );
      corner.applyMatrix4(object.matrixWorld).applyMatrix4(toIconSpace);
      const flat = flatten(corner);
      bounds.minU = Math.min(bounds.minU, flat.x);
      bounds.minV = Math.min(bounds.minV, flat.y);
      bounds.maxU = Math.max(bounds.maxU, flat.x);
      bounds.maxV = Math.max(bounds.maxV, flat.y);
      seen = true;
    }
  });

  return seen ? bounds : null;
}

function localBox(geometry: BufferGeometry): Box3 | null {
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  return box === null || box.isEmpty() ? null : box;
}

function makeGrid(bounds: Bounds): Occupancy | null {
  const width = bounds.maxU - bounds.minU;
  const height = bounds.maxV - bounds.minV;
  const size = Math.max(width, height);
  if (!Number.isFinite(size) || size <= 0) return null;

  const cell = size / GRID;
  const radius = Math.max(1, Math.round((size * OFFSET_RATIO) / cell));
  // Dos celdas de margen ADEMÁS del engorde: el recorrido del borde da por
  // hecho que la primera y la última fila del retículo están vacías.
  const pad = (radius + 2) * cell;

  const nx = Math.ceil((width + 2 * pad) / cell) + 1;
  const ny = Math.ceil((height + 2 * pad) / cell) + 1;

  return {
    cells: new Uint8Array(nx * ny),
    nx,
    ny,
    minX: bounds.minU - pad,
    minY: bounds.minV - pad,
    cell,
    radius,
  };
}

/** Marca en el retículo cada triángulo del modelo, ya aplastado. */
function rasterize(
  grid: Occupancy,
  icon: Object3D,
  toIconSpace: Matrix4,
  flatten: Flattener,
): void {
  const vertex = new Vector3();
  const corners = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  icon.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (position === undefined) return;

    const index = object.geometry.getIndex();
    const count = index === null ? position.count : index.count;

    for (let i = 0; i + 2 < count; i += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        const at = index === null ? i + corner : index.getX(i + corner);
        vertex
          .fromBufferAttribute(position, at)
          .applyMatrix4(object.matrixWorld)
          .applyMatrix4(toIconSpace);
        const flat = flatten(vertex);
        corners[corner]!.x = (flat.x - grid.minX) / grid.cell;
        corners[corner]!.y = (flat.y - grid.minY) / grid.cell;
      }
      fillTriangle(grid, corners[0]!, corners[1]!, corners[2]!);
    }
  });
}

/**
 * Un triángulo, en coordenadas de celda.
 *
 * Se marcan SIEMPRE las tres esquinas antes de rellenar. Un triángulo más
 * fino que una celda —los hay a miles en un modelo de 60.000— no contiene
 * ningún centro de celda y se perdería entero; marcando sus esquinas, la
 * mancha nunca queda con agujeros de aguja.
 */
function fillTriangle(
  grid: Occupancy,
  a: SilhouettePoint,
  b: SilhouettePoint,
  c: SilhouettePoint,
): void {
  mark(grid, Math.floor(a.x), Math.floor(a.y));
  mark(grid, Math.floor(b.x), Math.floor(b.y));
  mark(grid, Math.floor(c.x), Math.floor(c.y));

  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-9) return;

  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(grid.nx - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(grid.ny - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  const sign = area > 0 ? 1 : -1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y)) * sign;
      const w1 = ((c.x - b.x) * (py - b.y) - (px - b.x) * (c.y - b.y)) * sign;
      const w2 = ((a.x - c.x) * (py - c.y) - (px - c.x) * (a.y - c.y)) * sign;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) grid.cells[y * grid.nx + x] = 1;
    }
  }
}

function mark(grid: Occupancy, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= grid.nx || y >= grid.ny) return;
  grid.cells[y * grid.nx + x] = 1;
}

/** Engorda la mancha con un disco de `radius` celdas. */
function grow(grid: Occupancy): void {
  const { cells, nx, ny, radius } = grid;
  const source = cells.slice();
  const limit = radius * radius;

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      if (source[y * nx + x] !== 1) continue;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ty = y + dy;
        if (ty < 0 || ty >= ny) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > limit) continue;
          const tx = x + dx;
          if (tx < 0 || tx >= nx) continue;
          cells[ty * nx + tx] = 1;
        }
      }
    }
  }
}

/**
 * Rellena los huecos que hayan quedado encerrados dentro de la mancha.
 *
 * Se inunda el VACÍO desde el borde del retículo: lo que la inundación no
 * alcanza está dentro. Sin esto, el recorrido del borde podría meterse por
 * un agujero interno —el hueco entre dos aletas que el engorde acabó de
 * cerrar— y dibujar el contorno por dentro del animal.
 */
function fillPockets(grid: Occupancy): void {
  const { cells, nx, ny } = grid;
  const outside = new Uint8Array(cells.length);
  const queue: number[] = [];

  const visit = (at: number): void => {
    if (cells[at] === 1 || outside[at] === 1) return;
    outside[at] = 1;
    queue.push(at);
  };

  for (let x = 0; x < nx; x += 1) {
    visit(x);
    visit((ny - 1) * nx + x);
  }
  for (let y = 0; y < ny; y += 1) {
    visit(y * nx);
    visit(y * nx + nx - 1);
  }

  while (queue.length > 0) {
    const at = queue.pop()!;
    const x = at % nx;
    const y = (at - x) / nx;
    if (x > 0) visit(at - 1);
    if (x < nx - 1) visit(at + 1);
    if (y > 0) visit(at - nx);
    if (y < ny - 1) visit(at + nx);
  }

  for (let at = 0; at < cells.length; at += 1) {
    if (outside[at] !== 1) cells[at] = 1;
  }
}

/** Los ocho vecinos de una celda, en orden circular. */
const RING: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * Recorre el borde exterior de la mancha y devuelve sus celdas en orden.
 *
 * Vecindad de Moore: se arranca en la primera celda llena del barrido —que
 * por construcción tiene su vecina de la izquierda vacía— y se va girando
 * alrededor de la celda actual, desde donde se venía, hasta encontrar la
 * siguiente llena. Se acaba al volver al punto de partida.
 */
function traceBoundary(grid: Occupancy): SilhouettePoint[] {
  const { cells, nx, ny } = grid;

  let startX = -1;
  let startY = -1;
  for (let y = 0; y < ny && startY < 0; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      if (cells[y * nx + x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
  }
  if (startY < 0) return [];

  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < nx && y < ny && cells[y * nx + x] === 1;

  let fromX = startX - 1;
  let fromY = startY;
  let x = startX;
  let y = startY;

  const path: SilhouettePoint[] = [];
  const steps = nx * ny * 4;

  for (let step = 0; step < steps; step += 1) {
    path.push({
      x: grid.minX + (x + 0.5) * grid.cell,
      y: grid.minY + (y + 0.5) * grid.cell,
    });

    let at = RING.findIndex(([dx, dy]) => x + dx === fromX && y + dy === fromY);
    if (at < 0) at = 0;

    let moved = false;
    for (let turn = 1; turn <= RING.length; turn += 1) {
      const [dx, dy] = RING[(at + turn) % RING.length]!;
      if (!solid(x + dx, y + dy)) continue;

      const [bx, by] = RING[(at + turn - 1) % RING.length]!;
      fromX = x + bx;
      fromY = y + by;
      x += dx;
      y += dy;
      moved = true;
      break;
    }

    if (!moved) break;
    if (x === startX && y === startY) break;
  }

  return path;
}

/**
 * Prepara un contorno que NO se deduce del modelo, sino que viene medido
 * sobre el dibujo del mapa: lo reparte a pasos iguales y lo suaviza una vez.
 *
 * Existe porque hay poses que ninguna proyección rígida del .glb reproduce
 * —la ballena del mapa bucea con la cola alzada y la aleta extendida— y en
 * esos casos el contorno se calca del DIBUJO. Que pase por el mismo
 * remuestreo que el calcado del modelo es lo que hace que los trazos se vean
 * igual de repartidos en los cuatro animales.
 */
export function prepareOutline(
  loop: readonly SilhouettePoint[],
  points: number,
): SilhouettePoint[] {
  if (loop.length < 3) return circleLoop(FALLBACK_RADIUS, points);
  return smoothLoop(resampleLoop(loop, points), 1);
}

/**
 * Separa el trazo del borde, empujando cada punto por su NORMAL.
 *
 * Por la normal y no desde el centro: en una forma alargada, empujar desde
 * el centro estira las puntas mucho más que los costados y el contorno sale
 * deformado. El sentido de giro del anillo decide cuál de las dos normales
 * apunta hacia fuera.
 */
export function offsetOutline(
  loop: readonly SilhouettePoint[],
  distance: number,
): SilhouettePoint[] {
  const n = loop.length;
  if (n < 3) return loop.slice();

  let twiceArea = 0;
  for (let i = 0; i < n; i += 1) {
    const from = loop[i]!;
    const to = loop[(i + 1) % n]!;
    twiceArea += from.x * to.y - to.x * from.y;
  }
  const sign = twiceArea >= 0 ? 1 : -1;

  return loop.map((point, i) => {
    const before = loop[(i - 1 + n) % n]!;
    const after = loop[(i + 1) % n]!;
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const length = Math.hypot(tx, ty);
    if (length === 0) return point;
    return {
      x: point.x + ((ty / length) * sign * distance),
      y: point.y - ((tx / length) * sign * distance),
    };
  });
}

/** Vuelve a repartir los puntos del anillo a pasos iguales de recorrido. */
function resampleLoop(loop: readonly SilhouettePoint[], count: number): SilhouettePoint[] {
  const n = loop.length;
  const upTo: number[] = [];
  let total = 0;

  for (let i = 0; i < n; i += 1) {
    const from = loop[i]!;
    const to = loop[(i + 1) % n]!;
    total += Math.hypot(to.x - from.x, to.y - from.y);
    upTo.push(total);
  }
  if (total <= 0) return loop.slice(0, count);

  const out: SilhouettePoint[] = [];
  let segment = 0;

  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * total;
    while (segment < n - 1 && upTo[segment]! < target) segment += 1;
    const before = segment === 0 ? 0 : upTo[segment - 1]!;
    const span = upTo[segment]! - before;
    const t = span > 0 ? (target - before) / span : 0;
    const from = loop[segment]!;
    const to = loop[(segment + 1) % n]!;
    out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }

  return out;
}

/** Media 1-2-1 sobre el anillo, varias veces. Lima el diente de sierra. */
function smoothLoop(loop: SilhouettePoint[], passes: number): SilhouettePoint[] {
  const n = loop.length;
  let current = loop;

  for (let pass = 0; pass < passes; pass += 1) {
    const next: SilhouettePoint[] = [];
    for (let i = 0; i < n; i += 1) {
      const before = current[(i - 1 + n) % n]!;
      const point = current[i]!;
      const after = current[(i + 1) % n]!;
      next.push({
        x: (before.x + point.x * 2 + after.x) / 4,
        y: (before.y + point.y * 2 + after.y) / 4,
      });
    }
    current = next;
  }

  return current;
}

/** Respaldo para un icono sin geometría: el disco gris de IconLoader. */
function circleLoop(radius: number, count: number): SilhouettePoint[] {
  const out: SilhouettePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    out.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return out;
}
