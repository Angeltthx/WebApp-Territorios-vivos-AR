import { readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';

const { width, height, data } = jpeg.decode(readFileSync('C:/dev/webar/Map.jpeg'), { useTArray: true });

// u,v normalizados desde la esquina superior izquierda
const SPOTS = JSON.parse(process.argv[2]);

function px(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const o = (y * width + x) * 4;
  data[o] = r; data[o + 1] = g; data[o + 2] = b;
}

for (const s of SPOTS) {
  const cx = Math.round(s.u * width);
  const cy = Math.round(s.v * height);
  // circulo
  for (let a = 0; a < 360; a += 0.25) {
    const rad = (a * Math.PI) / 180;
    for (const R of [40, 41, 42, 43]) {
      px(Math.round(cx + R * Math.cos(rad)), Math.round(cy + R * Math.sin(rad)), 255, 0, 255);
    }
  }
  // cruz
  for (let d = -55; d <= 55; d++) {
    for (const t of [-1, 0, 1]) {
      px(cx + d, cy + t, 255, 0, 255);
      px(cx + t, cy + d, 255, 0, 255);
    }
  }
}

const out = jpeg.encode({ data, width, height }, 90);
writeFileSync(process.argv[3], out.data);
console.log('ok', width, height);
