/**
 * Zen ambient music — soft, generative, calming. A slow low drone plus gentle
 * bell notes drifting across a pentatonic scale. Built on WebAudio so it ships
 * with zero assets. Start it from a user gesture (autoplay policy).
 */
type Win = Window & { webkitAudioContext?: typeof AudioContext };

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic (relaxing, no dissonance)
const ROOTS = [261.63, 293.66, 329.63]; // C4, D4, E4 — the pad wanders between

export class ZenMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rootIdx = 0;
  playing = false;

  /** Begin (or resume) the ambience. Safe to call repeatedly. */
  start(): void {
    if (this.playing) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.playing = true;
    this.startDrone();
    // A gentle note every ~1.9s, with slight human drift.
    this.timer = setInterval(() => this.pluck(), 1900);
    this.pluck();
  }

  stop(): void {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.drone) {
      try {
        this.drone.stop();
      } catch {
        /* already stopped */
      }
      this.drone = null;
    }
  }

  toggle(): boolean {
    if (this.playing) this.stop();
    else this.start();
    return this.playing;
  }

  private startDrone(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = (ROOTS[this.rootIdx] ?? 261.63) / 2; // an octave low
    g.gain.value = 0.06;
    osc.connect(g).connect(master);
    osc.start();
    this.drone = osc;
  }

  private pluck(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.playing) return;
    // Occasionally drift the pad's root for a slow harmonic change.
    if (Math.random() < 0.15) {
      this.rootIdx = Math.floor(Math.random() * ROOTS.length);
      if (this.drone) this.drone.frequency.value = (ROOTS[this.rootIdx] ?? 261.63) / 2;
    }
    const root = ROOTS[this.rootIdx] ?? 261.63;
    const semis = SCALE[Math.floor(Math.random() * SCALE.length)] ?? 0;
    const octave = Math.random() < 0.4 ? 2 : 1;
    const freq = root * Math.pow(2, semis / 12) * octave;
    const t0 = ctx.currentTime + 0.02;
    const dur = 2.6;
    // Two soft voices (sine + triangle) for a bell-like, mellow tone.
    for (const [type, gain] of [
      ['sine', 0.16],
      ['triangle', 0.05],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.25); // soft attack
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // long release
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.1);
    }
  }
}

export const music = new ZenMusic();
