import type { SoundProfile } from '@domain/value-objects/SoundProfile';

export interface AudioPort {
  /**
   * iOS y Chrome bloquean el audio hasta que hay un gesto del usuario.
   * Hay que llamar esto DENTRO del handler de un click/tap real.
   */
  unlock(): Promise<void>;

  /** Timbre sintetizado: el respaldo de un animal sin grabaciones. */
  play(profile: SoundProfile): void;
  /**
   * Descarga y decodifica grabaciones por adelantado. Sin garantías: lo que
   * no llegue a tiempo se descarga al reproducirlo.
   */
  preload(urls: readonly string[]): void;
  /**
   * Una grabación, una vez, a `volume` (0–1, por defecto 1). Si tarda
   * demasiado en llegar, no suena: tarde confunde. `owner`: de quién es
   * (el id del animal), para poder apagar luego los de otros
   * (`fadeOutClips`).
   */
  playClip(url: string, volume?: number, owner?: string): void;
  /**
   * Apaga con un fundido suave las grabaciones que estén sonando y NO sean
   * de `keep` (todas, con null). Lo que se apaga no corta en seco: baja en
   * algo más de un segundo, como cuando un sonido se aleja.
   */
  fadeOutClips(keep: string | null): void;
  /**
   * Ambiente en bucle y sin costuras. Sustituye con un fundido al que
   * estuviera sonando; con la misma ruta, no hace nada.
   */
  startAmbience(url: string): void;
  /** Apaga el ambiente con un fundido. */
  stopAmbience(): void;
  /**
   * Un trozo de narración, por delante de todo y con el ambiente más bajo
   * mientras habla. Resuelve `true` si acabó de sonar, `false` si se cortó
   * (`stopVoice`) o no se pudo cargar: quien encadena trozos solo sigue con
   * `true`. Nunca se descarta por llegar tarde, a diferencia de un toque.
   */
  playVoice(url: string, fromSeconds?: number): Promise<boolean>;
  /**
   * Por qué segundo va el trozo de narración que suena, o null si no suena
   * ninguno (cargando, en una pausa, callada). Sirve para seguir en la misma
   * frase al cambiar de idioma.
   */
  voicePosition(): number | null;
  /** Corta la narración con un fundido corto. */
  stopVoice(): void;
  /**
   * Volumen general, 0–1, con un fundido corto. Lo mueve el usuario desde el
   * menú; 0 es silencio. No corta nada: con el volumen a 0 la narración y el
   * ambiente siguen su curso, y al subirlo se oyen donde van.
   */
  setVolume(level: number): void;

  dispose(): void;
}
