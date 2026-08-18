import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { fileURLToPath, URL } from 'node:url';

// HTTPS es OBLIGATORIO: getUserMedia() no funciona sobre http://
// salvo en localhost. Como vas a probar desde el iPhone contra la IP
// de tu laptop, necesitas TLS aunque el certificado sea autofirmado.
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  // Dos páginas independientes: la de marcador (index) y la de colocación
  // en el mundo real (place). Vite solo empaqueta index.html por defecto,
  // así que hay que declarar la segunda entrada explícitamente.
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        place: resolve(__dirname, 'place.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
    },
  },
});
