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
  wood: 0x4a3826,
  woodDark: 0x241a10,
  leaf: 0x2f5d3a,
  leafDark: 0x1e3f28,
  pot: 0x7a4a35,
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

/** Per-map ambience: each manor hums its own chord. notes are
 *  [freq, detune, gain]; trem is the breathing speed. */
interface DroneMood {
  name: string;
  notes: readonly (readonly [number, number, number])[];
  trem: number;
}
const MOODS: readonly DroneMood[] = [
  // Hollow Manor — the classic warm A drone (root/fifth/octave).
  { name: 'manor', notes: [[55, -6, 0.5], [82.4, 5, 0.5], [110, 0, 0.4]], trem: 0.08 },
  // Ashen Asylum — hollow fifths a step up, with a nervous flicker.
  { name: 'asylum', notes: [[73.4, -4, 0.45], [110, 3, 0.4], [146.8, -2, 0.28]], trem: 0.16 },
  // The Cellars — a sub-bass E rubbed against F: slow, oppressive beating.
  { name: 'cellars', notes: [[41.2, -3, 0.6], [43.7, 4, 0.35], [82.4, 0, 0.25]], trem: 0.05 },
  // Grand Estate — a stately C-minor sigh, almost music.
  { name: 'estate', notes: [[65.4, -4, 0.45], [98, 2, 0.4], [155.6, -3, 0.24]], trem: 0.06 },
  // Blackwood Keep — a tritone under the floorboards, pulsing faster.
  { name: 'keep', notes: [[49, -5, 0.5], [69.3, 4, 0.45], [98, -6, 0.3]], trem: 0.22 },
];
let moodIdx = 0;
let droneNodes: OscillatorNode[] = [];

/** Start the sustained ambient bed for the current mood. */
function startDrone(): void {
  if (!ctx || !master || droneGain) return;
  droneGain = ctx.createGain();
  droneGain.gain.value = musicOn ? 0.14 : 0;
  droneGain.connect(master);
  const mood = MOODS[moodIdx] ?? MOODS[0]!;
  for (const [freq, detune, vol] of mood.notes) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = vol;
    // Tremolo so the drone breathes — each mood at its own pace.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = mood.trem * (0.8 + Math.random() * 0.5);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = vol * 0.5;
    lfo.connect(lfoGain).connect(g.gain);
    o.connect(g).connect(droneGain);
    o.start();
    lfo.start();
    droneNodes.push(o, lfo);
  }
}

/** Switch the ambient bed to a map's mood (index into MOODS; wraps). The
 *  menu/lobby live on mood 0. No-op until audio is unlocked. */
export function setDroneMood(i: number): void {
  const next = ((Math.floor(i) % MOODS.length) + MOODS.length) % MOODS.length;
  if (next === moodIdx) return;
  moodIdx = next;
  if (!droneGain) return; // not started yet — unlock will pick this mood up
  for (const n of droneNodes) {
    try {
      n.stop();
    } catch {
      /* already stopped */
    }
  }
  droneNodes = [];
  droneGain.disconnect();
  droneGain = null;
  startDrone();
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

// Sound effects (stingers) — separate switch from the ambient music bed.
let sfxOn = true;
export function setSfx(on: boolean): void {
  sfxOn = on;
}
export function sfxEnabled(): boolean {
  return sfxOn;
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
  if (!sfxOn) return;
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
