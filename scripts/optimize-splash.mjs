/**
 * Prepara la pantalla inicial que entrega la diseñadora.
 *
 * Misma idea que `optimize-models.mjs`: el archivo original NO se toca ni se
 * sirve, y de él salen los que sí van a producción. Recomprimir sobre la
 * propia salida degrada la foto un poco más en cada pasada, así que la
 * fuente vive fuera de `public/`.
 *
 * Salen dos archivos porque el `<picture>` del HTML ofrece los dos: WebP,
 * que es la mitad de peso, y un JPEG por si algún navegador viejo se queda
 * sin él.
 *
 * Uso:
 *   npm run optimize-splash
 *   node scripts/optimize-splash.mjs "otra pantalla.jpeg"
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, process.argv[2] ?? 'Pantalla Inicial.jpeg');
const outDir = resolve(repoRoot, 'public/splash');

/**
 * Ancho máximo de salida.
 *
 * La pantalla se ve a pantalla completa en un móvil: 1440 px cubre un 3x de
 * los teléfonos grandes de sobra. Si la fuente es más pequeña NO se amplía
 * —inventar píxeles solo añade peso—, así que este número es un techo, no
 * un objetivo.
 */
const MAX_WIDTH = 1440;

await mkdir(outDir, { recursive: true });

const image = sharp(source);
const { width, height } = await image.metadata();
if (width === undefined || height === undefined) {
  throw new Error(`No se pudo leer el tamaño de ${source}`);
}

const targetWidth = Math.min(width, MAX_WIDTH);
const base = image.resize({ width: targetWidth, withoutEnlargement: true });

const webp = await base.clone().webp({ quality: 75, effort: 6 }).toFile(resolve(outDir, 'inicio.webp'));
const jpeg = await base
  .clone()
  .jpeg({ quality: 76, progressive: true, mozjpeg: true })
  .toFile(resolve(outDir, 'inicio.jpg'));

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

console.log(`origen   ${width}x${height}`);
console.log(`inicio.webp  ${webp.width}x${webp.height}  ${kb(webp.size)}`);
console.log(`inicio.jpg   ${jpeg.width}x${jpeg.height}  ${kb(jpeg.size)}`);
console.log('');
console.log('La proporción tiene que coincidir con --splash-ar en index.html:');
console.log(`  --splash-ar: ${(webp.width / webp.height).toFixed(4)};`);
