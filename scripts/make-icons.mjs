/**
 * El ícono de la experiencia → public/icons/* y public/favicon.ico.
 *
 *     npm run make-icons
 *
 * Es EL MISMO ícono del webdoc (territoriosvivos.com.co), pedido así en
 * noviembre de 2026 para que los dos sitios se reconozcan como uno: el logo
 * «Territorios Vivos» que mandó la clienta, sobre un cuadro claro (el papel
 * del webdoc) para que se vea también en pestañas oscuras. El original vive
 * en ../webdoc/Contenido/Icono, como las fotos de `make-photos`. Antes el
 * ícono era LOGO.png (la rana sobre el río, en la raíz, ya sin uso).
 *
 * Sin ícono, lo que se veía —en la pestaña, en los resultados de Google y en
 * el «Reproduciendo ahora» del iPhone cuando sonaba algo con la página en
 * segundo plano— era el de Netlify. Dos familias:
 *
 *   - Con las esquinas redondeadas y transparentes: favicon de pestaña y de
 *     Google (Google pide múltiplos de 48 px).
 *   - Cuadrado y opaco: el de iPhone (apple-touch-icon) y el de
 *     «Reproduciendo ahora» / manifiesto. iOS redondea él mismo, y una
 *     esquina transparente la rellena de negro.
 *
 * Si el logo cambia, sube el `?v=` de los íconos (index.html, el manifiesto
 * y WebAudioAdapter): el navegador guarda los favicons aparte y no los
 * refresca al recargar.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCE = '../webdoc/Contenido/Icono/logo-territorios-vivos.png';
const OUT = 'public/icons';
/** El papel del webdoc (--paper-2). */
const PAPER = '#fffdf7';
/** El aire a cada lado del logo, en fracción del lado: el mismo que en el webdoc. */
const PAD = 0.06;
/** El radio de las esquinas, en fracción del lado (como en el webdoc). */
const RADIUS = 0.2;

mkdirSync(OUT, { recursive: true });

// El logo sin el aire transparente alrededor (el original es de 1920 × 1080).
const logo = await sharp(SOURCE).trim().png().toBuffer();

/** El ícono de `size` px: el logo centrado sobre el papel, con o sin las esquinas redondeadas. */
async function icon(size, { round, pad = PAD }) {
  const inner = Math.round(size * (1 - 2 * pad));
  const mark = await sharp(logo).resize(inner, inner, { fit: 'inside' }).toBuffer();
  const r = round ? Math.round(size * RADIUS) : 0;
  const paper = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${PAPER}"/></svg>`,
  );
  const flat = await sharp(paper).composite([{ input: mark, gravity: 'center' }]).png().toBuffer();
  return sharp(flat);
}

// PNG con paleta (256 colores): a la vista no se distingue del de color
// verdadero y pesa mucho menos, y el navegador lo baja en plena carga.
const PNG = { palette: true, quality: 90, effort: 10, compressionLevel: 9 };
const rounded = async (size) => (await icon(size, { round: true })).png(PNG);
const filled = async (size) => (await icon(size, { round: false, pad: 0.08 })).flatten({ background: PAPER }).png(PNG);

const outputs = [
  ['favicon-48.png', () => rounded(48)],
  ['favicon-96.png', () => rounded(96)],
  ['favicon-192.png', () => rounded(192)],
  ['apple-touch-icon.png', () => filled(180)],
  ['icon-512.png', () => filled(512)],
];
for (const [name, make] of outputs) {
  await (await make()).toFile(`${OUT}/${name}`);
  console.log(`${OUT}/${name}`);
}

// favicon.ico: lo que pide cualquier navegador (y Google) por defecto en la
// raíz. Un ICO puede llevar PNG dentro; se escribe a mano con uno de 48 px.
const png = await (await rounded(48)).toBuffer();
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
