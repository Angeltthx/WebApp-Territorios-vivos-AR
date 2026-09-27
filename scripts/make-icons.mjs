/**
 * LOGO.png (el icono de la experiencia, en la raíz, sin servir) →
 * public/icons/* y public/favicon.ico.
 *
 *     npm run make-icons
 *
 * Sin esto la página no tenía icono, y lo que se veía —en la pestaña, en
 * los resultados de Google y en el «Reproduciendo ahora» del iPhone cuando
 * sonaba algo con la página en segundo plano— era el de Netlify.
 *
 * El logo es un cuadrado de esquinas redondeadas sobre fondo transparente,
 * con aire alrededor. De ahí salen dos familias:
 *
 *   - RECORTADO AL CUADRADO, con sus esquinas transparentes: favicon de
 *     pestaña y de Google (Google pide múltiplos de 48 px).
 *   - RECORTADO POR DENTRO de las esquinas, opaco: el icono de iPhone
 *     (apple-touch-icon) y el de «Reproduciendo ahora» / manifiesto. iOS
 *     redondea él mismo, y una esquina transparente la rellena de negro.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = 'LOGO.png';
const OUT = 'public/icons';
/** Cuánto se mete hacia dentro el recorte opaco, en fracción del lado: lo que ocupan las esquinas redondeadas. */
const CORNER_INSET = 0.07;

mkdirSync(OUT, { recursive: true });

// El cuadrado del logo, sin el aire transparente alrededor.
const { info } = await sharp(SOURCE).trim().toBuffer({ resolveWithObject: true });
const square = {
  left: -(info.trimOffsetLeft ?? 0),
  top: -(info.trimOffsetTop ?? 0),
  width: info.width,
  height: info.height,
};
const side = Math.min(square.width, square.height);
const inset = Math.round(side * CORNER_INSET);
const opaque = {
  left: square.left + inset,
  top: square.top + inset,
  width: side - inset * 2,
  height: side - inset * 2,
};

const rounded = (size) => sharp(SOURCE).extract(square).resize(size, size).png({ compressionLevel: 9 });
const filled = (size) =>
  sharp(SOURCE).extract(opaque).resize(size, size).flatten({ background: '#1f5b3a' }).png({ compressionLevel: 9 });

const outputs = [
  ['favicon-48.png', rounded(48)],
  ['favicon-96.png', rounded(96)],
  ['favicon-192.png', rounded(192)],
  ['apple-touch-icon.png', filled(180)],
  ['icon-512.png', filled(512)],
];
for (const [name, image] of outputs) {
  await image.toFile(`${OUT}/${name}`);
  console.log(`${OUT}/${name}`);
}

// favicon.ico: lo que pide cualquier navegador (y Google) por defecto en la
// raíz. Un ICO puede llevar PNG dentro; se escribe a mano con uno de 48 px.
const png = await rounded(48).toBuffer();
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // tipo: icono
header.writeUInt16LE(1, 4); // una imagen
header.writeUInt8(48, 6); // ancho
header.writeUInt8(48, 7); // alto
header.writeUInt8(0, 8); // sin paleta
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); // planos
header.writeUInt16LE(32, 12); // bits por píxel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);
writeFileSync('public/favicon.ico', Buffer.concat([header, png]));
console.log('public/favicon.ico');
