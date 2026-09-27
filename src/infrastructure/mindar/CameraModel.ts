/**
 * EL MODELO DE CÁMARA DE MINDAR, CORREGIDO PARA TELÉFONOS.
 *
 * MindAR supone que TODA cámara tiene 45° de campo de visión vertical
 * (`controller.js:38`: `fovy = 45 * Math.PI / 180`), y con eso fija la
 * distancia focal con la que calcula la pose del mapa y con la que se
 * pinta la escena. Es un valor de webcam. La cámara principal de un
 * teléfono ve bastante más: unos 65–70° sobre el lado largo de la imagen
 * (un iPhone, 26 mm equivalentes → ~69°; los Android, entre 24 y 28 mm).
 *
 * Con la focal equivocada, lo que está PEGADO al papel se sigue pintando
 * en su sitio —la homografía del plano sale bien con cualquier focal—,
 * pero la inclinación que se deduce del mapa sale mal, y todo lo que
 * FLOTA sobre el papel se pinta desplazado; más cuanto más alto flota y
 * cuanto más de lado se mira. Los animales flotan (la ballena, bastante),
 * así que en el póster impreso aparecían fuera de su dibujo.
 *
 * No hay API web que dé la focal real. 66° sobre el lado largo acierta
 * mucho mejor que 45° en cualquier teléfono actual; `?fov=70` en la URL
 * permite afinarlo con el póster delante, sin recompilar.
 */

/** Campo de visión de la cámara de un teléfono sobre el lado LARGO de la imagen, en grados. */
export const PHONE_LONG_SIDE_FOV_DEG = 66;

/** Lo que MindAR usa de su controlador (nombres comprobados en `dist/controller-*.js`). */
export interface MindArController {
  readonly inputWidth: number;
  readonly inputHeight: number;
  readonly projectionTransform: number[][];
  projectionMatrix: number[];
  _glProjectionMatrix(options: {
    projectionTransform: number[][];
    width: number;
    height: number;
    near: number;
    far: number;
  }): number[];
}

/** Los mismos planos de recorte que usa MindAR (`controller.js`). */
const NEAR = 10;
const FAR = 100_000;

/**
 * El campo de visión VERTICAL (en radianes) para una imagen de `width` ×
 * `height`, sabiendo el del lado largo. En vertical el lado largo es el
 * alto; con el teléfono apaisado, el ancho.
 */
export function verticalFieldOfView(width: number, height: number, longSideDeg: number): number {
  const longSide = (longSideDeg * Math.PI) / 180;
  if (height >= width) return longSide;
  return 2 * Math.atan(Math.tan(longSide / 2) * (height / width));
}

/**
 * Rehace la matriz de la cámara del controlador con otro campo de visión,
 * EN SU SITIO: el `projectionTransform` se modifica, no se sustituye, por
 * si alguien ya guardó la referencia.
 */
export function correctCameraModel(controller: MindArController, longSideDeg: number): void {
  const width = controller.inputWidth;
  const height = controller.inputHeight;
  if (!(width > 0 && height > 0)) return;
  const fovy = verticalFieldOfView(width, height, longSideDeg);
  const focal = height / 2 / Math.tan(fovy / 2);
  const transform = controller.projectionTransform;
  transform[0]![0] = focal;
  transform[1]![1] = focal;
  controller.projectionMatrix = controller._glProjectionMatrix({
    projectionTransform: transform,
    width,
    height,
    near: NEAR,
    far: FAR,
  });
}

/**
 * Engancha la corrección a la instancia de MindARThree: su `_startAR` crea
 * el controlador (`this.controller = new Controller(...)`) y ACTO SEGUIDO
 * lo usa para dimensionar la cámara y para registrar el mapa, que es
 * cuando el rastreador copia la focal. No hay un momento entre medias en
 * el que meter la mano… salvo la propia asignación: un `set` en la
 * propiedad `controller` recibe el controlador recién hecho y lo corrige
 * antes de que nadie más lo use.
 *
 * `longSideDeg` null: no se toca (ordenador con webcam, donde los 45° de
 * MindAR sí son razonables).
 */
export function installCameraModel(mindar: object, longSideDeg: number | null): void {
  if (longSideDeg === null) return;
  let current: unknown = (mindar as { controller?: unknown }).controller;
  Object.defineProperty(mindar, 'controller', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (controller: unknown) => {
      current = controller;
      if (isController(controller)) {
        correctCameraModel(controller, longSideDeg);
        console.info(`[CameraModel] Campo de visión: ${longSideDeg}° sobre el lado largo`);
      }
    },
  });
}

/**
 * Qué campo de visión usar: el pedido por URL (`?fov=`) si lo hay; si no,
 * el de un teléfono en un dispositivo táctil; y en un ordenador, ninguno
 * (se queda el de MindAR).
 */
export function chooseLongSideFov(requested: number | null, isTouchDevice: boolean): number | null {
  if (requested !== null && Number.isFinite(requested) && requested >= 30 && requested <= 120) return requested;
  return isTouchDevice ? PHONE_LONG_SIDE_FOV_DEG : null;
}

function isController(value: unknown): value is MindArController {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<MindArController>;
  return (
    Array.isArray(candidate.projectionTransform) &&
    typeof candidate._glProjectionMatrix === 'function' &&
    typeof candidate.inputWidth === 'number' &&
    typeof candidate.inputHeight === 'number'
  );
}
