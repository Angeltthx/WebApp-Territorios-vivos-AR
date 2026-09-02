/**
 * Banco de pruebas de DETECCIÓN, sin cámara y sin navegador.
 *
 * Mide cuántos fotogramas sintéticos —el mapa visto con reflejos de
 * distinta intensidad— consigue reconocer un `.mind` concreto. Sirve para
 * comparar dos compilaciones del target con números en vez de impresiones:
 *
 *     node scripts/detection-bench.mjs public/targets/map.mind
 *
 * Usa las MISMAS piezas que corren en el móvil (Detector + Matcher de
 * MindAR), así que lo que mide es el reconocimiento real, no una maqueta.
 * Lo único simulado es la cámara: el fotograma se fabrica aquí.
 *
 * Un fotograma sintético no es una cámara de verdad —no hay ruido de
 * sensor, ni desenfoque de movimiento, ni compresión— así que el número
 * absoluto no predice la tasa de acierto en la calle. Lo que sí es
 * comparable es la MISMA batería contra dos `.mind` distintos.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import * as tf from '@tensorflow/tfjs';
import { CompilerBase } from 'mind-ar/src/image-target/compiler-base.js';
import { Detector } from 'mind-ar/src/image-target/detector/detector.js';
import { Matcher } from 'mind-ar/src/image-target/matching/matcher.js';
import 'mind-ar/src/image-target/detector/kernels/cpu/index.js';

const MAP = 'public/targets/map.jpg';
const DUMP_DIR = process.env['BENCH_DUMP'] ?? null;

/**
 * Un reflejo es una mancha de luz especular: satura una zona a blanco y
 * arrastra el contraste local alrededor. Se simula con un degradado radial
 * mezclado en modo `screen`, que es justo eso — sumar luz hasta quemar.
 */
const glareOverlay = (w, h, cx, cy, radius, strength) => {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="${cx}" cy="${cy}" r="${radius}">
      <stop offset="0%" stop-color="rgb(255,255,255)" stop-opacity="${strength}"/>
      <stop offset="55%" stop-color="rgb(255,255,255)" stop-opacity="${(strength * 0.45).toFixed(3)}"/>
      <stop offset="100%" stop-color="rgb(255,255,255)" stop-opacity="0"/>
    </radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`;
  return Buffer.from(svg);
};

/**
 * Fabrica un fotograma como el que entregaría la cámara: el mapa ocupando
 * parte del encuadre sobre un fondo neutro, algo desenfocado, y con un
 * reflejo encima. Se devuelve ya en gris con los MISMOS pesos de luma que
 * usa MindAR en el móvil (input-loader.js: 0.299/0.587/0.114), porque es
 * sobre esa señal donde el detector busca los puntos.
 */
const buildFrame = async ({ frameWidth, coverage, glare, glareAt, blurSigma }) => {
  const frameHeight = Math.round((frameWidth * 3) / 4);
  const mapHeight = Math.round(frameHeight * coverage);

  const map = await sharp(MAP).resize({ height: mapHeight }).toBuffer();
  const { width: mw, height: mh } = await sharp(map).metadata();

  let frame = sharp({
    create: {
      width: frameWidth,
      height: frameHeight,
      channels: 3,
      background: { r: 122, g: 120, b: 118 }, // mesa gris, no negro
    },
  }).composite([
    {
      input: map,
      left: Math.round((frameWidth - mw) / 2),
      top: Math.round((frameHeight - mh) / 2),
    },
  ]);

  let buf = await frame.png().toBuffer();

  if (glare > 0) {
    const [cx, cy] = glareAt;
    buf = await sharp(buf)
      .composite([
        {
          input: glareOverlay(frameWidth, frameHeight, cx, cy, '46%', glare),
          blend: 'screen',
        },
      ])
      .png()
      .toBuffer();
  }

  if (blurSigma > 0) buf = await sharp(buf).blur(blurSigma).png().toBuffer();

  const { data } = await sharp(buf)
    .greyscale() // sharp usa luma Rec.601, igual que el shader de MindAR
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8Array(data), width: frameWidth, height: frameHeight, png: buf };
};

/**
 * ¿Reconoce este `.mind` el fotograma? Mismo camino que en el móvil.
 *
 * Devuelve además cuántos puntos sobrevivieron al filtro de inliers de la
 * homografía. Ese número es la medida útil: acertar/fallar es binario y
 * salta por casualidad cerca del umbral, mientras que los inliers dicen
 * CON CUÁNTO MARGEN se reconoció.
 */
const detects = (matchingData, frame) => {
  const detector = new Detector(frame.width, frame.height);
  const matcher = new Matcher(frame.width, frame.height);

  const featurePoints = tf.tidy(() => {
    const inputT = tf
      .tensor(frame.data, [frame.data.length], 'float32')
      .reshape([frame.height, frame.width]);
    return detector.detect(inputT).featurePoints;
  });

  const { keyframeIndex, worldCoords } = matcher.matchDetection(matchingData, featurePoints);
  return {
    found: keyframeIndex !== -1,
    points: featurePoints.length,
    inliers: worldCoords?.length ?? 0,
  };
};

// --------------------------------------------------------------- escenarios

const SCENARIOS = [
  // Escalera de dificultad. `coverage` es cuánto del alto del fotograma
  // ocupa el mapa: bajarlo equivale a alejar el teléfono, que es cuando
  // los reflejos hacen más daño porque quedan menos píxeles por rasgo.
  { name: 'cerca, limpio',            coverage: 0.82, glare: 0.0,  glareAt: ['50%', '50%'], blur: 0.6 },
  { name: 'cerca, reflejo fuerte',    coverage: 0.82, glare: 0.95, glareAt: ['50%', '45%'], blur: 0.6 },
  { name: 'media, limpio',            coverage: 0.55, glare: 0.0,  glareAt: ['50%', '50%'], blur: 0.9 },
  { name: 'media, reflejo medio',     coverage: 0.55, glare: 0.75, glareAt: ['50%', '45%'], blur: 0.9 },
  { name: 'media, reflejo fuerte',    coverage: 0.55, glare: 0.95, glareAt: ['50%', '45%'], blur: 0.9 },
  { name: 'lejos, limpio',            coverage: 0.38, glare: 0.0,  glareAt: ['50%', '50%'], blur: 1.2 },
  { name: 'lejos, reflejo medio',     coverage: 0.38, glare: 0.75, glareAt: ['50%', '45%'], blur: 1.2 },
  { name: 'lejos, reflejo fuerte',    coverage: 0.38, glare: 0.95, glareAt: ['50%', '45%'], blur: 1.2 },
  { name: 'muy lejos, limpio',        coverage: 0.27, glare: 0.0,  glareAt: ['50%', '50%'], blur: 1.5 },
  { name: 'muy lejos, reflejo medio', coverage: 0.27, glare: 0.75, glareAt: ['50%', '45%'], blur: 1.5 },
  { name: 'muy lejos, reflejo fuerte',coverage: 0.27, glare: 0.95, glareAt: ['50%', '45%'], blur: 1.5 },
  { name: 'lejos, ventana lateral',   coverage: 0.38, glare: 0.9,  glareAt: ['78%', '55%'], blur: 1.2 },
];

const mindPath = resolve(process.argv[2] ?? 'public/targets/map.mind');
const frameWidth = Number(process.env['BENCH_WIDTH'] ?? 640);
const blurSigma = Number(process.env['BENCH_BLUR'] ?? 0.6);
const coverage = Number(process.env['BENCH_COVERAGE'] ?? 0.82);

await tf.setBackend('cpu');
await tf.ready();

const compiler = new CompilerBase();
const [target] = compiler.importData(readFileSync(mindPath).buffer);
if (!target) throw new Error(`No se pudo leer ${mindPath}`);

console.log(`Target:   ${mindPath}`);
console.log(`Fotograma: ${frameWidth}px de ancho, mapa al ${(coverage * 100).toFixed(0)}% del alto, desenfoque ${blurSigma}`);
console.log(`Keyframes en el .mind: ${target.matchingData.length}\n`);

if (DUMP_DIR) mkdirSync(DUMP_DIR, { recursive: true });

let hits = 0;
let totalInliers = 0;
for (const scenario of SCENARIOS) {
  const frame = await buildFrame({
    frameWidth,
    coverage: scenario.coverage ?? coverage,
    blurSigma: scenario.blur ?? blurSigma,
    ...scenario,
  });
  if (DUMP_DIR) writeFileSync(`${DUMP_DIR}/${scenario.name.replace(/ /g, '-')}.png`, frame.png);


  const { found, points, inliers } = detects(target.matchingData, frame);
  if (found) hits += 1;
  totalInliers += inliers;

  console.log(
    `${found ? '  OK  ' : ' FALLA'}  ${scenario.name.padEnd(24)} ` +
      `puntos:${String(points).padStart(4)}  inliers:${String(inliers).padStart(3)}`,
  );
}

console.log(`
Detectados ${hits}/${SCENARIOS.length}   inliers acumulados: ${totalInliers}`);
