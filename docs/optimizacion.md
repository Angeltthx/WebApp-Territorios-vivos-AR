# Rama de optimización

## Comportamiento vigente

La portada solicita la cámara solamente al pulsar Iniciar. Durante la bienvenida
se descargan en paralelo el motor de visión, el target y los cuatro GLB.
El target se conserva como URL blob antes de construir MindAR: no se vuelve a
pedir por red después del permiso. Una descarga fallida o de más de 30 segundos
permite reintentar; no se entrega una URL fallida al arranque interno de MindAR.

La detección, las coordenadas, los contornos, los sonidos y el catálogo mantienen
su configuración. Descubrir desbloquea el animal para la sesión y abre su ficha.
El primer plano sigue visible, girable y tocable si el mapa sale del encuadre.
Cerrar la ficha devuelve el modelo a su pin. No hay animaciones GLB integradas:
los archivos `_Ani` de la nueva entrega pertenecen a la siguiente rama.

## Recursos y carga

- Modelos: 3.387.836 → 508.388 bytes frente al último commit. Esta reducción de
  texturas ya estaba en el árbol local al comenzar esta revisión y se conserva.
  Color a 512 px, normal y metallic-roughness a 256 px; WebP y Draco.
- Contornos: una malla por animal, cuatro draw calls en lugar de 272.
  También era parte del trabajo previo de la rama.
- JavaScript de entrada: aproximadamente 528 → 164 KB gzip. MindAR queda en
  un chunk aparte de aproximadamente 364 KB gzip que empieza a cargar durante
  la portada. Esto reduce el trabajo previo a instalar los controles; no elimina
  los bytes que necesita el detector para funcionar.
- Primitivas procedurales bajo import dinámico: no se descargan con el catálogo GLB.
- Draco limitado a dos workers, liberados al terminar de cargar los modelos;
  las versiones de MindAR y Three permanecen fijadas.
- Render con DPR máximo 1,5 y presupuesto de 1,5 millones de píxeles (suelo 0,75).
  A igual viewport, pasar de DPR 2 a 1,5 dibuja un 43,75 % menos de píxeles.
  No se reduce la resolución de cámara usada por el detector.
- El bucle de render se limita a unos 60 fps en paneles de alta frecuencia.
  Los pines fuera de vista no actualizan sus animaciones y los efectos CSS de la
  portada/guía retirada quedan pausados.
- HTML de producción: 31,65 → 12,98 KB (9,55 → 3,80 KB gzip), sin comentarios
  y con CSS inline minificado. La documentación
  de diseño sigue en el fuente. Sin peticiones a Google Fonts.
- Los chunks con hash pueden cachearse un año; los GLB de nombre estable se
  revalidan para evitar servir una entrega anterior tras desplegar.

## Correcciones funcionales

- El target se completa antes de inicializar MindAR; motor y modelos se descargan
  en paralelo y la portada permanece visible hasta que arranca la cámara.
- El audio se desbloquea sincrónicamente dentro del inicio, también por teclado
  y en reintentos; nunca se espera una promesa de audio suspendida para abrir cámara.
- Inicios simultáneos comparten operación. Un fallo limpia suscripciones y vídeo,
  incluso sin controlador o stream. Se conserva el error de permiso que MindAR
  descarta internamente, para mostrar una explicación útil.
- Detener durante la preparación impide abrir la cámara después. Detener durante
  el arranque no devuelve una sesión interactiva al llamador. Una nueva sesión
  vuelve a montar la escena liberada; regresar desde bfcache recarga limpiamente.
- El icono lleva su propio ID al moverse al primer plano; el raycast lo identifica
  allí. El sonido funciona con ficha abierta aunque se haya perdido el mapa.
  El pulso y el gesto de escala también se aplican al primer plano.
- Cancelar un puntero o empezar una pinza no dispara un toque falso. Se captura
  el puntero para no perder la terminación de un gesto fuera del canvas.
- Al limpiar se devuelve primero el icono prestado al pin, para liberar también
  su geometría/materiales/texturas. Los nodos de cada sonido se desconectan al terminar.
- La guía comienza al retirar la portada. Al expirar, recalcula los otros mensajes.
  El catálogo se repone tras reintentar una precarga fallida.

## Verificación reproducible

```sh
npm run typecheck
npm test
npm run build
```

En PowerShell, usar `npm.cmd` si la política local bloquea `npm.ps1`.
`npm test` usa Vite y el runner de Node ya disponibles, sin instalar un framework.
Incluye doble inicio, reintentos, cancelación durante preparación/arranque,
reinicio tras limpieza, permisos denegados y primer plano real de Three con
raycast, pulso y liberación de recursos.

En desarrollo HTTP, `/verify.html?reveal=999999` comprueba contornos y
`/verify.html?reveal=1` los GLB. `/verify-ui.html` usa el HTML y ArView reales
en seis iframes sin cámara: 320×568, 375×560, 390×744, 768×1024, 844×390 y
1366×768. Comprueba título/logos de portada, hotspot de inicio, guía y ficha.
Las dos páginas de verificación quedan fuera del build de producción.

El target y los parámetros de detección no cambiaron. Línea base previamente
medida: 7/12 escenarios y 252 inliers a 640 px. No se atribuye ninguna mejora
de reconocimiento a los cambios de render o de carga.

La revisión de escritorio no sustituye medir FPS, temperatura, cámara y audio
en Safari iPhone y Android de gama baja con el mapa impreso. Las distancias de
proximidad siguen pendientes de esa calibración. Tablets y ordenadores no se
bloquean por su tamaño: pueden funcionar con cámara, WebGL, WebAssembly y HTTPS,
pero la ergonomía y el rendimiento dependen del dispositivo.
