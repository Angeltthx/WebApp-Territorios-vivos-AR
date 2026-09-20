/**
 * Calca el contorno de un animal DIBUJADO en el mapa.
 *
 * Existe porque el contorno punteado que la app pinta antes de revelar un
 * animal tiene que parecerse al DIBUJO, y el dibujo no siempre se puede
 * deducir del .glb: la ballena del mapa bucea con la cola alzada y la aleta
 * extendida, una pose que ninguna proyección rígida del modelo reproduce.
 * Para esos casos, el contorno se mide aquí y se pega en `outlineShape` del
 * catálogo, en las MISMAS coordenadas normalizadas que `spot`.
 *
 * Cómo mide: cada animal está pintado con un color que el fondo no tiene
 * (la ballena es azul sobre mar crema, la pava marrón sobre hierba verde),
 * así que basta una regla de color por animal. Luego, columna a columna, se
 * anota dónde empieza y dónde acaba el animal, y se cierra el anillo por
 * arriba de ida y por abajo de vuelta.
 *
 * SIEMPRE hay que mirar el modo `ascii` antes de creerse el polígono: si la
 * regla de color se cuela en el fondo, el contorno sale enorme y en el mapa
 * ASCII se ve al instante.
 *
 * Uso:
 *   node scripts/trace-outline.mjs whale ascii
 *   node scripts/trace-outline.mjs whale poly 24
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imagePath = resolve(repoRoot, 'public/targets/map.jpg');

/**
 * Un animal del mapa: el recorte donde buscarlo y qué color lo distingue.
 *
 * El recorte no es un detalle menor: es lo que impide que la regla de color
 * arrastre media ilustración. Los cuatro están bien separados en el mapa,
 * así que un rectángulo generoso alrededor de cada uno basta.
 */
const SUBJECTS = {
  whale: {
    box: { u0: 0.1, v0: 0.018, u1: 0.48, v1: 0.22 },
    // Sobre el mar la ballena tiene DOS tonos —el lomo azul marino y la
    // panza casi blanca—, y ninguna regla de "es azul" los junta sin
    // tragarse el mar. Lo que sí los junta es la distancia al color del
    // agua: los remolinos se quedan a menos de 60 de rgb(4,124,141) y todo
    // lo que es ballena se va mucho más lejos.
    //
    // El agua del mapa de 2026 es turquesa, no azul: quien copie esta regla
    // para otro mapa tiene que volver a medir ese rgb, no heredarlo.
    hit: (r, g, b) => (r - 4) ** 2 + (g - 124) ** 2 + (b - 141) ** 2 > 3600,
  },
  bird: {
    box: { u0: 0.82, v0: 0.45, u1: 0.98, v1: 0.558 },
    // Marrón oscuro y negro sobre selva verde. La hierba tiene el verde muy
    // por encima del rojo; la pava no.
    hit: (r, g, b) => (r + g + b) / 3 < 115 && r >= g - 5,
  },
  crab: {
    box: { u0: 0.555, v0: 0.35, u1: 0.7, v1: 0.432 },
    // Naranja sobre mar turquesa: el caso fácil del mapa. El recorte
    // empieza en 0.555 para dejar fuera la mariposa, que es igual de
    // naranja y está a un palmo.
    hit: (r, g, b) => r > b + 30 && r > g + 40,
  },
  turtle: {
    box: { u0: 0.2, v0: 0.49, u1: 0.45, v1: 0.578 },
    // Verde oliva sobre mar turquesa. Lo que la separa es que en la tortuga
    // el verde le gana al azul, y en el agua es al revés.
    hit: (r, g, b) => g > b + 15 && r > b - 10 && (r + g + b) / 3 < 205,
  },
};

const [name, mode = 'ascii', pointsArg] = process.argv.slice(2);
const subject = SUBJECTS[name];
if (subject === undefined) {
  console.error(`Animal desconocido: "${name}". Usa ${Object.keys(SUBJECTS).join(', ')}.`);
  process.exit(1);
}

const { width, height, data } = jpeg.decode(readFileSync(imagePath), { useTArray: true });

const x0 = Math.round(subject.box.u0 * width);
const x1 = Math.round(subject.box.u1 * width) - 1;
const y0 = Math.round(subject.box.v0 * height);
const y1 = Math.round(subject.box.v1 * height) - 1;

const boxWidth = x1 - x0 + 1;
const boxHeight = y1 - y0 + 1;

function matchesColour(x, y) {
  const at = (y * width + x) * 4;
  return subject.hit(data[at], data[at + 1], data[at + 2]);
}

/**
 * La MANCHA MÁS GRANDE que cumple la regla de color, y solo ella.
 *
 * Sin esto, el recorte tiene que ser quirúrgico: cualquier trozo de fondo
 * que se cuele —el verde de la costa junto a la tortuga, la rama bajo la
 * pava— entra en el contorno y lo estira hasta el absurdo. Quedándose con
 * la mancha mayor, el recorte solo tiene que ser razonable: el animal es lo
 * más grande de su color en su rincón del mapa.
 */
function largestBlob() {
  const raw = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      if (matchesColour(x0 + x, y0 + y)) raw[y * boxWidth + x] = 1;
    }
  }

  const seen = new Uint8Array(raw.length);
  let best = [];

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== 1 || seen[start] === 1) continue;

    const blob = [];
    const queue = [start];
    seen[start] = 1;

    while (queue.length > 0) {
      const at = queue.pop();
      blob.push(at);
      const x = at % boxWidth;
      const y = (at - x) / boxWidth;
      const push = (next) => {
        if (raw[next] !== 1 || seen[next] === 1) return;
        seen[next] = 1;
        queue.push(next);
      };
      if (x > 0) push(at - 1);
      if (x < boxWidth - 1) push(at + 1);
      if (y > 0) push(at - boxWidth);
      if (y < boxHeight - 1) push(at + boxWidth);
    }

    if (blob.length > best.length) best = blob;
  }

  const mask = new Uint8Array(raw.length);
  for (const at of best) mask[at] = 1;
  return mask;
}

const mask = largestBlob();

function inside(x, y) {
  return mask[(y - y0) * boxWidth + (x - x0)] === 1;
}

if (mode === 'ascii') {
  const stepX = Math.max(1, Math.round((x1 - x0) / 100));
  const stepY = stepX * 2;
  for (let y = y0; y <= y1; y += stepY) {
    let row = '';
    for (let x = x0; x <= x1; x += stepX) row += inside(x, y) ? '#' : '.';
    console.log(row);
  }
  console.log(`# ${name}: x ${x0}..${x1}, y ${y0}..${y1}`);
  process.exit(0);
}

// Cuántos puntos por lado. Con 24 sale un anillo de 48, que es del orden de
// los trazos que pinta MarkerPin: más puntos no añaden forma, solo ruido.
const columns = Number(pointsArg ?? 24);
const step = Math.max(1, Math.round((x1 - x0) / columns));

const top = [];
const bottom = [];

for (let x = x0; x <= x1; x += step) {
  let first = -1;
  let last = -1;
  let hits = 0;

  for (let y = y0; y <= y1; y += 1) {
    if (!inside(x, y)) continue;
    if (first < 0) first = y;
    last = y;
    hits += 1;
  }

  // Una columna con cuatro píxeles sueltos es ruido del fondo, no el animal.
  if (hits < 4) continue;
  top.push({ u: x / width, v: first / height });
  bottom.push({ u: x / width, v: last / height });
}

if (top.length < 3) {
  console.error(`La regla de color no encontró a ${name}. Mira el modo ascii.`);
  process.exit(1);
}

// Anillo cerrado: el borde de arriba de izquierda a derecha, el de abajo de
// vuelta. Para bichos anchos —lo son los cuatro— es un contorno fiel; lo
// único que no puede representar son los huecos, como el de entre las patas.
const loop = [...top, ...bottom.reverse()].map((point) => ({
  u: Number(point.u.toFixed(4)),
  v: Number(point.v.toFixed(4)),
}));

const rows = [];
for (let i = 0; i < loop.length; i += 4) {
  rows.push(
    '      ' +
      loop
        .slice(i, i + 4)
        .map((point) => `{ u: ${point.u}, v: ${point.v} },`)
        .join(' '),
  );
}
console.log(`    outlineShape: [\n${rows.join('\n')}\n    ],`);
console.log(`// ${name}: ${loop.length} puntos`);
