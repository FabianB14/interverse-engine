/**
 * Audio (§4.8) — procedural SFX over WebAudio with mobile unlock handled
 * internally. No audio assets exist yet; Howler.js integration for real
 * music/SFX files arrives when a game ships some.
 */

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  /** Seconds from now to start (for little arpeggios). */
  when?: number;
}

class AudioBus {
  /** Master volume 0..1. */
  volume = 0.6;
  private ctx: AudioContext | null = null;
  private unlockInstalled = false;

  /**
   * Install a gesture hook that unlocks audio on mobile. Called
   * automatically by createGame(); safe to call more than once.
   */
  installUnlock(): void {
    if (this.unlockInstalled || typeof window === 'undefined') return;
    this.unlockInstalled = true;
    window.addEventListener(
      'pointerdown',
      () => {
        this.ensure();
      },
      { passive: true },
    );
  }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freqFrom: number, freqTo: number, duration: number, opts: ToneOptions = {}): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const { type = 'triangle', gain = 0.2, when = 0 } = opts;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freqFrom), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + duration);
    g.gain.setValueAtTime(Math.max(0.0001, gain * this.volume), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Bubbly tap-hit. Higher pitch = smaller/squeakier. */
  pop(pitch = 1): void {
    this.tone(520 * pitch, 140 * pitch, 0.12, { type: 'square', gain: 0.12 });
  }

  /** Short bright UI blip. */
  blip(pitch = 1): void {
    this.tone(700 * pitch, 1100 * pitch, 0.08, { type: 'sine', gain: 0.12 });
  }

  /** Little victory arpeggio. */
  chime(): void {
    this.tone(660, 660, 0.12, { type: 'sine', gain: 0.14 });
    this.tone(880, 880, 0.12, { type: 'sine', gain: 0.14, when: 0.09 });
    this.tone(1320, 1320, 0.22, { type: 'sine', gain: 0.16, when: 0.18 });
  }

  /** Round-over buzzer. */
  buzz(): void {
    this.tone(220, 90, 0.4, { type: 'sawtooth', gain: 0.1 });
  }
}

/** Shared audio bus. Mobile unlock is installed automatically by createGame(). */
export const audio = new AudioBus();
