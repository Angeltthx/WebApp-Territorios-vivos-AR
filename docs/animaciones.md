# Rama de animaciones

## Secuencias

Los clips comienzan únicamente al descubrir el animal. Se reproducen en ciclo
con una transición de 0,35 s y los bucles definidos por el diseñador:

| Animal | Secuencia |
| --- | --- |
| Ballena | `Swin` ×2 → `Jump` ×1 |
| Cangrejo | `Idle` ×6 → `Walk` ×4 |
| Pava | `Idle` ×1 → `Sing` ×1 |
| Tortuga | `Swin` ×4 → `Idle` ×6 |

Un modelo oculto no actualiza su `AnimationMixer`. Si el mapa se pierde, solo
continúa el animal que está abierto en primer plano. Esto conserva la animación
visible y evita calcular esqueletos que no se pueden ver.

## Interacción y sonido

Cada animal tiene un clip expresivo para la entrada y el toque: `Jump` en la
ballena, `Sing` en la pava, `Walk` en el cangrejo y `Swin` en la tortuga. Al
descubrirlo ese clip se reproduce una vez antes del ciclo normal; cada toque lo
reinicia, además de reproducir el sonido y el pulso visual.

En primer plano se añade un disco transparente orientado a la cámara,
ligeramente mayor que el modelo, para que el raycast sea fiable con un dedo y el
teléfono en movimiento. El toque también reclama de nuevo la sesión `playback`
de Safari antes de sonar. La escala se calcula con el ancho X/Z proyectado en
cada giro: así una ballena de frente no queda pequeña ni crece de golpe al
mostrar el costado.

## Distancia de descubrimiento

El punto de partida sube de `1.25/1.6/0.62` a `1.75/2.15/0.72` para
`revealDistance`, `hideDistance` y `aimRadius`. La cámara puede conservar más
mapa dentro del encuadre al descubrir un animal y la diferencia entre revelar y
ocultar mantiene la histéresis. La calibración final sigue dependiendo del
tamaño impreso y de la cámara física.

## Peso

Los cuatro originales animados suman 9.353.580 bytes. `npm run optimize-models`
reduce texturas, aplica Draco y elimina claves de animación redundantes sin
cambiar nombres ni duraciones de los ocho clips. La salida suma 887.492 bytes.
Los modelos estáticos anteriores sumaban 508.388 bytes, por lo que integrar las
animaciones añade 379.104 bytes al despliegue de modelos.

## Entrega del diseñador

Las instrucciones y el JavaScript de referencia se conservan en esta carpeta
como `INSTRUCCIONES.txt` y `main.reference.js`. El código de producción no usa
ese visor independiente: la secuencia se integra en `MarkerPin` y
`ThreeSceneAdapter`, dentro del bucle compartido de MindAR.

## Verificación

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`/verify.html?reveal=1` carga los cuatro GLB reales y permite comprobar el
movimiento, la escala y la colocación sin cámara. Las duraciones de todos los
clips se compararon antes y después de optimizar y permanecen iguales.
