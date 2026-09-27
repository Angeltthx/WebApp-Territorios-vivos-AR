import type { AudioPort } from '@application/ports/AudioPort';
import type { SoundProfile } from '@domain/value-objects/SoundProfile';

/**
 * Síntesis en tiempo real con Web Audio. Sin archivos de audio: nada que
 * licenciar, descargar ni cachear, y el bundle no crece ni un byte.
 *
 * Nota sobre iOS: Safari crea el AudioContext en estado "suspended" y solo
 * lo deja arrancar dentro de un gesto del usuario. Por eso unlock() debe
 * llamarse desde el handler del botón, no en el arranque de la app.
 */
interface Ambience {
  readonly url: string;
  readonly gain: GainNode;
  readonly sources: AudioBufferSourceNode[];
  timer: number | null;
}

/**
 * NIVELES, sobre archivos ya igualados en build-audio (−16 LUFS voces,
 * llamadas, toques y chapuzones; −24 LUFS ambientes).
 *
 * Segunda bajada ("el sonido está algo alto, que sea estándar: ni muy bajo
 * ni ensordecedor"). La referencia es la de la voz hablada en el móvil: la
 * narración, que es lo más alto que suena de forma sostenida, queda en
 * torno a −22 LUFS (0.55 del bus × 0.9 del maestro ≈ −6 dB sobre −16), y
 * todo lo demás se ordena por debajo de ella. Antes estaba a 0.9 sin
 * maestro (≈ −17 LUFS), casi a nivel de anuncio.
 *
 *   - voz        0.55  → ≈ −22 LUFS: se entiende con el teléfono en la mano.
 *   - animales   0.4   → ≈ −25 LUFS: presentes, 3 dB por debajo de la voz.
 *   - ambiente   0.3   → ≈ −35 LUFS: se nota si se escucha, no se impone.
 *
 * Lo que de verdad ensordecía no era el nivel medio sino los PICOS: el
 * chapuzón de la ballena encima de la voz y el ambiente sumados. El bus
 * maestro lleva un compresor que los frena (`MASTER_*`).
 *
 * Cambiar el volumen se hace AQUÍ, no en build-audio: así todos los archivos
 * siguen igualados a la misma referencia.
 */
const CLIPS_GAIN = 0.4;
/** El ambiente acompaña, no compite: bastante por debajo de la voz. */
const AMBIENCE_GAIN = 0.3;
/**
 * La narración va por delante de todo: es lo que hay que entender. Y
 * mientras habla, el ambiente baja a un 40 % para que no la tape.
 */
const VOICE_GAIN = 0.55;
/**
 * Bus maestro: una ganancia general y un compresor suave que actúa de
 * limitador. Por debajo de −18 dBFS no toca nada; por encima, comprime 4:1,
 * así que un chapuzón que llega de golpe no salta por encima del resto.
 */
const MASTER_GAIN = 0.9;
const MASTER_THRESHOLD_DB = -18;
const MASTER_KNEE_DB = 8;
const MASTER_RATIO = 4;
const AMBIENCE_UNDER_VOICE = 0.4;
const DUCK_S = 0.4;
const VOICE_STOP_S = 0.25;
const AMBIENCE_FADE_S = 1.2;
const AMBIENCE_CROSSFADE_S = 3;
const CLIP_MAX_DELAY_S = 1.5;

interface Voice {
  /** null mientras el trozo se descarga. */
  source: AudioBufferSourceNode | null;
  readonly gain: GainNode;
  readonly finish: (ended: boolean) => void;
}

/** Curvas de potencia constante para el fundido cruzado del ambiente. */
const FADE_IN = Float32Array.from({ length: 32 }, (_, i) => Math.sin((i / 31) * Math.PI / 2));
const FADE_OUT = Float32Array.from({ length: 32 }, (_, i) => Math.cos((i / 31) * Math.PI / 2));

export class WebAudioAdapter implements AudioPort {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly buses = new Map<string, GainNode>();
  private ambience: Ambience | null = null;
  /** El trozo de narración que suena, y cómo avisar de que se cortó. */
  private voice: Voice | null = null;
  /** Volumen general que ha elegido el usuario (menú), 0–1. */
  private volume = 1;

  async unlock(): Promise<void> {
    this.claimPlaybackSession();

    const context = this.ensureContext();
    if (context === null) return;
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('[WebAudioAdapter] No se pudo reanudar el AudioContext', error);
      }
    }
  }

  play(profile: SoundProfile): void {
    // El toque es otro gesto válido en iOS y recupera la categoría playback
    // si Safari la perdió al volver desde segundo plano.
    this.claimPlaybackSession();
    const context = this.ensureContext();
    if (context === null) return;

    // Un contexto dormido NO es motivo para tragarse el sonido. iOS lo
    // suspende al volver de segundo plano y Chrome lo hace tras un rato
    // sin reproducir nada; antes esto salía por un `return` silencioso y
    // el toque respondía en pantalla sin que se oyera nada, que es la peor
    // forma de fallar porque no deja rastro. Se le pide que despierte y se
    // programa el sonido igual: mientras está suspendido el reloj del
    // contexto no avanza, así que la envolvente arranca entera al volver.
    if (context.state !== 'running') {
      console.warn(`[WebAudioAdapter] AudioContext en "${context.state}"; reanudando`);
      void context.resume().catch((error: unknown) => {
        console.warn('[WebAudioAdapter] El navegador no dejó reanudar el audio', error);
      });
    }

    const now = context.currentTime;
    const duration = profile.durationSeconds;

    const master = context.createGain();
    master.connect(this.output(context));

    // Envolvente percusiva: ataque muy corto y caída exponencial.
    // Una caída lineal suena artificial; la exponencial imita cómo se
    // disipa la energía en un objeto físico.
    //
    // PEAK es el pico del bus con los armónicos YA sumados. Los pesos se
    // normalizan más abajo para que sea así de verdad: sin normalizar, un
    // timbre de tres armónicos sonaba casi el doble de fuerte que uno de
    // uno solo, y el volumen dependía de cuántos ratios tuviera el perfil
    // en vez de decidirlo aquí.
    const PEAK = 0.65;

    // El suelo de la caída NO puede ser ~0. Una rampa exponencial de 0.65 a
    // 0.0001 recorre cuatro décadas: a mitad de camino ya va por 0.008, o
    // sea inaudible. Con `durationMs` de 220 ms eso dejaba unos 20 ms de
    // sonido real y el toque parecía mudo. Cayendo a un 4% del pico (-28 dB)
    // la mitad del recorrido queda en un 20% del pico, que sí se oye, y el
    // perfil sigue durando lo que dice el dominio.
    const FLOOR = PEAK * 0.04;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(PEAK, now + 0.008);
    master.gain.exponentialRampToValueAtTime(FLOOR, now + duration);
    // Cierre lineal hasta el silencio: cortar en FLOOR se oiría como un clic.
    master.gain.linearRampToValueAtTime(0.0001, now + duration + 0.03);

    // Los armónicos agudos pesan menos que la fundamental (1, 1/2, 1/3…),
    // que es lo que hace que suene a instrumento y no a pitido.
    const weights = profile.overtoneRatios.map((_, index) => 1 / (index + 1));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    const oscillators: OscillatorNode[] = [];
    const partials: GainNode[] = [];

    profile.overtoneRatios.forEach((ratio, index) => {
      const frequency = profile.rootFrequencyHz * ratio;
      if (frequency > 18000) return; // fuera del rango audible útil

      const oscillator = context.createOscillator();
      oscillator.type = profile.waveform;
      oscillator.frequency.setValueAtTime(frequency, now);

      // Los armónicos agudos se apagan antes que la fundamental, igual que
      // en un instrumento real. Se atenúan hasta un 10% de su peso, no
      // hasta cero: esta caída se MULTIPLICA por la del bus, y dos
      // exponenciales encadenadas apagaban el sonido en un suspiro.
      const partial = context.createGain();
      partials.push(partial);
      const weight = weights[index]! / totalWeight;
      const partialDuration = Math.max(0.05, duration * (1 - index * 0.12));
      partial.gain.setValueAtTime(weight, now);
      partial.gain.exponentialRampToValueAtTime(weight * 0.1, now + partialDuration);

      oscillator.connect(partial);
      partial.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.06);
      oscillators.push(oscillator);
    });

    const last = oscillators[oscillators.length - 1];
    if (last !== undefined) {
      last.onended = () => {
        oscillators.forEach((oscillator) => oscillator.disconnect());
        partials.forEach((partial) => partial.disconnect());
        master.disconnect();
      };
    } else {
      master.disconnect();
    }
  }

  preload(urls: readonly string[]): void {
    // Una a una, no todas a la vez: en un gama media, veinte descargas en
    // paralelo compiten con el seguimiento por la red y la CPU.
    void urls.reduce<Promise<unknown>>((chain, url) => chain.then(() => this.load(url)), Promise.resolve());
  }

  playClip(url: string, volume = 1): void {
    const context = this.ensureRunning();
    if (context === null) return;
    const requested = context.currentTime;
    void this.load(url).then((buffer) => {
      if (buffer === null || this.context !== context) return;
      // Un toque que suena un segundo después ya no parece suyo.
      if (context.currentTime - requested > CLIP_MAX_DELAY_S) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const bus = this.bus(context, 'clips');
      if (volume >= 1) {
        source.connect(bus);
        source.onended = () => source.disconnect();
      } else {
        const gain = context.createGain();
        gain.gain.value = Math.max(0, volume);
        source.connect(gain).connect(bus);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
        };
      }
      source.start();
    });
  }

  playVoice(url: string): Promise<boolean> {
    this.stopVoice();
    const context = this.ensureRunning();
    if (context === null) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ended: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ended);
      };
      // Se registra ya, antes de cargar: así se sabe si, mientras cargaba,
      // otra voz o un stop la dejaron fuera.
      const pending: Voice = { source: null, gain: context.createGain(), finish };
      this.voice = pending;
      void this.load(url).then((buffer) => {
        if (this.voice !== pending || this.context !== context) return finish(false);
        if (buffer === null) {
          this.voice = null;
          return finish(false);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        pending.source = source;
        source.connect(pending.gain).connect(this.bus(context, 'voice'));
        this.duckAmbience(context, true);
        source.onended = () => {
          source.disconnect();
          pending.gain.disconnect();
          if (this.voice === pending) {
            this.voice = null;
            this.duckAmbience(context, false);
          }
          finish(true);
        };
        source.start();
      });
    });
  }

  setVolume(level: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 1));
    const master = this.buses.get('master');
    const context = this.context;
    if (master === undefined || context === null) return;
    master.gain.cancelScheduledValues(context.currentTime);
    // Con el audio dormido su reloj no avanza y un fundido no llegaría nunca:
    // se fija directamente, que no suena nada que pueda chasquear.
    if (context.state !== 'running') {
      master.gain.value = MASTER_GAIN * this.volume;
      return;
    }
    // Un fundido de unas centésimas: un salto seco de ganancia chasquea.
    master.gain.setTargetAtTime(MASTER_GAIN * this.volume, context.currentTime, 0.03);
  }

  stopVoice(): void {
    const voice = this.voice;
    if (voice === null) return;
    this.voice = null;
    const context = this.context;
    voice.finish(false);
    if (context === null) return;
    this.duckAmbience(context, false);
    const source = voice.source;
    // Todavía cargando: no hay nada que apagar.
    if (source === null) return;
    const now = context.currentTime;
    source.onended = () => {
      source.disconnect();
      voice.gain.disconnect();
    };
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + VOICE_STOP_S);
    source.stop(now + VOICE_STOP_S + 0.02);
  }

  /** Baja el ambiente mientras habla la narración, y lo devuelve al acabar. */
  private duckAmbience(context: AudioContext, under: boolean): void {
    const bus = this.bus(context, 'ambience');
    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(AMBIENCE_GAIN * (under ? AMBIENCE_UNDER_VOICE : 1), now + (under ? DUCK_S : DUCK_S * 2));
  }

  startAmbience(url: string): void {
    if (this.ambience?.url === url) return;
    this.stopAmbience();
    const context = this.ensureRunning();
    if (context === null) return;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + AMBIENCE_FADE_S);
    gain.connect(this.bus(context, 'ambience'));
    const ambience: Ambience = { url, gain, sources: [], timer: null };
    this.ambience = ambience;

    void this.load(url).then((buffer) => {
      if (buffer === null || this.ambience !== ambience || this.context !== context) return;
      this.loopLayer(context, ambience, buffer, context.currentTime + 0.05);
    });
  }

  stopAmbience(): void {
    const ambience = this.ambience;
    if (ambience === null) return;
    this.ambience = null;
    if (ambience.timer !== null) window.clearTimeout(ambience.timer);
    const context = this.context;
    if (context === null) return;
    const now = context.currentTime;
    ambience.gain.gain.cancelScheduledValues(now);
    ambience.gain.gain.setValueAtTime(ambience.gain.gain.value, now);
    ambience.gain.gain.linearRampToValueAtTime(0, now + AMBIENCE_FADE_S);
    for (const source of ambience.sources) {
      try {
        source.stop(now + AMBIENCE_FADE_S + 0.05);
      } catch {
        // Ya parada: nada que hacer.
      }
    }
    window.setTimeout(() => ambience.gain.disconnect(), (AMBIENCE_FADE_S + 0.2) * 1000);
  }

  dispose(): void {
    this.stopVoice();
    this.stopAmbience();
    void this.context?.close();
    this.context = null;
    this.buffers.clear();
    this.buses.clear();
  }

  /**
   * Una vuelta del ambiente, que se solapa con la siguiente.
   *
   * Un `loop = true` deja una costura audible donde el final empalma con
   * el principio: son trozos de grabaciones de campo, no bucles hechos para
   * encajar. Aquí cada vuelta entra y sale con un fundido de potencia
   * constante (seno/coseno) y la siguiente empieza mientras la anterior se
   * va, así que la unión no se oye. Con fundidos lineales el volumen caía
   * unos 3 dB en cada empalme, justo lo que el oído detecta en un rumor
   * continuo como el mar.
   */
  private loopLayer(context: AudioContext, ambience: Ambience, buffer: AudioBuffer, when: number): void {
    const fade = Math.min(AMBIENCE_CROSSFADE_S, buffer.duration / 4);
    const end = when + buffer.duration;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const layer = context.createGain();
    // Sin setValueAtTime previo: una curva no puede compartir instante con
    // otro evento de automatización, y la de entrada ya empieza en 0.
    layer.gain.value = 0;
    layer.gain.setValueCurveAtTime(FADE_IN, when, fade);
    layer.gain.setValueCurveAtTime(FADE_OUT, end - fade, fade);
    source.connect(layer);
    layer.connect(ambience.gain);
    source.onended = () => {
      source.disconnect();
      layer.disconnect();
      const index = ambience.sources.indexOf(source);
      if (index >= 0) ambience.sources.splice(index, 1);
    };
    source.start(when);
    source.stop(end);
    ambience.sources.push(source);

    const next = end - fade;
    // Se programa la siguiente con un segundo de margen: un temporizador
    // de JavaScript no es puntual, el reloj de audio sí.
    ambience.timer = window.setTimeout(() => {
      if (this.ambience === ambience) this.loopLayer(context, ambience, buffer, next);
    }, Math.max(0, (next - context.currentTime - 1) * 1000));
  }

  private load(url: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(url);
    if (cached !== undefined) return cached;
    const context = this.ensureContext();
    if (context === null) return Promise.resolve(null);
    const loading = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      // La forma con callbacks: Safari antiguo no devuelve promesa.
      .then((data) => new Promise<AudioBuffer>((resolve, reject) => {
        void context.decodeAudioData(data, resolve, reject);
      }))
      .catch((error: unknown) => {
        console.warn(`[WebAudioAdapter] No se pudo cargar ${url}`, error);
        this.buffers.delete(url);
        return null;
      });
    this.buffers.set(url, loading);
    return loading;
  }

  /**
   * Tres buses con su volumen: la narración delante, los sonidos de los
   * animales después y el ambiente detrás.
   * Los archivos ya vienen igualados en sonoridad (ver build-audio), así
   * que el equilibrio entre ambos se decide aquí y en ningún otro sitio.
   */
  private bus(context: AudioContext, name: 'clips' | 'ambience' | 'voice'): GainNode {
    const existing = this.buses.get(name);
    if (existing !== undefined) return existing;
    const bus = context.createGain();
    bus.gain.value = name === 'clips' ? CLIPS_GAIN : name === 'voice' ? VOICE_GAIN : AMBIENCE_GAIN;
    bus.connect(this.output(context));
    this.buses.set(name, bus);
    return bus;
  }

  /** La salida común de todo: ganancia general y compresor (ver MASTER_*). */
  private output(context: AudioContext): AudioNode {
    const existing = this.buses.get('master');
    if (existing !== undefined) return existing;
    const master = context.createGain();
    master.gain.value = MASTER_GAIN * this.volume;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = MASTER_THRESHOLD_DB;
    limiter.knee.value = MASTER_KNEE_DB;
    limiter.ratio.value = MASTER_RATIO;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(context.destination);
    this.buses.set('master', master);
    return master;
  }

  private ensureRunning(): AudioContext | null {
    this.claimPlaybackSession();
    const context = this.ensureContext();
    if (context === null) return null;
    if (context.state !== 'running') {
      void context.resume().catch((error: unknown) => {
        console.warn('[WebAudioAdapter] El navegador no dejó reanudar el audio', error);
      });
    }
    return context;
  }

  /**
   * En iPhone, el INTERRUPTOR DE SILENCIO lateral calla el audio de la Web
   * Audio API aunque el volumen esté alto y todo lo demás funcione. Es
   * comportamiento del sistema, no un fallo: por defecto Safari clasifica
   * lo que sale de un AudioContext como sonido "de ambiente", y el ambiente
   * se calla con el interruptor. Un vídeo de YouTube sí suena porque su
   * categoría es otra.
   *
   * Safari 16.4 expone `navigator.audioSession`: declarando el tipo
   * 'playback' —"esto es contenido que el usuario ha pedido oír"— el sonido
   * pasa por encima del interruptor, que es lo que queremos aquí porque
   * sonar ES la interacción.
   *
   * Fuera de Safari la propiedad no existe y esto no hace nada. En iOS
   * anteriores a 16.4 tampoco hay forma limpia de conseguirlo: ahí el
   * interruptor manda y hay que bajarlo a mano.
   */
  private claimPlaybackSession(): void {
    const session = (navigator as { audioSession?: { type?: string } }).audioSession;
    if (session === undefined) return;
    try {
      session.type = 'playback';
    } catch (error) {
      console.warn('[WebAudioAdapter] No se pudo fijar la sesión de audio', error);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;

    // Safari antiguo solo expone la variante con prefijo.
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (Ctor === undefined) {
      console.warn('[WebAudioAdapter] Web Audio no disponible en este navegador');
      return null;
    }

    try {
      this.context = new Ctor();
    } catch (error) {
      // Crear un AudioContext puede fallar (demasiados contextos vivos, o
      // políticas del navegador). Que no suene es aceptable; que se caiga
      // la sesión de AR entera por eso, no.
      console.warn('[WebAudioAdapter] No se pudo crear el AudioContext', error);
      return null;
    }
    return this.context;
  }
}
