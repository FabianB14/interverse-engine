/**
 * Hushfall's look and sound: one dark palette (no scattered hex) and a small
 * self-contained WebAudio engine for spooky atmosphere — a low ambient drone,
 * a terror heartbeat that quickens as the Seeker closes in, and one-shot
 * stingers (screech, down, rescue, lantern, gate, escape). The engine's own
 * `audio` singleton has no sustained tracks, so we run our own AudioContext,
 * unlocked on the first pointer gesture.
 */

/** Spooky palette — moonlit graveyard. */
export const NIGHT = {
  bg: 0x0b0a14,
  ground: 0x1a1826,
  groundAlt: 0x161422,
  path: 0x2a2740,
  wall: 0x0e0d18,
  hedge: 0x14261c,
  fog: 0x2a2a3e,
  moon: 0xd7dcff,
  ink: 0xe6e4f0,
  inkSoft: 0x9a97b8,
  blood: 0xd6335a,
  bone: 0xe8e2ee,
  ghost: 0x8fd0ff,
  lantern: 0xffd166,
  lanternLit: 0xffe9a8,
  gate: 0x8affc1,
  violet: 0xc77dff,
} as const;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let droneGain: GainNode | null = null;
let unlocked = false;
let musicOn = true;
let heartTimer = 0;
let heartRate = 0; // 0 = calm .. 1 = seeker on top of you

function ensure(): void {
  if (ctx) return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

/** Start the sustained ambient bed (two detuned low drones + a slow shimmer). */
function startDrone(): void {
  if (!ctx || !master || droneGain) return;
  droneGain = ctx.createGain();
  droneGain.gain.value = musicOn ? 0.14 : 0;
  droneGain.connect(master);
  for (const [freq, detune] of [
    [55, -6],
    [82.4, 5],
    [110, 0],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    // Slow tremolo so the drone breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08 + Math.random() * 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    lfo.connect(lfoGain).connect(g.gain);
    o.connect(g).connect(droneGain);
    o.start();
    lfo.start();
  }
}

/** Unlock audio on the first user gesture (call once from the first scene). */
export function unlockSpookAudio(): void {
  if (unlocked) return;
  const go = (): void => {
    ensure();
    if (ctx?.state === 'suspended') void ctx.resume();
    startDrone();
    unlocked = true;
    window.removeEventListener('pointerdown', go);
    window.removeEventListener('touchstart', go);
  };
  window.addEventListener('pointerdown', go, { once: false });
  window.addEventListener('touchstart', go, { once: false });
}

export function setMusic(on: boolean): void {
  musicOn = on;
  if (droneGain) droneGain.gain.value = on ? 0.14 : 0;
}
export function musicEnabled(): boolean {
  return musicOn;
}

/** Terror level 0..1 (proximity to the Seeker) — drives heartbeat tempo/volume. */
export function setTerror(level: number): void {
  heartRate = Math.max(0, Math.min(1, level));
}

/** Called every frame by the match; schedules heartbeat thumps. */
export function updateHeartbeat(dt: number): void {
  if (!ctx || !master || heartRate <= 0.02 || !musicOn) return;
  heartTimer -= dt;
  if (heartTimer <= 0) {
    // 1.1s between beats when far → 0.34s when the Seeker is on top of you.
    heartTimer = 1.1 - heartRate * 0.76;
    thump(0.09 + heartRate * 0.16, 60 + heartRate * 20);
    // The classic double-thump (lub-dub).
    window.setTimeout(() => thump(0.06 + heartRate * 0.1, 48 + heartRate * 16), 150);
  }
}

function thump(vol: number, freq: number): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(freq * 0.55, ctx.currentTime + 0.16);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + 0.22);
}

type Sting = 'screech' | 'down' | 'rescue' | 'lantern' | 'gate' | 'escape' | 'blip' | 'lose';

/** One-shot stingers. */
export function sting(kind: Sting): void {
  ensure();
  if (!ctx || !master) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  const g = ctx.createGain();
  g.connect(master);
  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0): void => {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now + at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + at + dur);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0.0001, now + at);
    gg.gain.exponentialRampToValueAtTime(vol, now + at + 0.01);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    o.connect(gg).connect(master!);
    o.start(now + at);
    o.stop(now + at + dur + 0.02);
  };
  switch (kind) {
    case 'screech':
      tone('sawtooth', 1400, 300, 0.5, 0.22);
      tone('square', 900, 200, 0.5, 0.12);
      break;
    case 'down':
      tone('sawtooth', 220, 40, 0.6, 0.28);
      break;
    case 'rescue':
      tone('sine', 440, 660, 0.18, 0.18);
      tone('sine', 660, 880, 0.2, 0.16, 0.12);
      break;
    case 'lantern':
      tone('triangle', 520, 780, 0.16, 0.16);
      tone('triangle', 780, 1040, 0.18, 0.14, 0.1);
      break;
    case 'gate':
      tone('triangle', 300, 900, 0.5, 0.2);
      break;
    case 'escape':
      tone('sine', 523, 523, 0.14, 0.18);
      tone('sine', 659, 659, 0.14, 0.18, 0.13);
      tone('sine', 784, 784, 0.26, 0.2, 0.26);
      break;
    case 'lose':
      tone('sawtooth', 200, 55, 0.9, 0.24);
      break;
    default:
      tone('square', 700, 700, 0.06, 0.1);
  }
  g.gain.value = 1;
}
