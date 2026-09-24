/**
 * Recorta dibujos del mapa SIN su fondo, para enseñarlos en grande junto al
 * texto que los acompaña (la choza de la etnoaldea, los bailarines, las
 * ranas). public/targets/map.jpg -> public/illustrations/<id>.webp (+ alfa)
 *
 *   npm run cut-illustrations            genera los .webp
 *   npm run cut-illustrations -- preview además, .preview/illustrations/<id>.png sobre damero
 *
 * Cómo separa dibujo y fondo: la selva del mapa es un estampado de verdes
 * oscuros (≈ rgb 32,64,32 con trazos algo más claros). Se inunda desde el
 * borde del recorte todo lo que sea "verde de fondo" según la regla de cada
 * dibujo; lo que la inundación no alcanza es el dibujo. Luego se queda solo
 * con las manchas grandes (fuera motas del estampado), se rellenan los
 * agujeros interiores (un verde DENTRO de la choza es de la choza) y se
 * suaviza el borde un píxel.
 *
 * Igual que con los contornos de los animales: SIEMPRE mirar el `preview`
 * antes de creerse el recorte. Si la regla se queda corta, el recorte trae
 * selva pegada; si se pasa, se come trozos del dibujo.
 *
 * Las cajas están en píxeles de map.jpg (1000×1432). Si cambia el mapa, se
 * vuelven a medir, como los `spot` y las zonas de los textos.
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'public/targets/map.jpg';
const OUT = 'public/illustrations';
const SCALE = 2;
/** Las previsualizaciones sobre damero: para mirar, nunca para publicar. */
const PREVIEW = '.preview/illustrations';

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
/** Verde de la selva: el verde manda y es oscuro. */
const jungle = (r, g, b) => g > r + 8 && g >= b - 4 && lum(r, g, b) < 92;

const SUBJECTS = {
  // La etnoaldea: solo las chozas. La isla y las lianas son verdes, y
  // ninguna choza tiene verde: todo lo verde es fondo.
  // La caja empieza en y=84 para dejar fuera la mariposa de arriba.
  kipara: { box: [728, 84, 935, 178], background: (r, g, b) => g > r + 6 && g >= b - 6 },
  // Los bailarines: vestido blanco, piel, sombreros. La caja empieza a la
  // derecha de las etiquetas rosadas, que ya salen como texto.
  danza: { box: [703, 778, 797, 878], background: jungle },
  // Las ranas: la regla va al revés, porque alrededor hay hojas, flores y
  // la etiqueta azul de la especie. Rana es lo ROJO (sin el fucsia de las
  // flores, que tiene mucho azul) o lo NEGRO: el negro de la rana tiene el
  // verde a la par del rojo, y la selva oscura, muy por encima.
  rana: {
    box: [700, 1060, 955, 1262],
    background: (r, g, b) => !((r > g + 50 && r > b + 60) || (lum(r, g, b) < 75 && g < r + 12)),
  },
};

const preview = process.argv.includes('preview');
mkdirSync(OUT, { recursive: true });

const { data: image, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true });

for (const [id, { box: [x0, y0, x1, y1], background }] of Object.entries(SUBJECTS)) {
  const w = x1 - x0;
  const h = y1 - y0;
  const rgb = (x, y) => {
    const i = ((y0 + y) * info.width + (x0 + x)) * info.channels;
    return [image[i], image[i + 1], image[i + 2]];
  };

  // 1. Inundación desde el borde a través del fondo.
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (outside[k] === 1 || !background(...rgb(x, y))) return;
    outside[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < w; x += 1) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 1) { push(0, y); push(w - 1, y); }
  while (stack.length > 0) {
    const k = stack.pop();
    const x = k % w;
    const y = (k - x) / w;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 2. Manchas del dibujo: solo las grandes (el estampado deja motas sueltas).
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let k = 0; k < w * h; k += 1) {
    if (outside[k] === 1 || label[k] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const queue = [k];
    label[k] = id;
    while (queue.length > 0) {
      const c = queue.pop();
      size += 1;
      const cx = c % w;
      const cy = (c - cx) / w;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (outside[n] === 1 || label[n] !== -1) continue;
        label[n] = id;
        queue.push(n);
      }
    }
    sizes.push(size);
  }
  const biggest = Math.max(...sizes);
  const keep = sizes.map((size) => size >= biggest * 0.06);
  const alpha = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k += 1) alpha[k] = label[k] >= 0 && keep[label[k]] ? 255 : 0;

  // Agujeros: lo que no es dibujo pero queda ENCERRADO por él (las manchas
  // negras de la rana, un hueco entre dos chozas pegadas) es del dibujo.
  // Fuera es solo lo que se alcanza desde el borde sin cruzar el dibujo.
  const reach = new Uint8Array(w * h);
  const open = [];
  const enter = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (reach[k] === 1 || alpha[k] === 255) return;
    reach[k] = 1;
    open.push(k);
  };
  for (let x = 0; x < w; x += 1) { enter(x, 0); enter(x, h - 1); }
  for (let y = 0; y < h; y += 1) { enter(0, y); enter(w - 1, y); }
  while (open.length > 0) {
    const k = open.pop();
    const x = k % w;
    const y = (k - x) / w;
    enter(x + 1, y); enter(x - 1, y); enter(x, y + 1); enter(x, y - 1);
  }
  for (let k = 0; k < w * h; k += 1) if (reach[k] === 0) alpha[k] = 255;

  // 3. RGBA recortado, ampliado y con el borde suavizado.
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = y * w + x;
      const [r, g, b] = rgb(x, y);
      rgba.set([r, g, b, alpha[k]], k * 4);
    }
  }
  const cut = sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .resize(w * SCALE, h * SCALE, { kernel: 'lanczos3' })
    .trim({ threshold: 1 });
  const buffer = await cut.png().toBuffer();
  // Borde: un desenfoque mínimo SOLO del alfa, para que no salga dentado.
  const { data: px, info: out } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const soft = await sharp(px, { raw: out }).extractChannel(3).blur(0.8).raw().toBuffer();
  for (let i = 0; i < out.width * out.height; i += 1) px[i * 4 + 3] = soft[i];
  await sharp(px, { raw: out }).webp({ quality: 88, alphaQuality: 90 }).toFile(`${OUT}/${id}.webp`);

  if (preview) {
    const size = 16;
    const squares = [];
    for (let y = 0; y < out.height; y += size) {
      for (let x = 0; x < out.width; x += size) {
        if (((x + y) / size) % 2 === 0) squares.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#bbb"/>`);
      }
    }
    const board = Buffer.from(`<svg width="${out.width}" height="${out.height}"><rect width="100%" height="100%" fill="#eee"/>${squares.join('')}</svg>`);
    mkdirSync(PREVIEW, { recursive: true });
    await sharp(board).composite([{ input: `${OUT}/${id}.webp` }]).png().toFile(`${PREVIEW}/${id}.png`);
  }
  console.log(`${id}: ${out.width}×${out.height}`);
}
