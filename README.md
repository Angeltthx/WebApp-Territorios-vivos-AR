# Territorios Vivos AR — Nuquí, Chocó

Experiencia de realidad aumentada en el navegador con seguimiento del mapa
ilustrado de Nuquí. MindAR 1.2.5 detecta la imagen y Three.js 0.160.0 dibuja
cuatro animales: ballena, pava, cangrejo y tortuga. No requiere instalar una app.

## Experiencia

La portada permanece hasta pulsar «Iniciar experiencia AR». Durante esa espera
se precargan el motor de visión, el target y los modelos. Solo el gesto de inicio
solicita la cámara y desbloquea el audio; la portada muestra el estado hasta
que hay imagen disponible.

Al detectar el mapa aparecen contornos dorados pulsantes. Acercarse y apuntar
a un animal lo desbloquea para el resto de la sesión, dispara humo y abre su
ficha con el modelo en primer plano. La X cierra la ficha sin perder el progreso.
Cada animal entra con un gesto expresivo al ser descubierto y después continúa
su secuencia. Tocar uno revelado reinicia ese gesto y reproduce su sonido
sintetizado; arrastrar lo gira y pellizcar cambia su escala. El primer plano
mantiene un tamaño visual estable al girar y permanece animado al perder el mapa.

«?» muestra la guía durante cinco segundos. El menú contiene tres opciones
provisionales que todavía no tienen destino. Reintentar aparece al fallar.

## Desarrollo

Node.js 18 o posterior. Instalar con `npm install`.

| Comando | Función |
| --- | --- |
| `npm run dev` | Vite con HTTPS, accesible desde la red local |
| `npm run typecheck` | TypeScript estricto |
| `npm test` | Doce pruebas de regresión sin cámara |
| `npm run build` | Sitio estático en dist/ |
| `npm run preview` | Servir el build |
| `npm run prepare-target` | Entrega de la diseñadora → map.jpg |
| `npm run compile-target` | map.jpg → map.mind |
| `npm run bench-detection` | Detector y matcher reales sobre escenarios sintéticos |
| `npm run optimize-models` | models-src/ → public/models/ |
| `npm run optimize-splash` | Portada original → WebP y JPEG |

En PowerShell, usar `npm.cmd` si la política de ejecución bloquea `npm.ps1`.
Para inspeccionar sin TLS en el escritorio:

```powershell
$env:VITE_HTTP='1'
npm.cmd run dev
```

En el teléfono, abrir la dirección HTTPS de la LAN que imprime Vite.
La cámara requiere un contexto seguro; HTTP solo sirve en localhost.
Netlify usa `npm run build` y publica `dist/`, según netlify.toml.

## Arquitectura

Puertos y adaptadores: las dependencias apuntan hacia el dominio.

```text
src/
├── domain/          Sesión, descubrimiento, proximidad y valores inmutables
├── application/     Puertos y casos de uso
├── infrastructure/  MindAR, Three.js, Web Audio, punteros y catálogo
│   └── di/          container.ts: composición de las implementaciones
├── ui/              ArView: pinta estado y emite intenciones
├── main.ts          Conexión de la vista y ciclo de vida de la página
├── verify.ts        Verificación visual de los pines reales
└── verify-ui.ts     Verificación responsive de portada, guía y ficha
```

La sesión distingue estado de tracking, animales desbloqueados y animal enfocado.
Perder el mapa no elimina descubrimientos ni cierra la ficha. La proximidad
combina distancia, desviación del centro de pantalla e histéresis.

TrackingPort desacopla las reglas del motor de visión. Su sustitución requeriría
adaptar también la integración de escena e interacción que comparten MindArRuntime;
el dominio, los casos de uso y ArView permanecen independientes de esas librerías.

MindArRuntime posee el bucle de render. ThreeSceneAdapter copia la pose del
marcador a un follower suavizado, que contiene los cuatro MarkerPin. El primer
plano usa un escenario independiente de ese follower para seguir visible al
perder el marcador. Se mueve el mismo icono entre ambos; no se duplican texturas.

## Assets y coordenadas

El catálogo está en src/infrastructure/repositories/StaticModelRepository.ts.
Cada animal declara modelo, ficha, sonido, secuencia de clips, coordenadas,
orientación y contorno.

El ancho del mapa mide una unidad; el alto es 1432/1000. Las coordenadas del catálogo
parten de la esquina superior izquierda. MarkerPin realiza la conversión:

```text
x = u - 0.5
y = (0.5 - v) × targetAspect
+Z sale del papel hacia la cámara
```

Rotación y escala afectan al icono en su sitio, sin desplazar su punto en el mapa.
IconLoader normaliza y centra los GLB. Un archivo ausente o ilegible se sustituye
por un disco gris y se registra el error en consola. PrimitiveFactory mantiene
las alternativas procedurales, disponibles con ModelSource.primitive(...).

Los originales animados viven en models-src/ y la salida optimizada en
public/models/. No recomprimir la salida: la textura usa compresión con pérdida.
El proceso conserva los clips, elimina claves redundantes, reduce texturas y
aplica Draco. Los decodificadores se sirven localmente desde public/draco/.

Cambiar el mapa exige tratar como una unidad:

1. Preparar y compilar la imagen nueva.
2. Actualizar TARGET_ASPECT, el visor HTML y las vistas de verificación.
3. Medir de nuevo los spot y calcar los cuatro outlineShape.
4. Comparar anchos compilados con bench-detection, siempre sobre la misma imagen.

El compilador preconvierte a luma Rec.601 para coincidir con el runtime.
No usa canvas nativo: .npmrc desactiva los scripts de instalación.

## Verificación

- `/verify.html?reveal=999999`: contornos dorados sobre el mapa.
- `/verify.html?reveal=1`: modelos reales en vista ortográfica y perspectiva.
- `/verify-ui.html`: portada, guía y ficha en seis tamaños, sin cámara.
- `node scripts/preview-spots.mjs '[{"u":0.26,"v":0.22}]' salida.jpg`: mira de coordenadas.
- `node scripts/trace-outline.mjs whale ascii`: revisar la máscara antes de obtener el polígono.

Las páginas de verificación son solo de desarrollo y no forman parte del build.
El benchmark mide aciertos e inliers sintéticos; no demuestra rendimiento de cámara
real. El target actual conserva la línea base de 7/12 escenarios y 252 inliers
a 640 px. Esta rama no cambia el target ni los parámetros del detector.

Consultar [cambios y mediciones de optimización](docs/optimizacion.md) y la
[integración de animaciones](docs/animaciones.md).

## Comprobaciones en dispositivo

La aplicación busca compatibilidad con Safari iPhone y Chrome Android sin WebXR.
Tablets y ordenadores con cámara compatible también pueden ejecutarla: el tamaño
de pantalla no es una restricción del motor. No se garantiza funcionamiento en
todo hardware o navegador.

La proximidad necesita calibrarse con el mapa impreso y la cámara real.
Se ajusta por URL (`?reveal=1.75&hide=2.15&aim=0.72`) y con los registros
[Proximity] de consola. Acercarse demasiado puede sacar del encuadre la parte
del mapa que necesita MindAR para rastrear.

Antes de publicar: probar permisos/reintentos, sonido y regreso desde otra
página en Safari; verificar cámara, estabilidad, temperatura y gestos en Android
de gama baja; revisar portada y ficha en horizontal. No actualizar Three.js sin
volver a comprobar el rastreo en teléfonos.
