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
export class WebAudioAdapter implements AudioPort {
  private context: AudioContext | null = null;

  async unlock(): Promise<void> {
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
    master.connect(context.destination);

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
      last.onended = () => master.disconnect();
    } else {
      master.disconnect();
    }
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
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
