/**
 * Weather ambience — looping wind and one-shot thunder, generated with
 * WebAudio so it ships with zero assets (like music.ts). Wind is gently
 * gusting filtered noise; thunder is a low rumble with a sharp crack.
 * Start from a user gesture (autoplay policy) — begins on the first tap.
 */
type Win = Window & { webkitAudioContext?: typeof AudioContext };

class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private gust: ReturnType<typeof setInterval> | null = null;
  private windOn = false;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** A couple of seconds of white noise we loop for wind and reuse for thunder. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** Turn the looping wind on or off (idempotent). */
  setWind(on: boolean): void {
    if (on === this.windOn) return;
    this.windOn = on;
    if (on) this.startWind();
    else this.stopWind();
  }

  private startWind(): void {
    const ctx = this.ensure();
    const master = this.master;
    if (!ctx || !master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(lp).connect(g).connect(master);
    src.start();
    g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.2);
    this.windSrc = src;
    this.windGain = g;
    // Gusts: drift the gain up and down so it breathes.
    this.gust = setInterval(() => {
      const c = this.ctx;
      if (!c || !this.windGain) return;
      const target = 0.03 + Math.random() * 0.08;
      this.windGain.gain.linearRampToValueAtTime(target, c.currentTime + 1.5 + Math.random());
    }, 1800);
  }

  private stopWind(): void {
    if (this.gust) clearInterval(this.gust);
    this.gust = null;
    const ctx = this.ctx;
    const g = this.windGain;
    const src = this.windSrc;
    this.windGain = null;
    this.windSrc = null;
    if (ctx && g) g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    if (src) {
      try {
        src.stop(ctx ? ctx.currentTime + 0.9 : undefined);
      } catch {
        /* already stopped */
      }
    }
  }

  /** One thunder clap: a low rumble plus a brighter initial crack. */
  thunder(): void {
    const ctx = this.ensure();
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    // Rumble — noise through a low lowpass with a long decay.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t0);
    lp.frequency.exponentialRampToValueAtTime(90, t0 + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.45, t0 + 0.04); // sharp crack
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8); // long rumble
    src.connect(lp).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + 1.9);
  }

  stop(): void {
    this.setWind(false);
  }
}

export const ambience = new Ambience();
