/**
 * Los idiomas de la experiencia. El español es el original —el mapa, las
 * fichas y las narraciones se hicieron en español—; el inglés es la
 * traducción, para quien llega de fuera a Nuquí.
 */
export type Language = 'es' | 'en';

export const LANGUAGES: readonly Language[] = ['es', 'en'];

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/**
 * El idioma que prefiere el usuario, a partir de los de su navegador
 * (`navigator.languages`, en orden de preferencia): el primero que sea
 * español o inglés manda. Si no hay ninguno de los dos, español, que es el
 * idioma del mapa.
 */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return 'es';
}
