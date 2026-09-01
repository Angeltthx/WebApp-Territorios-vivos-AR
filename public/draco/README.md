# Decodificador Draco

Copia literal de `node_modules/three/examples/jsm/libs/draco/gltf/`, versión
que acompaña a `three@0.160.0`. **No los edites**: si algún día se sube la
versión de three, hay que volver a copiarlos desde ahí para que decodificador
y loader vayan a la par.

## Por qué están aquí

Los `.glb` de la fauna llegan con `KHR_draco_mesh_compression` en
`extensionsRequired`. Sin estos archivos, `GLTFLoader` no puede leer la
geometría y el modelo cae al marcador gris de `IconLoader`.

`DRACOLoader` los pide por HTTP en tiempo de ejecución (`setDecoderPath('/draco/')`
en `src/infrastructure/rendering/IconLoader.ts`), no por import, así que
tienen que servirse como archivos estáticos desde `public/`.

## Qué se descarga de verdad

- `draco_wasm_wrapper.js` (58 KB) + `draco_decoder.wasm` (192 KB) en cualquier
  navegador moderno — que son todos los que soportan MindAR.
- `draco_decoder.js` (512 KB) es el respaldo en JS puro y solo se pide si el
  navegador no soporta WebAssembly. En la práctica nunca se descarga.

Se cargan una sola vez, en diferido, la primera vez que se abre un `.glb`
comprimido, y no cuentan en el arranque de la app.

Licencia: Apache 2.0 — https://github.com/google/draco
