import type { Language } from '@domain/value-objects/Language';
import type { SessionErrorCode, SessionStatus } from '@domain/entities/ArSession';

/**
 * Un texto con una parte destacada (en dorado, como las siluetas): antes,
 * lo destacado y después. Se pinta con nodos, nunca como HTML.
 */
export type Rich = readonly [before: string, strong: string, after: string];

/**
 * TODOS los textos de la interfaz, en español y en inglés.
 *
 * Los de la ficha de cada animal y los de los textos del mapa no están
 * aquí: son contenido y viven con él (el catálogo y `NUQUI_MAP_TEXTS`, en su
 * campo `english`). Aquí solo lo que dice la app: la guía, el tutorial, los
 * botones, los estados.
 *
 * El inglés no es una traducción palabra por palabra: dice lo mismo como
 * se diría en inglés («Tócalo para ver su animación» → «Tap it to see it
 * move»).
 */
export interface Strings {
  readonly hints: Readonly<Record<SessionStatus, string>>;
  readonly errors: Readonly<Record<SessionErrorCode, string | null>>;
  readonly bootLoading: string;
  readonly bootCamera: string;
  readonly start: string;
  readonly guideTitle: string;
  readonly guideMission: Rich;
  readonly tapAnimalTitle: string;
  readonly tapAnimal: Rich;
  readonly tapAnotherTitle: string;
  /** «Te faltan 3 por conocer». */
  readonly remaining: (count: number) => Rich;
  readonly tapTextTitle: string;
  readonly tapText: Rich;
  readonly exploreTitle: string;
  readonly explore: Rich;
  readonly tapFocused: string;
  readonly closeHint: string;
  readonly narrationPlay: string;
  readonly narrationStop: string;
  readonly closeCard: string;
  readonly closeText: string;
  readonly mapText: string;
  /** Encima del directorio: que los @ se tocan y abren su Instagram. */
  readonly instagramHint: Rich;
  readonly openMenu: string;
  readonly showGuide: string;
  readonly sound: string;
  readonly volume: string;
  readonly mute: string;
  readonly unmute: string;
  readonly language: string;
  readonly retry: string;
  readonly menuStory: string;
  readonly menuSocial: string;
  readonly menuSoon: string;
}

export const STRINGS: Readonly<Record<Language, Strings>> = {
  es: {
    hints: {
      idle: 'Preparando la experiencia…',
      preparing: 'Preparando la escena…',
      searching: 'Apunta la cámara al mapa de Nuquí',
      tracking: 'Toca un animal para conocerlo',
      lost: 'Mapa fuera de encuadre. Vuelve a apuntar',
      error: 'Ocurrió un problema',
    },
    // null: el mensaje de la sesión, que ya viene en español.
    errors: { 'unsupported-device': null, 'camera-denied': null, 'model-not-found': null, unknown: null },
    bootLoading: 'Cargando los animales…',
    bootCamera: 'Encendiendo la cámara…',
    start: 'Iniciar experiencia AR',
    guideTitle: 'Apunta al mapa de Nuquí',
    guideMission: ['y descubre los ', '5 animales', ' que se esconden en él'],
    tapAnimalTitle: 'Toca un animal',
    tapAnimal: ['Toca la ', 'silueta dorada', ' para conocerlo'],
    tapAnotherTitle: 'Toca otro animal',
    remaining: (count) => [count === 1 ? 'Te falta ' : 'Te faltan ', `${count}`, ' por conocer'],
    tapTextTitle: 'Toca un punto amarillo',
    tapText: ['Cada uno cuenta algo del ', 'Chocó', ''],
    exploreTitle: 'Explora el resto de Nuquí',
    explore: ['Toca los ', 'puntos amarillos', ' que quieras'],
    tapFocused: 'Tócalo para ver su animación',
    closeHint: 'Toca la ✕ para cerrar',
    narrationPlay: 'Escuchar narración',
    narrationStop: 'Detener narración',
    closeCard: 'Cerrar la ficha',
    closeText: 'Cerrar el texto',
    mapText: 'Texto del mapa',
    instagramHint: ['Toca un ', '@', ' para ver su Instagram'],
    openMenu: 'Abrir el menú',
    showGuide: 'Volver a mostrar la guía',
    sound: 'Sonido',
    volume: 'Volumen',
    mute: 'Silenciar',
    unmute: 'Activar el sonido',
    language: 'Idioma',
    retry: 'Reintentar',
    menuStory: 'Historia',
    menuSocial: 'Redes sociales',
    menuSoon: 'Próximamente',
  },
  en: {
    hints: {
      idle: 'Getting the experience ready…',
      preparing: 'Setting up the scene…',
      searching: 'Point your camera at the Nuquí map',
      tracking: 'Tap an animal to meet it',
      lost: 'The map is out of frame. Point at it again',
      error: 'Something went wrong',
    },
    errors: {
      'unsupported-device': 'This browser can’t run the AR experience. On iPhone use Safari; on Android, Chrome.',
      'camera-denied': 'No camera access. Turn it on in your browser settings and tap Retry.',
      'model-not-found': 'The animals couldn’t be loaded. Tap Retry.',
      unknown: 'Something went wrong. Tap Retry.',
    },
    bootLoading: 'Loading the animals…',
    bootCamera: 'Turning on the camera…',
    start: 'Start AR experience',
    guideTitle: 'Point at the Nuquí map',
    guideMission: ['and discover the ', '5 animals', ' hiding in it'],
    tapAnimalTitle: 'Tap an animal',
    tapAnimal: ['Tap the ', 'golden outline', ' to meet it'],
    tapAnotherTitle: 'Tap another animal',
    remaining: (count) => ['', count === 1 ? '1 more' : `${count} more`, ' to meet'],
    tapTextTitle: 'Tap a yellow dot',
    tapText: ['Each one tells you something about the ', 'Chocó', ''],
    exploreTitle: 'Explore the rest of Nuquí',
    explore: ['Tap any of the ', 'yellow dots', ' you like'],
    tapFocused: 'Tap it to see it move',
    closeHint: 'Tap the ✕ to close',
    narrationPlay: 'Listen to the story',
    narrationStop: 'Stop the story',
    closeCard: 'Close the card',
    closeText: 'Close the text',
    mapText: 'Map text',
    instagramHint: ['Tap an ', '@', ' to see their Instagram'],
    openMenu: 'Open the menu',
    showGuide: 'Show the guide again',
    sound: 'Sound',
    volume: 'Volume',
    mute: 'Mute',
    unmute: 'Turn sound on',
    language: 'Language',
    retry: 'Retry',
    menuStory: 'Story',
    menuSocial: 'Social media',
    menuSoon: 'Coming soon',
  },
};

/** Pinta un texto con su parte destacada, con nodos (sin HTML). */
export function writeRich(element: HTMLElement, [before, strong, after]: Rich): void {
  const emphasis = element.ownerDocument.createElement('strong');
  emphasis.textContent = strong;
  element.replaceChildren(before, emphasis, after);
}
