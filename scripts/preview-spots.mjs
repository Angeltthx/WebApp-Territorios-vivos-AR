/**
 * Dibuja una mira sobre el mapa en las coordenadas que le pases, para
 * comprobar a ojo que un MarkerSpot del catálogo cae sobre su animal.
 *
 * Las coordenadas van normalizadas 0–1 desde la esquina SUPERIOR
 * IZQUIERDA, igual que en NUQUI_CATALOG.
 *
 * Uso:
 *   node scripts/preview-spots.mjs '[{"u":0.262,"v":0.220}]' mira.jpg
 *   node scripts/preview-spots.mjs '[...]' mira.jpg otra-imagen.jpg
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [spotsArg, outputArg, imageArg] = process.argv.slice(2);
if (!spotsArg || !outputArg) {
  console.error('Uso: node scripts/preview-spots.mjs \'[{"u":0.26,"v":0.22}]\' <salida.jpg> [imagen.jpg]');
  process.exit(1);
}

// Por defecto, la misma imagen que se compila al .mind y que sirve la app.
const imagePath = resolve(repoRoot, imageArg ?? 'public/targets/map.jpg');
const spots = JSON.parse(spotsArg);

const { width, height, data } = jpeg.decode(readFileSync(imagePath), { useTArray: true });

const RING_RADII = [40, 41, 42, 43];
const CROSS_REACH = 55;
const MARK = [255, 0, 255]; // magenta: no aparece en el mapa, así que no se confunde

function paint(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  [data[offset], data[offset + 1], data[offset + 2]] = MARK;
}

for (const spot of spots) {
  const cx = Math.round(spot.u * width);
  const cy = Math.round(spot.v * height);

  for (let degrees = 0; degrees < 360; degrees += 0.25) {
    const radians = (degrees * Math.PI) / 180;
    for (const radius of RING_RADII) {
      paint(Math.round(cx + radius * Math.cos(radians)), Math.round(cy + radius * Math.sin(radians)));
    }
  }

  for (let d = -CROSS_REACH; d <= CROSS_REACH; d++) {
    for (const thickness of [-1, 0, 1]) {
      paint(cx + d, cy + thickness);
      paint(cx + thickness, cy + d);
    }
  }
}

const outputPath = resolve(outputArg);
writeFileSync(outputPath, jpeg.encode({ data, width, height }, 90).data);
console.log(`${spots.length} mira(s) sobre ${width}x${height} → ${outputPath}`);
