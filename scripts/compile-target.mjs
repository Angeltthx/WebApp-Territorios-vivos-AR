/**
 * Compila una imagen a un target `.mind` de MindAR, sin navegador.
 *
 * Por qué no usamos el `OfflineCompiler` que trae MindAR: ese importa el
 * paquete nativo `canvas`, que aquí no está compilado (el .npmrc fija
 * `ignore-scripts=true`, así que node-canvas nunca ejecuta su build).
 *
 * Pero `CompilerBase` NO depende de canvas: solo llama a un
 * `createProcessCanvas(img)` que debe devolver algo capaz de
 * `getContext('2d').getImageData(...)`. Como decodificamos el JPEG con
 * jpeg-js y lo dibujamos a tamaño natural (1:1, sin reescalado), el
 * "canvas" puede ser un objeto trivial que devuelve el buffer RGBA tal
 * cual y un `drawImage` que no hace nada.
 *
 * Uso:  node scripts/compile-target.mjs <entrada.jpg> <salida.mind>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import jpeg from 'jpeg-js';
import * as tf from '@tensorflow/tfjs';
import { CompilerBase } from 'mind-ar/src/image-target/compiler-base.js';
import { buildTrackingImageList } from 'mind-ar/src/image-target/image-list.js';
import { extractTrackingFeatures } from 'mind-ar/src/image-target/tracker/extract-utils.js';
// Registra los kernels de CPU del detector. Sin esto, tfjs no encuentra las
// operaciones propias de MindAR fuera de WebGL.
import 'mind-ar/src/image-target/detector/kernels/cpu/index.js';

class NodeCompiler extends CompilerBase {
  createProcessCanvas(img) {
    const context = {
      drawImage: () => {},
      getImageData: () => ({ data: img.data, width: img.width, height: img.height }),
    };
    return { getContext: () => context };
  }

  // Copia literal de OfflineCompiler.compileTrack: es síncrono y no toca canvas.
  compileTrack({ progressCallback, targetImages, basePercent }) {
    const percentPerImage = (100 - basePercent) / targetImages.length;
    let percent = 0;
    const list = [];
    for (const targetImage of targetImages) {
      const imageList = buildTrackingImageList(targetImage);
      const percentPerAction = percentPerImage / imageList.length;
      list.push(
        extractTrackingFeatures(imageList, () => {
          percent += percentPerAction;
          progressCallback(basePercent + percent);
        }),
      );
    }
    return Promise.resolve(list);
  }
}

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error('Uso: node scripts/compile-target.mjs <entrada.jpg> <salida.mind>');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);

await tf.setBackend('cpu');
await tf.ready();

const { width, height, data } = jpeg.decode(readFileSync(inputPath), { useTArray: true });
console.log(`Imagen: ${width}x${height} (relación alto/ancho = ${(height / width).toFixed(4)})`);

const compiler = new NodeCompiler();
let lastReported = -10;
await compiler.compileImageTargets([{ width, height, data }], (percent) => {
  if (percent - lastReported >= 10) {
    lastReported = percent;
    console.log(`  ${percent.toFixed(0)}%`);
  }
});

const buffer = compiler.exportData();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, Buffer.from(buffer));

console.log(`\nEscrito ${outputPath} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);
