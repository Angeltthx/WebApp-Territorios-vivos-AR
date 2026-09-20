/**
 * Prepara el mapa que entrega la diseñadora para que sirva de target.
 *
 * Misma idea que `optimize-splash.mjs`: el archivo original no se toca ni se
 * sirve, y de él sale el que sí va a producción (`public/targets/map.jpg`,
 * la imagen que `compile-target.mjs` convierte en `.mind`).
 *
 * Hace tres cosas, y ninguna es cosmética:
 *
 * 1. RECORTA lo que no es el mapa. Las entregas llegan como captura del
 *    visor de PDF, con franjas blancas y una línea gris de sombra en dos
 *    bordes. Esa línea gris es contraste puro en el borde de la imagen: el
 *    compilador la lee como detalle del mapa y guarda descriptores de algo
 *    que el papel impreso no tiene.
 * 2. DEJA UN MARGEN BLANCO propio, el mismo por los cuatro lados. El mapa
 *    impreso lo tiene, así que la imagen compilada también debe tenerlo, o
 *    las coordenadas normalizadas del catálogo (`spot`, `outlineShape`) se
 *    desplazan respecto de lo que ve la cámara.
 * 3. REESCALA a `TARGET_WIDTH`. El ancho en píxeles es un parámetro de
 *    detección medido con `npm run bench-detection`, no una preferencia.
 *
 * Al terminar imprime la proporción: TARGET_ASPECT en `src/main.ts` y
 * `src/verify.ts` tiene que coincidir con ella.
 *
 * Uso:
 *   node scripts/prepare-target.mjs "Mapa para el fondo.jpeg"
 *   node scripts/prepare-target.mjs entrada.jpeg public/targets/map.jpg
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, process.argv[2] ?? 'Mapa para el fondo.jpeg');
const output = resolve(repoRoot, process.argv[3] ?? 'public/targets/map.jpg');

/**
 * Ancho de salida, en píxeles.
 *
 * Medido con `npm run bench-detection` sobre el mapa de 2026: 880 px dio
 * 8/12 fotogramas y 289 inliers, 1000 px dio 8/12 y 308, y 1200 px dio 7/12
 * y 305. Más grande no es mejor — pasado cierto punto el compilador guarda
 * detalle más fino del que la cámara resuelve a la distancia de lectura.
 */
const TARGET_WIDTH = 1000;

/**
 * Margen blanco alrededor del dibujo, en tanto por uno del ancho final.
 * 0.018 reproduce el que traía la entrega anterior (18 px sobre 1000).
 */
const MARGIN_RATIO = 0.018;

/** Un píxel cuenta como blanco de página si los tres canales pasan de esto. */
const WHITE_LEVEL = 240;

/**
 * Franja de los bordes donde vive la sombra del visor de PDF, en tanto por
 * uno. Se ignora al buscar el dibujo: esa línea gris no es blanca, así que
 * sin excluirla el recorte la daría por contenido y la conservaría.
 */
const VIEWER_EDGE = 0.005;

/** Caja del dibujo dentro de la imagen, ignorando blanco de página y sombra. */
function findArtBounds({ data, width, height, channels }) {
  const skipX = Math.ceil(width * VIEWER_EDGE);
  const skipY = Math.ceil(height * VIEWER_EDGE);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = skipY; y < height - skipY; y += 1) {
    for (let x = skipX; x < width - skipX; x += 1) {
      const i = (y * width + x) * channels;
      if (data[i] > WHITE_LEVEL && data[i + 1] > WHITE_LEVEL && data[i + 2] > WHITE_LEVEL) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) throw new Error(`No se encontró dibujo en ${source}`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

const image = sharp(source);
const { width: srcWidth, height: srcHeight } = await image.metadata();
if (srcWidth === undefined || srcHeight === undefined) {
  throw new Error(`No se pudo leer el tamaño de ${source}`);
}

const raw = await image.clone().raw().toBuffer({ resolveWithObject: true });
const art = findArtBounds({ ...raw.info, data: raw.data });

const margin = Math.round(TARGET_WIDTH * MARGIN_RATIO);
const artWidth = TARGET_WIDTH - margin * 2;
const artHeight = Math.round((art.height * artWidth) / art.width);

await mkdir(dirname(output), { recursive: true });
const written = await image
  .clone()
  .extract(art)
  .resize({ width: artWidth, height: artHeight, fit: 'fill' })
  .extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' })
  .jpeg({ quality: 92, progressive: false, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toFile(output);

console.log(`origen   ${srcWidth}x${srcHeight}`);
console.log(`dibujo   ${art.width}x${art.height} en (${art.left}, ${art.top})`);
console.log(`salida   ${written.width}x${written.height}  ${Math.round(written.size / 1024)} KB`);
console.log('');
console.log('Ahora: npm run compile-target, y TARGET_ASPECT en src/main.ts y src/verify.ts:');
console.log(`  const TARGET_ASPECT = ${written.height} / ${written.width};`);
