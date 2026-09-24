/**
 * audio-src/{sources,clips}.json -> public/audio/<animal>/*.mp3 + CREDITOS.md
 *
 *   npm run build-audio
 *
 * Mismo esquema que los modelos: lo que se sirve se GENERA, y lo que se
 * versiona es cómo generarlo. `sources.json` dice de dónde sale cada
 * grabación, de quién es y con qué licencia; `clips.json`, qué trozo de cada
 * una usa cada animal. Las grabaciones originales se descargan a
 * `audio-src/.cache/` (ignorada por git: la de las olas sola pesa 17 MB) y
 * de ahí se recorta.
 *
 * Cada corte se pasa a mono, se normaliza en sonoridad —las fuentes van de
 * −44 a −4 dB y sin esto una ballena taparía a la pava— y se comprime a MP3,
 * el único formato que todos los Safari de iPhone decodifican sin sorpresas:
 *
 *   - llamadas y toques: 64 kbps, −16 LUFS, con fundidos cortos;
 *   - ambientes: 48 kbps a 32 kHz, −24 LUFS y SIN fundidos —el
 *     reproductor los encadena con un fundido cruzado para que el bucle no
 *     tenga costura—.
 *
 * `ffmpeg` viene de @ffmpeg-installer, que trae el binario en un paquete
 * por plataforma sin script de instalación: funciona con el
 * `ignore-scripts=true` de .npmrc.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

const SRC = 'audio-src';
const OUT = 'public/audio';
const sources = JSON.parse(readFileSync(`${SRC}/sources.json`, 'utf8'));
const clips = JSON.parse(readFileSync(`${SRC}/clips.json`, 'utf8'));

mkdirSync(`${SRC}/.cache`, { recursive: true });
rmSync(OUT, { recursive: true, force: true });

async function cached(key) {
  const source = sources[key];
  if (source === undefined) throw new Error(`Fuente desconocida en clips.json: ${key}`);
  const file = `${SRC}/.cache/${key}.${source.url.split('.').pop()}`;
  if (!existsSync(file)) {
    process.stdout.write(`  descargando ${key}…\n`);
    const response = await fetch(source.url, {
      headers: { 'User-Agent': 'TerritoriosVivosAR/1.0 (build-audio)' },
    });
    if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return file;
}

function encode(inputs, filter, out, ambience) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  // `loop`: una grabación corta (el canto de una rana) se repite para
  // cubrir toda la capa en vez de quedarse sonando solo al principio.
  for (const input of inputs) {
    if (input.loop) args.push('-stream_loop', '-1');
    args.push('-ss', String(input.start), '-t', String(input.dur), '-i', input.file);
  }
  args.push('-filter_complex', filter, '-map', '[out]', '-ac', '1');
  args.push('-ar', ambience ? '32000' : '44100', '-codec:a', 'libmp3lame', '-b:a', ambience ? '48k' : '64k', out);
  execFileSync(ffmpeg, args, { stdio: 'inherit' });
}

const used = new Map();
const report = [];

for (const [animal, set] of Object.entries(clips)) {
  mkdirSync(`${OUT}/${animal}`, { recursive: true });

  // Los ambientes de los textos del mapa (costa, ranas) no tienen voz.
  for (const kind of ['calls', 'taps']) {
    for (const [index, clip] of (set[kind] ?? []).entries()) {
      const file = await cached(clip.src);
      const out = `${OUT}/${animal}/${kind === 'calls' ? 'call' : 'tap'}-${index + 1}.mp3`;
      const dur = clip.dur / (clip.tempo ?? 1);
      const tempo = clip.tempo === undefined ? '' : `atempo=${clip.tempo},`;
      encode(
        [{ file, start: clip.start, dur: clip.dur }],
        // `boost`: loudnorm no llega al objetivo en clips cortos y hechos de
        // golpecitos (los pasos del cangrejo quedaban a −43 dB); se sube a
        // mano y el limitador impide que los picos saturen.
        `[0:a]${tempo}highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=11,` +
          (clip.boost === undefined ? '' : `volume=${clip.boost}dB,alimiter=limit=0.85,`) +
          `afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4[out]`,
        out,
        false,
      );
      used.set(clip.src, [...(used.get(clip.src) ?? []), out]);
      report.push(out);
    }
  }

  // Ambiente: una o varias capas mezcladas (el cangrejo es playa + manglar).
  const layers = await Promise.all(set.ambience.map(async (layer) => ({ ...layer, file: await cached(layer.src) })));
  const mix = layers.map((layer, i) => `[${i}:a]aformat=channel_layouts=mono,volume=${layer.gain}[l${i}]`).join(';');
  const inputs = layers.map((_, i) => `[l${i}]`).join('');
  const out = `${OUT}/${animal}/ambience.mp3`;
  encode(
    layers,
    `${mix};${inputs}amix=inputs=${layers.length}:duration=longest,loudnorm=I=-24:TP=-3:LRA=11[out]`,
    out,
    true,
  );
  for (const layer of layers) used.set(layer.src, [...(used.get(layer.src) ?? []), out]);
  report.push(out);
}

// Los créditos viajan con los archivos: varias licencias (CC BY-SA) exigen
// atribución, y así nadie puede publicar un sonido sin su autor.
const credits = ['# Créditos de audio', '', 'Generado por `npm run build-audio`. No editar a mano.', ''];
for (const [key, outs] of used) {
  const source = sources[key];
  credits.push(`- **${source.title}** — ${source.author}. Licencia: ${source.license}. ${source.page}`);
  if (source.note) credits.push(`  - Nota: ${source.note}`);
  credits.push(`  - Usado en: ${[...new Set(outs)].map((o) => o.replace(`${OUT}/`, '')).join(', ')}`);
}
writeFileSync(`${OUT}/CREDITOS.md`, credits.join('\n') + '\n');

let total = 0;
for (const file of report) total += readFileSync(file).length;
console.log(`${report.length} archivos, ${(total / 1024).toFixed(0)} KB en total`);
