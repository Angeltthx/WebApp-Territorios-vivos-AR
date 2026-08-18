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
    if (context === null || context.state !== 'running') return;

    const now = context.currentTime;
    const duration = profile.durationSeconds;

    const master = context.createGain();
    master.connect(context.destination);

    // Envolvente percusiva: ataque muy corto y caída exponencial.
    // Una caída lineal suena artificial; la exponencial imita cómo se
    // disipa la energía en un objeto físico.
    const peak = 0.28;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const oscillators: OscillatorNode[] = [];

    profile.overtoneRatios.forEach((ratio, index) => {
      const frequency = profile.rootFrequencyHz * ratio;
      if (frequency > 18000) return; // fuera del rango audible útil

      const oscillator = context.createOscillator();
      oscillator.type = profile.waveform;
      oscillator.frequency.setValueAtTime(frequency, now);

      // Los armónicos agudos se apagan antes que la fundamental,
      // igual que en un instrumento real.
      const partial = context.createGain();
      const weight = 1 / (index + 1);
      const partialDuration = Math.max(0.05, duration * (1 - index * 0.12));
      partial.gain.setValueAtTime(weight, now);
      partial.gain.exponentialRampToValueAtTime(0.0001, now + partialDuration);

      oscillator.connect(partial);
      partial.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.05);
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

    this.context = new Ctor();
    return this.context;
  }
}
