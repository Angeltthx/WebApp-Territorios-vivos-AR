/**
 * Optimiza los .glb del diseñador para servirlos por red móvil.
 *
 *     node scripts/optimize-models.mjs        (o: npm run optimize-models)
 *
 * Lee los ORIGINALES de `models-src/` y escribe los optimizados en
 * `public/models/`, que es lo único que se despliega.
 *
 * POR QUÉ DOS CARPETAS: la compresión de textura es con pérdida. Si el
 * script leyera y escribiera en el mismo sitio, cada ejecución recomprimiría
 * lo ya comprimido y la calidad se degradaría un poco más cada vez. Con los
 * originales aparte, esto siempre parte del material intacto de Jorge y es
 * idempotente. `models-src/` no se sirve: queda fuera de `public/`.
 *
 * DÓNDE ESTÁ EL PESO (medido sobre la entrega original):
 *
 *     texturas   8.31 MB   ← 96–99 % de cada archivo
 *     geometría  0.12 MB
 *
 * Por eso lo que baja el peso es recomprimir texturas, no Draco. Los mapas
 * venían en WebP sin pérdida y PNG a 1024×1024; a la distancia real de uso
 * —un icono ocupa ~9 % del ancho del mapa en la pantalla del teléfono— el
 * WebP con pérdida es indistinguible.
 *
 * Draco se aplica igualmente, uniforme a los cuatro: es lo que pidió Jorge,
 * tres de los cuatro ya venían con él, y deja la geometría en unos pocos KB.
 * El ahorro es pequeño en términos absolutos porque la geometría ya era
 * pequeña, pero no cuesta nada.
 */
import { readdirSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, dedup, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const SOURCE_DIR = resolve('models-src');
const OUTPUT_DIR = resolve('public/models');

/**
 * Calidad por tipo de mapa. Distinta a propósito:
 *
 *  - baseColor es lo único que el ojo lee como "el animal", así que va alto.
 *  - normal codifica direcciones en el color; los artefactos se ven como
 *    relieve sucio, no como manchas. Va alto aunque pese más.
 *  - metallicRoughness es de frecuencia muy baja (manchas suaves de brillo)
 *    y además llega en PNG, que es donde está el mayor derroche: ~1 MB por
 *    archivo. Aguanta bastante más compresión sin que se note.
 */
const QUALITY = [
  { slots: /baseColorTexture/, quality: 90 },
  { slots: /normalTexture/, quality: 90 },
  { slots: /metallicRoughnessTexture/, quality: 80 },
];

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

mkdirSync(OUTPUT_DIR, { recursive: true });

const files = readdirSync(SOURCE_DIR).filter((name) => name.toLowerCase().endsWith('.glb'));
if (files.length === 0) {
  console.error(`No hay ningún .glb en ${SOURCE_DIR}`);
  process.exit(1);
}

let totalBefore = 0;
let totalAfter = 0;

for (const name of files) {
  const input = join(SOURCE_DIR, name);
  const output = join(OUTPUT_DIR, name);

  const document = await io.read(input);

  await document.transform(
    // Una pasada por tipo de mapa: textureCompress aplica una sola calidad,
    // y aquí interesa una distinta para cada uno (ver QUALITY).
    ...QUALITY.map(({ slots, quality }) =>
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots, quality }),
    ),
    // Texturas y accessors repetidos entre materiales, y nodos/datos que no
    // referencia nadie. En estos archivos apenas hay, pero es gratis.
    dedup(),
    prune(),
    draco(),
  );

  await io.write(output, document);

  const before = statSync(input).size;
  const after = statSync(output).size;
  totalBefore += before;
  totalAfter += after;

  const saved = ((1 - after / before) * 100).toFixed(0);
  console.log(
    `${basename(name).padEnd(20)} ${mb(before)} → ${mb(after)}  (−${saved} %)`,
  );
}

console.log('─'.repeat(52));
console.log(
  `${'TOTAL'.padEnd(20)} ${mb(totalBefore)} → ${mb(totalAfter)}` +
    `  (−${((1 - totalAfter / totalBefore) * 100).toFixed(0)} %)`,
);

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(2)} MB`.padStart(8);
}
