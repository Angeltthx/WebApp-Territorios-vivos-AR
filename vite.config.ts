import { defineConfig } from 'vite';
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
  plugins: useHttps ? [basicSsl()] : [],
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
