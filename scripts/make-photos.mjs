/**
 * Las fotos de los lugares del mapa, listas para el teléfono.
 *
 *   npm run make-photos
 *
 * photos-src/photos.json -> public/photos/<texto>-<n>.webp
 *
 * Las ORIGINALES son las de la grabación del webdoc y viven en su carpeta
 * (\`source\` en el json, la carpeta hermana ../webdoc/Contenido): JPG de
 * cámara de 5–15 MB que no se copian aquí. Este repo versiona qué foto va
 * con qué texto y lo que se sirve, igual que con los modelos y los sonidos.
 *
 * Cada foto sale a 1080 px de lado mayor, en WebP calidad 76: se ven a
 * todo el ancho de un teléfono (≈1080 px reales con DPR 3) y pesan 80–200
 * KB. Se gira según su EXIF (las verticales de cámara vienen tumbadas).
 */
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'photos-src/photos.json'), 'utf8'));
const source = resolve(root, manifest.source);
const out = join(root, 'public/photos');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let total = 0;
for (const [textId, files] of Object.entries(manifest.photos)) {
  if (files.length > 3) throw new Error(`${textId}: ${files.length} fotos; el máximo es 3`);
  for (const [index, file] of files.entries()) {
    const from = join(source, file);
    const to = join(out, `${textId}-${index + 1}.webp`);
    await sharp(from)
      .rotate()
      .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76, effort: 6 })
      .toFile(to);
    const size = statSync(to).size;
    total += size;
    console.log(`${textId}-${index + 1}.webp  ${(size / 1024).toFixed(0).padStart(4)} KB  ← ${file}`);
  }
}
console.log(`\n${(total / 1024).toFixed(0)} KB en total`);
