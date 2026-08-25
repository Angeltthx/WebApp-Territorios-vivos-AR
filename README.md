# Territorios Vivos AR — Nuquí, Chocó

Realidad aumentada en el navegador, funcional en **iPhone (Safari) y Android (Chrome)**, sin instalar ninguna app y sin licencias de pago.

Apuntas la cámara al mapa ilustrado de Nuquí y sobre él aparecen cuatro iconos 3D flotando, uno sobre cada animal: la **ballena**, la **pava**, el **cangrejo** y la **tortuga**. Cada uno suena distinto al tocarlo.

---

## Aclaración sobre Three.js

Three.js **no es una biblioteca de realidad aumentada**. Es un motor de render 3D sobre WebGL: dibuja objetos, luces y materiales, pero no sabe nada de la cámara del teléfono ni de dónde está el marcador.

Una app de AR necesita dos piezas distintas:

| Pieza | Responsabilidad | Aquí usamos |
|---|---|---|
| Motor de render 3D | Dibujar el objeto | **Three.js** |
| Motor de tracking (visión por computadora) | Saber dónde ponerlo respecto al mundo real | **MindAR** |

---

## Por qué MindAR y no WebXR

WebXR es el estándar del navegador para AR. **Safari en iPhone no lo soporta.** Como el iPhone es requisito, WebXR queda descartado.

MindAR no depende de WebXR: procesa el video de la cámara con su propio motor de visión (JavaScript + WebGL + TensorFlow.js), así que corre dentro de Safari. Es **MIT**, gratis, sin licencia comercial.

**El precio de esa decisión:** MindAR hace *image tracking*, no *world tracking*. Necesitas un marcador. No puedes "apuntar al piso y colocar" — eso requiere SLAM propietario y no existe gratis para iOS.

---

## Qué hace la app

- **Cuatro iconos clavados al mapa**: cada uno flota sobre su animal y se queda ahí aunque muevas el teléfono.
- **Sonido al tocar**: cada animal tiene un timbre propio, sintetizado en vivo. Se toca el icono concreto, no "el objeto".
- **Barra inferior**: destaca uno de los cuatro y lo hace sonar.
- **Gestos**: arrastra para girar los iconos, pellizca para escalarlos, toca uno para que suene.
- **Control de estabilización** en tres niveles, ajustable sobre la marcha.
- **Funciona sin assets**: los cuatro son geometría generada por código, y los sonidos se sintetizan. No hay un solo `.glb` ni `.mp3` que descargar.

Los iconos giran y escalan **sobre sí mismos**: nunca se despegan del animal que señalan. Esa es la razón de que `Placement` documente explícitamente que `rotationY` y `scale` no tocan las posiciones.

### Sobre el sonido

No hay archivos de audio. Los sonidos se sintetizan con Web Audio a partir de un `SoundProfile` declarado en el dominio: forma de onda, frecuencia fundamental, armónicos y duración. Ventajas: nada que licenciar, nada que descargar, el bundle no crece, y ajustar un timbre es cambiar un número.

Los cuatro perfiles son deliberadamente distintos para que se reconozcan de oído:

| Animal | Carácter | Cómo se logra |
|---|---|---|
| Ballena | Canto grave y largo | Senoidal a 90 Hz, armónicos casi puros, 1.8 s |
| Pava | Graznido áspero y corto | Onda cuadrada a 520 Hz, armónicos impares |
| Cangrejo | Chasquido de pinza | Triangular a 880 Hz, armónicos **no enteros**, 140 ms |
| Tortuga | Burbujeo redondo | Senoidal a 240 Hz, armónicos enteros |

> Nota de iOS: Safari mantiene el audio bloqueado hasta que hay un gesto real del usuario. Por eso `audio.unlock()` se llama dentro del handler del botón Iniciar. Si lo mueves de sitio, el sonido deja de funcionar en iPhone.

### Mejoras de estabilidad del tracking

Dos capas, y la segunda es la que más se nota:

**1. Parámetros de MindAR afinados** (semántica verificada en su documentación oficial, `quick-start/tracking-config`):

| Parámetro | Por defecto | Aquí | Motivo |
|---|---|---|---|
| `filterMinCF` | 0.001 | 0.0005 | Bajarlo reduce el temblor |
| `filterBeta` | 1000 | 2000 | Subirlo reduce el retardo |
| `warmupTolerance` | 5 | 3 | El objeto aparece antes |
| `missTolerance` | 5 | **12** | Evita parpadeos al salirse el marcador un instante |

`missTolerance` es el cambio de mayor impacto real: con el valor por defecto el objeto desaparece en cuanto el marcador sale un momento del encuadre, que es justo lo que pasa cuando caminas alrededor.

**2. Suavizado propio.** El modelo **no** cuelga directamente del anchor de MindAR — colgarlo hace que herede el temblor cuadro a cuadro del motor de visión. En su lugar, un grupo `follower` copia la pose del anchor cada frame con interpolación exponencial independiente del framerate (mismo resultado a 30 que a 60 fps).

El botón **Rápido / Equilibrado / Estable** cambia ese factor en caliente. Es la diferencia entre un objeto que vibra y uno que se queda quieto. El compromiso es retardo al mover rápido.

---

## Arranque rápido

Requisitos: Node.js 18+.

```bash
npm install        # tarda bastante: MindAR arrastra TensorFlow.js
npm run typecheck
npm run dev
```

| Comando | Para qué |
|---|---|
| `npm run dev` | Servidor de desarrollo con HTTPS, para probar desde el teléfono |
| `VITE_HTTP=1 npm run dev` | Igual pero sin TLS. Solo para mirar cosas en el escritorio (`/verify.html`): sin HTTPS no hay cámara fuera de localhost |
| `npm run build` | Sitio estático en `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run compile-target` | Recompila `map.jpg` → `map.mind` |

Vite imprime dos direcciones. Usa la de tu red local (`https://192.168.x.x:5173`) **desde el teléfono**. Debe ser `https://` — la cámara no funciona sobre `http://`.

Safari mostrará una advertencia de certificado autofirmado. Acéptala: *Mostrar detalles → Visitar este sitio web*.

### El marcador

El marcador es el mapa de Nuquí, ya compilado en `public/targets/map.mind`. Para verlo funcionar necesitas mostrarle esa imagen a la cámara: **imprímela**, o ábrela en otra pantalla desde `public/targets/map.jpg` (la propia app enlaza a ella con "¿No ves nada?").

> Imprimir funciona mejor que una pantalla: los reflejos y el refresco del monitor le quitan puntos al rastreo.

Para **recompilar el target** (porque cambió la imagen, o para usar otra):

```bash
npm run compile-target
```

Eso lee `public/targets/map.jpg` y escribe `public/targets/map.mind`. Si cambias de imagen tienes además que:

1. Actualizar `TARGET_ASPECT` en `src/main.ts` (alto/ancho de la imagen nueva).
2. Volver a medir los `spot` del catálogo — ver la sección siguiente.

> El compilador oficial de MindAR (`OfflineCompiler`) importa el paquete nativo `canvas`, que aquí no se compila porque `.npmrc` fija `ignore-scripts=true`. `scripts/compile-target.mjs` esquiva eso: subclasea `CompilerBase` —que no depende de canvas— y le pasa el JPEG ya decodificado con jpeg-js. Sin navegador y sin dependencias nativas.

> Funcionan mejor las imágenes con mucho detalle y contraste. Las planas, simétricas o con grandes zonas de color uniforme se rastrean mal. Este mapa da 3410 puntos de features en 11 escalas, que es mucho: se rastrea bien.

### Mover un icono, o añadir otro

Cada entrada de `NUQUI_CATALOG` (en `src/infrastructure/repositories/StaticModelRepository.ts`) lleva un `spot` con las coordenadas del animal **normalizadas 0–1 desde la esquina superior izquierda** de la imagen.

Para comprobar que un `spot` cae donde crees, dibuja una mira encima:

```bash
node scripts/preview-spots.mjs '[{"u":0.262,"v":0.220}]' mira.jpg
```

Y para ver los iconos reales sobre el mapa, sin cámara ni teléfono:

```bash
VITE_HTTP=1 npm run dev     # y abre /verify.html
```

Esa página monta **los mismos `MarkerPin` que usa la app** sobre el mapa colocado con el plano y el tamaño exactos del anchor de MindAR. La vista ortográfica no tiene perspectiva, así que si un halo no rodea a su animal, las coordenadas están mal.

### Tus modelos 3D

En `NUQUI_CATALOG`, cambia:

```ts
source: ModelSource.primitive('whale', 0x2c3e6b)
// por
source: ModelSource.gltf('/models/mi-ballena.glb')
```

y pon el `.glb` en `public/models/`. Si un archivo falta o falla, ese icono cae a una geometría de reemplazo en vez de tumbar la sesión completa.

Ten en cuenta la escala: en coordenadas del anchor, **el ancho del mapa es 1 unidad**. Un `.glb` exportado en metros aparecerá gigantesco.

---

## Despliegue (todo gratis)

El build es un sitio estático. Todos estos hosts dan HTTPS automático, obligatorio para la cámara.

**Netlify** (lo más corto): sube el repo a GitHub y luego *Add new site → Import an existing project*. La configuración ya viene en `netlify.toml`.

**Vercel**: mismo flujo, detecta Vite automáticamente.

**GitHub Pages**: funciona, pero sirve bajo subdirectorio. Añade a `vite.config.ts`:

```ts
export default defineConfig({ base: '/nombre-del-repo/', /* ...resto */ });
```

---

## Costos

| Concepto | Costo |
|---|---|
| MindAR (MIT) | $0 |
| Three.js (MIT) | $0 |
| Hosting estático, capa gratuita | $0 |
| Sonidos (sintetizados, sin archivos) | $0 |

**No cito los límites de ancho de banda de los planes gratuitos porque no tengo cifras verificadas y cambian.** Revísalos antes de tráfico real. Con geometría procedural el peso es mínimo; en cuanto metas `.glb` grandes, eso cambia.

El único gasto que aparecería es si necesitas *world tracking* markerless en iPhone: ahí entran Zappar u 8th Wall, ambos de pago.

---

## Arquitectura

Hexagonal (puertos y adaptadores). Regla única: **las dependencias apuntan hacia adentro**.

```
src/
├── domain/                    Reglas puras. Cero imports externos.
│   ├── entities/              ArModel, ArSession, Placement
│   └── value-objects/         ModelId, Scale, Vector3, MarkerSpot,
│                              ModelSource, SoundProfile, Stabilization
├── application/
│   ├── ports/                 TrackingPort, ScenePort, AudioPort,
│   │                          InteractionPort, ModelRepository, AnalyticsPort
│   └── use-cases/             StartArExperience, SwitchModel,
│                              TransformPlacement, PlayModelSound
├── infrastructure/            Aquí y solo aquí viven MindAR y Three.js.
│   ├── mindar/                MindArRuntime (instancia compartida)
│   ├── tracking/              MindArTrackingAdapter
│   ├── rendering/             ThreeSceneAdapter, MarkerPin, PrimitiveFactory
│   ├── interaction/           PointerInteractionAdapter (raycast + gestos)
│   ├── audio/                 WebAudioAdapter (síntesis)
│   ├── repositories/          StaticModelRepository + NUQUI_CATALOG
│   └── di/container.ts        ← composition root
├── ui/                        Pinta estado, emite intenciones.
└── verify.ts                  Página de verificación (solo desarrollo).
```

**`MarkerSpot` y `MarkerPin` son la pareja que sostiene esta versión.** `MarkerSpot` es dominio: "el cangrejo está en (0.487, 0.472) de la imagen", medido como se mide sobre un archivo de imagen. `MarkerPin` es infraestructura: sabe traducir eso a coordenadas del anchor de MindAR y montar el halo, la zona de toque y el icono flotante.

Están separados a propósito, y `MarkerPin` **no depende de MindAR ni del runtime**. Por eso `verify.html` puede montar exactamente los mismos pines sobre una foto del mapa y comprobar la alineación sin cámara, sin teléfono y sin tracking.

### Sistema de coordenadas del anchor

Está verificado leyendo el código de MindAR, no deducido:

- El origen es el **centro** de la imagen del marcador.
- El **ancho** de la imagen mide 1 unidad; el alto mide `targetAspect` (`image-target/three.js`, líneas 214-229).
- **+X** a la derecha, **+Y arriba** — MindAR invierte el eje Y de la imagen con `y' = h - y`, documentado en el comentario de `controller.js:_glModelViewMatrix`.
- **+Z** sale del papel hacia la cámara.

De ahí sale la conversión, que vive en una sola función (`anchorPositionOf`):

```
x = u - 0.5
y = (0.5 - v) * targetAspect
```

**El puerto que justifica todo esto es `TrackingPort`.** El motor de tracking es la pieza volátil. El día que Apple habilite WebXR en Safari, o que decidas pagar Zappar, escribes un adaptador nuevo y cambias **dos líneas** en `container.ts` (están marcadas con flechas en el código). Dominio, casos de uso y UI no se tocan.

`confirmAnchor()` hoy es un no-op en MindAR porque el anchor ya está atado a la imagen. Existe en el puerto para que el botón "Place" ya tenga su sitio cuando migres a un motor con world tracking.

**Decisión pragmática:** el bucle de render (60 fps) **no** está detrás de un puerto. Abstraer matrices por frame cuesta rendimiento y legibilidad sin dar nada a cambio. Vive en `MindArRuntime`, y los adaptadores se suscriben con `onFrame()`.

**Jerarquía de la escena** (importante para entender el código):

```
scene → follower (pose del marcador, SUAVIZADA)
          └── overlay (ajuste global)
                └── MarkerPin ×4 (posición fija = su MarkerSpot)
                      ├── halo (anillo tumbado sobre el papel)
                      ├── zona de toque (invisible, generosa)
                      └── lift (flota en +Z, con vaivén)
                            └── icono (girado y escalado sobre sí mismo)
```

La versión anterior inclinaba el contenido 90° para "poner de pie" un objeto sobre el marcador. Aquí eso **no existe**: los iconos viven en el plano del mapa y se elevan en +Z, como chinchetas. El giro de 90° sigue apareciendo, pero dentro de `MarkerPin`, y con un propósito distinto y verificado: convertir el "+Y arriba" con el que se modelan los iconos en Three.js al "+Z hacia fuera" del mapa.

---

## Estado de verificación

Lo que **sí** está verificado:

- **Typecheck: 0 errores**, con TypeScript en `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- **`vite build` completa.** (Antes no: `vite.config.ts` declaraba una entrada `place.html` que no existía en el repo, así que el build fallaba en cualquier clon limpio. Esa entrada se eliminó.)
- **El `.mind` compilado es válido y el mapa se detecta.** No es solo que el archivo tenga la forma correcta: se cargó el `Controller` real de MindAR en el navegador, se le pasó un fotograma sintético con el mapa dentro y **encontró el marcador** (`match` devolvió pose). La matriz resultó ser prácticamente la identidad en rotación, con el centro del mapa sobre el eje óptico — exactamente lo que se le dio de entrada.
- **Las coordenadas de los cuatro animales caen donde deben.** Comprobado en `/verify.html`, montando los `MarkerPin` reales sobre el mapa en el plano y el tamaño exactos del anchor, con cámara ortográfica (sin perspectiva que disimule un error).
- **La dirección de +Z es la correcta**: en la vista en perspectiva de `/verify.html` los iconos flotan **hacia fuera** del papel, no hundidos en él.
- **`targetAspect` (1280/880)** coincide con las dimensiones que el propio runtime de MindAR reporta al cargar el `.mind`: `[[880, 1280]]`.
- El detalle del marcador: **3410 puntos de features repartidos en 11 escalas**, que es un target holgadamente rastreable.

Lo que **no** está verificado, y solo se puede comprobar con el mapa impreso delante:

- **El rastreo con una cámara real.** La detección está probada contra un fotograma sintético y perfecto: sin desenfoque, sin reflejos, sin ángulo, sin luz mala. Eso valida el `.mind` y la tubería, no la experiencia.
- **Los gestos, el audio y la estabilización en un teléfono.** Sin cámara ni dispositivo de mi lado.
- **Cómo de bien se leen los iconos** a tamaño real, sobre el mapa impreso y en movimiento.

### Ajustes probables en la primera prueba real

1. **Si los iconos se ven grandes o pequeños**: `ICON_SCALE` en `MarkerPin.ts` (0.58). Están dimensionados para que el halo quede por fuera y el animal se siga viendo debajo.
2. **Si flotan demasiado separados del papel**: `HOVER_HEIGHT` (0.11, en anchos de mapa).
3. **Si el render se desalinea del video**: quita `renderer.setPixelRatio(...)` en `MindArRuntime.configureRenderer()`. Mejora la nitidez en pantallas retina, pero es el punto donde más podría chocar con los cálculos internos de MindAR.
4. **Si los iconos tiemblan**: pulsa el botón hasta "Estable". Si aun así, baja `filterMinCF` en `DEFAULT_TUNING`.
5. **Si el sonido no suena en iPhone**: confirma que el teléfono no está en modo silencio, y que `audio.unlock()` sigue llamándose dentro del gesto del botón.

---

## Advertencias que debes conocer

1. **MindAR no recibe actualizaciones desde enero de 2024** (verificado en el registro de npm: 1.2.5). Lo mantiene un desarrollador individual. Es el mejor SDK de WebAR open source disponible, pero es un riesgo de sostenibilidad. `TrackingPort` es tu seguro.
2. **`three` está fijado en 0.160.0**, la versión que usa la documentación de MindAR. Three.js ya va por 0.185+, pero MindAR nunca se probó contra ella. No subas de versión sin probar en dispositivo real.
3. **Los tipos de MindAR (`src/types/mindar.d.ts`) los escribí a mano.** Los nombres los verifiqué en el bundle, pero no son oficiales.
4. **Depurar exige el teléfono.** iPhone: Safari Web Inspector desde un Mac. Android: `chrome://inspect`.

---

## Siguientes pasos sugeridos

1. Desplegar y confirmar que la cámara abre en iPhone y Android.
2. Aplicar los ajustes de la sección anterior según lo que veas.
3. Reemplazar el marcador de ejemplo por una imagen tuya.
4. Sustituir las primitivas por `.glb` propios.
5. Cambiar `StaticModelRepository` por `HttpModelRepository` cuando el catálogo venga de un backend. Implementa la misma interfaz; cambias una línea en `container.ts`.
