import { defineConfig, transformWithEsbuild } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

// HTTPS es OBLIGATORIO: getUserMedia() no funciona sobre http://
// salvo en localhost. Como vas a probar desde el iPhone contra la IP
// de tu laptop, necesitas TLS aunque el certificado sea autofirmado.
//
// La excepción es ese "salvo en localhost": para mirar algo en el
// escritorio (por ejemplo /verify.html) el certificado autofirmado solo
// añade avisos del navegador. `VITE_HTTP=1 npm run dev` lo desactiva.
// No lo uses para probar desde el teléfono: ahí no hay cámara sin TLS.
const useHttps = process.env['VITE_HTTP'] !== '1';

export default defineConfig({
  plugins: [
    ...(useHttps ? [basicSsl()] : []),
    {
      name: 'compact-entry-html',
      apply: 'build',
      async transformIndexHtml(html) {
        // Conservamos las explicaciones en el fuente, no en cada descarga.
        let compact = html.replace(/<!--[\s\S]*?-->/g, '');
        const styles = [...compact.matchAll(/<style>([\s\S]*?)<\/style>/g)];
        for (const match of styles) {
          const result = await transformWithEsbuild(match[1]!, 'inline.css', { loader: 'css', minify: true });
          compact = compact.replace(match[0], `<style>${result.code.trim()}</style>`);
        }
        return compact;
      },
    },
    {
      // El motor de AR (MindAR + TensorFlow, ~360 KB comprimido) se pide con
      // un import() dinámico, es decir, cuando el JS de la app ya bajó y se
      // ejecutó. Con datos móviles eso es tarde: es lo primero que hace falta
      // al tocar «Iniciar». Su nombre lleva hash, así que el build lo apunta
      // en `<html data-engine>` y el script del <head> lo pide en cuanto
      // termina de bajar la portada (ver index.html).
      name: 'preload-ar-engine',
      apply: 'build',
      transformIndexHtml(html, context) {
        const engine = Object.values(context.bundle ?? {}).find(
          (chunk) => chunk.type === 'chunk' && chunk.fileName.includes('mindar-image-three'),
        );
        if (engine === undefined) return html;
        return html.replace('<html lang="es">', `<html lang="es" data-engine="/${engine.fileName}">`);
      },
    },
  ],
  server: { host: true, port: 5173 },
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
});
