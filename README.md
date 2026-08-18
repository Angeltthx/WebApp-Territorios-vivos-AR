# WebAR — Demo con arquitectura hexagonal

Realidad aumentada en el navegador, funcional en **iPhone (Safari) y Android (Chrome)**, sin instalar ninguna app y sin licencias de pago.

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

- **Tres objetos** intercambiables desde la barra inferior: Audífonos, Cristal y Nudo.
- **Sonido al tocar**: cada objeto tiene un timbre propio, sintetizado en vivo.
- **Gestos**: arrastra para girar, pellizca para escalar, toca para que suene.
- **Control de estabilización** en tres niveles, ajustable sobre la marcha.
- **Funciona sin assets**: los tres objetos son geometría generada por código.

### Sobre el sonido

No hay archivos de audio. Los sonidos se sintetizan con Web Audio a partir de un `SoundProfile` declarado en el dominio: forma de onda, frecuencia fundamental, armónicos y duración. Ventajas: nada que licenciar, nada que descargar, el bundle no crece, y ajustar un timbre es cambiar un número.

Los tres perfiles son deliberadamente distintos para que se reconozcan de oído:

| Objeto | Carácter | Cómo se logra |
|---|---|---|
| Audífonos | Golpe grave y sordo | Onda senoidal a 110 Hz, pocos armónicos |
| Cristal | Campana metálica | Armónicos **no enteros** (2.76, 5.4, 8.93) |
| Nudo | Blip sintético corto | Onda cuadrada, solo armónicos impares |

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

Vite imprime dos direcciones. Usa la de tu red local (`https://192.168.x.x:5173`) **desde el teléfono**. Debe ser `https://` — la cámara no funciona sobre `http://`.

Safari mostrará una advertencia de certificado autofirmado. Acéptala: *Mostrar detalles → Visitar este sitio web*.

### El marcador

De fábrica usa el marcador de ejemplo de MindAR, así que funciona sin configurar nada. Necesitas mostrarle esa imagen a la cámara: descárgala desde la guía de inicio de MindAR (`hiukim.github.io/mind-ar-js-doc`) y ábrela en tu laptop o imprímela.

Para usar **tu propia imagen**: compílala en el compilador oficial de MindAR, guarda el `.mind` en `public/targets/` y cambia `TARGET_SRC` en `src/main.ts`.

> Funcionan mejor las imágenes con mucho detalle y contraste. Las planas, simétricas o con grandes zonas de color uniforme se rastrean mal.

### Tus modelos 3D

En `src/infrastructure/repositories/StaticModelRepository.ts`, cambia:

```ts
source: ModelSource.primitive('headphones', 0xe8442f)
// por
source: ModelSource.gltf('/models/mis-audifonos.glb')
```

y pon el `.glb` en `public/models/`. Si un archivo falta o falla, ese objeto cae a una geometría de reemplazo en vez de tumbar la sesión completa.

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
│   └── value-objects/         ModelId, Scale, Vector3,
│                              ModelSource, SoundProfile, Stabilization
├── application/
│   ├── ports/                 TrackingPort, ScenePort, AudioPort,
│   │                          InteractionPort, ModelRepository, AnalyticsPort
│   └── use-cases/             StartArExperience, SwitchModel,
│                              TransformPlacement, PlayModelSound
├── infrastructure/            Aquí y solo aquí viven MindAR y Three.js.
│   ├── mindar/                MindArRuntime (instancia compartida)
│   ├── tracking/              MindArTrackingAdapter
│   ├── rendering/             ThreeSceneAdapter, PrimitiveFactory
│   ├── interaction/           PointerInteractionAdapter (raycast + gestos)
│   ├── audio/                 WebAudioAdapter (síntesis)
│   ├── repositories/          StaticModelRepository + catálogo demo
│   └── di/container.ts        ← composition root
└── ui/                        Pinta estado, emite intenciones.
```

**El puerto que justifica todo esto es `TrackingPort`.** El motor de tracking es la pieza volátil. El día que Apple habilite WebXR en Safari, o que decidas pagar Zappar, escribes un adaptador nuevo y cambias **dos líneas** en `container.ts` (están marcadas con flechas en el código). Dominio, casos de uso y UI no se tocan.

`confirmAnchor()` hoy es un no-op en MindAR porque el anchor ya está atado a la imagen. Existe en el puerto para que el botón "Place" ya tenga su sitio cuando migres a un motor con world tracking.

**Decisión pragmática:** el bucle de render (60 fps) **no** está detrás de un puerto. Abstraer matrices por frame cuesta rendimiento y legibilidad sin dar nada a cambio. Vive en `MindArRuntime`, y los adaptadores se suscriben con `onFrame()`.

**Jerarquía de la escena** (importante para entender el código):

```
scene → follower (pose del marcador, SUAVIZADA)
          ├── content (inclinación base + posición)
          │     └── spinner (rotación del usuario)
          │           └── modelo activo
          └── anillo de contacto
```

---

## Estado de verificación

Lo que **sí** verifiqué en mi entorno:

- **Typecheck completo: 0 errores en 31 archivos**, con TypeScript en modo `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Confirmé que el chequeo era real inyectando un error a propósito y viendo que lo detectaba.
- Los nombres de la API de MindAR, inspeccionando el bundle real de `mind-ar@1.2.5`.
- La semántica de los parámetros de tracking, en la documentación oficial.
- Licencias MIT y versiones, en el registro de npm.

Lo que **no** pude verificar:

- **El build de producción (`vite build`).** La instalación completa de dependencias no terminó en mi entorno.
- **Nada en un dispositivo real.** No tengo cámara ni teléfono. Todo el comportamiento en runtime —tracking, gestos, audio, orientación— está sin probar de mi lado.

### Ajustes probables en la primera prueba real

1. **Si el objeto aparece acostado o enterrado en el marcador**: cambia el signo de `this.content.rotation.x = Math.PI / 2` en `ThreeSceneAdapter.mount()`. Deduje la orientación del plano del anchor de la documentación, pero no pude confirmarla visualmente. Es el ajuste más probable de todos.
2. **Si el render se desalinea del video**: quita la línea `renderer.setPixelRatio(...)` en `MindArRuntime.configureRenderer()`. Mejora la nitidez en pantallas retina, pero es el punto donde más podría chocar con los cálculos internos de MindAR.
3. **Si el objeto tiembla demasiado**: pulsa el botón hasta "Estable". Si aun así, baja `filterMinCF` en `DEFAULT_TUNING`.
4. **Si el sonido no suena en iPhone**: confirma que el teléfono no está en modo silencio, y que `audio.unlock()` sigue llamándose dentro del gesto del botón.

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
