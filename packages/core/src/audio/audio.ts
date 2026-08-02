/**
 * Audio (§4.8) — procedural SFX + looping chiptune MUSIC over WebAudio,
 * with mobile unlock handled internally and volume buses (master/music/
 * sfx) persisted per device. Everything is synthesized — no audio assets,
 * nothing to download (spec §8.5: <3MB stays sacred).
 */
import { createSave } from '../save/save.js';

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  /** Seconds from now to start (for little arpeggios). */
  when?: number;
}

export type MusicTrackId = 'adventure' | 'cozy' | 'battle' | 'spooky';

/** 16 eighth-note steps per loop, notes as MIDI numbers (0 = rest). */
interface MusicTrack {
  bpm: number;
  bass: number[];
  lead: number[];
  hats: boolean;
}

const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export const MUSIC_TRACKS: Record<MusicTrackId, MusicTrack> = {
  adventure: {
    bpm: 112,
    bass: [48, 0, 48, 0, 43, 0, 43, 0, 45, 0, 45, 0, 47, 0, 47, 0],
    lead: [72, 0, 76, 79, 0, 76, 72, 0, 74, 0, 77, 81, 0, 79, 77, 74],
    hats: true,
  },
  cozy: {
    bpm: 84,
    bass: [45, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 40, 0, 0, 0],
    lead: [69, 0, 72, 0, 76, 0, 72, 0, 71, 0, 67, 0, 64, 0, 67, 0],
    hats: false,
  },
  battle: {
    bpm: 140,
    bass: [40, 40, 0, 40, 43, 0, 40, 0, 38, 38, 0, 38, 46, 0, 43, 0],
    lead: [64, 0, 67, 64, 70, 67, 64, 0, 62, 0, 65, 62, 69, 0, 70, 71],
    hats: true,
  },
  spooky: {
    bpm: 90,
    bass: [38, 0, 0, 0, 0, 0, 44, 0, 37, 0, 0, 0, 0, 0, 43, 0],
    lead: [62, 0, 0, 65, 0, 0, 63, 0, 0, 68, 0, 0, 62, 0, 0, 0],
    hats: false,
  },
};

type VolumeBus = 'master' | 'music' | 'sfx';

class AudioBus {
  /** Master volume 0..1 (kept for back-compat; same as setVolume('master')). */
  volume = 0.6;
  private ctx: AudioContext | null = null;
  private unlockInstalled = false;
  private volumes: Record<VolumeBus, number> | null = null;

  private volumeStore(): Record<VolumeBus, number> {
    if (!this.volumes) {
      const save = createSave('audio');
      this.volumes = {
        master: Number(save.get('master', 1)) || 1,
        music: Number(save.get('music', 0.8)) || 0.8,
        sfx: Number(save.get('sfx', 1)) || 1,
      };
    }
    return this.volumes;
  }

  /** Per-bus volume (0..1), persisted on this device. */
  setVolume(bus: VolumeBus, v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.volumeStore()[bus] = clamped;
    createSave('audio').set(bus, clamped);
  }

  getVolume(bus: VolumeBus): number {
    return this.volumeStore()[bus];
  }

  private busGain(bus: 'music' | 'sfx'): number {
    const v = this.volumeStore();
    return v.master * v[bus];
  }

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
    g.gain.setValueAtTime(Math.max(0.0001, gain * this.volume * this.busGain('sfx')), t0);
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

  // ------------------------------------------------------------- music

  private musicId: MusicTrackId | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicNextAt = 0;
  private fanfareUntil = 0;

  private musicVoice(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = gain * this.busGain('music');
    if (g <= 0.0001) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(g, at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  /** Lookahead scheduler: fills ~0.3s of upcoming steps every tick. */
  private musicTick(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicId || ctx.state !== 'running') return;
    const track = MUSIC_TRACKS[this.musicId];
    const step = 60 / track.bpm / 2; // eighth notes
    if (this.musicNextAt < ctx.currentTime) this.musicNextAt = ctx.currentTime + 0.05;
    while (this.musicNextAt < ctx.currentTime + 0.3) {
      const at = this.musicNextAt;
      const i = this.musicStep % 16;
      if (at >= this.fanfareUntil) {
        const bass = track.bass[i]!;
        const lead = track.lead[i]!;
        if (bass > 0) this.musicVoice(midiHz(bass), at, step * 1.8, 'triangle', 0.11);
        if (lead > 0) this.musicVoice(midiHz(lead), at, step * 0.9, 'square', 0.045);
        if (track.hats && i % 2 === 0) this.musicVoice(6200, at, 0.03, 'square', 0.012);
      }
      this.musicStep++;
      this.musicNextAt += step;
    }
  }

  /** Looping chiptune BGM + RPG-Maker-style fanfares (BGM ducks, resumes). */
  readonly music = {
    play: (id: MusicTrackId): void => {
      if (!(id in MUSIC_TRACKS)) return;
      this.musicId = id;
      this.musicStep = 0;
      this.musicNextAt = 0;
      if (!this.musicTimer && typeof setInterval !== 'undefined') {
        this.musicTimer = setInterval(() => this.musicTick(), 100);
      }
    },
    stop: (): void => {
      this.musicId = null;
      if (this.musicTimer) {
        clearInterval(this.musicTimer);
        this.musicTimer = null;
      }
    },
    current: (): MusicTrackId | null => this.musicId,
    /** Victory jingle — the BGM steps aside and resumes after (RM's ME). */
    fanfare: (): void => {
      const ctx = this.ensure();
      const now = ctx?.currentTime ?? 0;
      this.fanfareUntil = now + 1.1;
      const g = 0.14;
      [64, 68, 71, 76].forEach((m, i) => {
        if (ctx) this.musicVoice(midiHz(m), now + i * 0.14, 0.4, 'square', g);
      });
    },
  };
}

/** Shared audio bus. Mobile unlock is installed automatically by createGame(). */
export const audio = new AudioBus();
