// Usa el compilador ya incluido en Vite; no añade dependencias de pruebas.
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const result = await build({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: Object.fromEntries(['domain', 'application', 'infrastructure', 'ui'].map(
      (name) => [`@${name}`, fileURLToPath(new URL(`../src/${name}`, import.meta.url))],
    )),
  },
  ssr: { noExternal: true },
  build: {
    ssr: 'tests/regressions.test.ts',
    write: false,
    minify: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry);
await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`);
