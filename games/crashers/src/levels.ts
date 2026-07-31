/**
 * 🗺 The fifteen stages, as data.
 *
 * A beat-'em-up campaign is remarkably regular: walk right, a gate closes,
 * fight what appears, walk on, meet a boss. Once that shape lives in the
 * engine's WaveRunner, a whole level is just a description — where the gates
 * are, who is behind each one, and what the place looks like.
 *
 * Writing them as a table rather than fifteen scene files is what makes the
 * campaign editable: difficulty is a column you can read down, and adding a
 * stage is adding a row. Nothing here knows how to draw or fight; it only
 * says what the level contains.
 */

import type { WaveSpec } from '@interverse/engine';

/** Enemy archetypes. The stage says who; enemies.ts says what they do. */
export type FoeId = 'grunt' | 'archer' | 'brute' | 'shaman' | 'howler' | 'boss';

export interface Biome {
  /** Sky/backdrop above the horizon. */
  sky: number;
  /** The ground band the fight happens on. */
  ground: number;
  /** Scenery colour — trees, pillars, crystals, whatever the theme is. */
  prop: number;
  /** What the scenery is shaped like. */
  propKind: 'tree' | 'pillar' | 'crystal' | 'crate' | 'torch';
}

export const BIOMES: Record<string, Biome> = {
  meadow: { sky: 0x7fc6e8, ground: 0x4f8f52, prop: 0x2e5d38, propKind: 'tree' },
  forest: { sky: 0x2f5d52, ground: 0x39633f, prop: 0x1f4429, propKind: 'tree' },
  keep: { sky: 0x4a4763, ground: 0x6b6478, prop: 0x8d8d99, propKind: 'pillar' },
  cavern: { sky: 0x241d33, ground: 0x3b3350, prop: 0x8a6fd0, propKind: 'crystal' },
  frost: { sky: 0x9fc9e8, ground: 0xcfe2ef, prop: 0x7fa9c6, propKind: 'crystal' },
  ember: { sky: 0x4a1f22, ground: 0x6b3128, prop: 0xd9622b, propKind: 'torch' },
  docks: { sky: 0x2c4a6b, ground: 0x6b5a3f, prop: 0x4a3826, propKind: 'crate' },
  throne: { sky: 0x1a1226, ground: 0x3a2b4d, prop: 0xffd166, propKind: 'torch' },
};

export interface Stage {
  /** 1-based, and the order they are played in. */
  n: number;
  name: string;
  biome: keyof typeof BIOMES;
  /** How long the stage is, in design units. One screen is 1280 wide. */
  length: number;
  /** Each gate: how many of which foes. */
  gates: { foes: Partial<Record<FoeId, number>>; banner?: string }[];
  /** The stage ends on a boss fight. */
  boss?: { foe: FoeId; name: string; hp: number };
  /** Scales every enemy's health and damage — the difficulty column. */
  tier: number;
}

/**
 * Fifteen stages in five acts of three, each act ending on a boss.
 *
 * The curve is deliberate: act one teaches one enemy at a time, act two adds
 * range so you cannot stand still, act three adds armour so you have to use
 * the launcher, act four crowds you, and act five combines everything. Foe
 * counts stay modest because the stage is a phone screen — six enemies at
 * once is a scrum, twelve is a smear.
 */
export const STAGES: readonly Stage[] = [
  {
    n: 1, name: 'Sunny Meadow', biome: 'meadow', length: 3400, tier: 1,
    gates: [{ foes: { grunt: 2 } }, { foes: { grunt: 3 }, banner: 'AMBUSH!' }],
  },
  {
    n: 2, name: 'Old Road', biome: 'meadow', length: 3800, tier: 1,
    gates: [{ foes: { grunt: 3 } }, { foes: { grunt: 2, archer: 1 }, banner: 'ARCHERS!' }, { foes: { grunt: 4 } }],
  },
  {
    n: 3, name: 'Bandit Camp', biome: 'forest', length: 4000, tier: 2,
    gates: [{ foes: { grunt: 3, archer: 1 } }, { foes: { grunt: 3, archer: 2 } }],
    boss: { foe: 'boss', name: 'Bramble the Bandit', hp: 42 },
  },
  {
    n: 4, name: 'Deep Wood', biome: 'forest', length: 4200, tier: 2,
    gates: [{ foes: { grunt: 4 } }, { foes: { archer: 3 }, banner: 'TAKE COVER!' }, { foes: { grunt: 3, brute: 1 } }],
  },
  {
    n: 5, name: 'Broken Bridge', biome: 'forest', length: 3800, tier: 3,
    gates: [{ foes: { brute: 2 } }, { foes: { grunt: 4, archer: 2 } }],
  },
  {
    n: 6, name: 'Gatehouse', biome: 'keep', length: 4200, tier: 3,
    gates: [{ foes: { grunt: 4, brute: 1 } }, { foes: { archer: 3, brute: 1 } }],
    boss: { foe: 'boss', name: 'Warden Grum', hp: 70 },
  },
  {
    n: 7, name: 'Castle Halls', biome: 'keep', length: 4400, tier: 4,
    gates: [{ foes: { grunt: 5 } }, { foes: { brute: 2, archer: 2 } }, { foes: { grunt: 4, shaman: 1 }, banner: 'SHAMAN!' }],
  },
  {
    n: 8, name: 'Crystal Cavern', biome: 'cavern', length: 4400, tier: 4,
    gates: [{ foes: { shaman: 2, grunt: 3 } }, { foes: { brute: 2, shaman: 1 } }],
  },
  {
    n: 9, name: 'The Deep', biome: 'cavern', length: 4600, tier: 5,
    gates: [{ foes: { grunt: 5, archer: 2 } }, { foes: { brute: 3, shaman: 1 } }],
    boss: { foe: 'boss', name: 'Gloomfang', hp: 110 },
  },
  {
    n: 10, name: 'Frozen Pass', biome: 'frost', length: 4400, tier: 5,
    gates: [{ foes: { howler: 3 }, banner: 'HOWLERS!' }, { foes: { grunt: 4, howler: 2 } }, { foes: { brute: 2, archer: 3 } }],
  },
  {
    n: 11, name: 'Glacier Steps', biome: 'frost', length: 4600, tier: 6,
    gates: [{ foes: { howler: 4 } }, { foes: { brute: 3, shaman: 2 } }],
  },
  {
    n: 12, name: 'Ember Gate', biome: 'ember', length: 4600, tier: 6,
    gates: [{ foes: { grunt: 5, howler: 2 } }, { foes: { brute: 3, archer: 3 } }],
    boss: { foe: 'boss', name: 'Cinder Queen', hp: 150 },
  },
  {
    n: 13, name: 'Burning Docks', biome: 'docks', length: 4800, tier: 7,
    gates: [{ foes: { grunt: 6 } }, { foes: { archer: 4, shaman: 2 } }, { foes: { brute: 3, howler: 3 } }],
  },
  {
    n: 14, name: 'The Long Stair', biome: 'throne', length: 5000, tier: 8,
    gates: [{ foes: { brute: 4, shaman: 2 } }, { foes: { howler: 4, archer: 3 } }, { foes: { grunt: 6, brute: 2 }, banner: 'HOLD THE STAIR!' }],
  },
  {
    n: 15, name: 'Throne of Blobs', biome: 'throne', length: 4600, tier: 9,
    gates: [{ foes: { brute: 3, shaman: 2, howler: 2 } }, { foes: { grunt: 6, archer: 4 }, banner: 'THE LAST WAVE' }],
    boss: { foe: 'boss', name: 'The Blob King', hp: 260 },
  },
];

export function stage(n: number): Stage {
  return STAGES.find((s) => s.n === n) ?? STAGES[0]!;
}

/** Where the gates stand: spread along the stage with room to walk between
 *  them, and the last one short of the end so a boss has an arena. */
export function gateXs(s: Stage): number[] {
  const first = 1100;
  const last = s.length - (s.boss ? 1000 : 600);
  const n = s.gates.length;
  if (n === 1) return [Math.round((first + last) / 2)];
  const step = (last - first) / (n - 1);
  return s.gates.map((_, i) => Math.round(first + step * i));
}

/** Flatten a gate's `{ grunt: 3, archer: 1 }` into a spawn list. */
export function foeList(foes: Partial<Record<FoeId, number>>): FoeId[] {
  const out: FoeId[] = [];
  for (const [id, count] of Object.entries(foes)) {
    for (let i = 0; i < (count ?? 0); i++) out.push(id as FoeId);
  }
  return out;
}

/** The stage as the engine's WaveRunner wants it, boss included as the last
 *  "wave" so the whole level is one uniform sequence. */
export function wavesFor(s: Stage): WaveSpec[] {
  const xs = gateXs(s);
  const waves: WaveSpec[] = s.gates.map((g, i) => {
    const spec: WaveSpec = { atX: xs[i]!, enemies: foeList(g.foes) };
    if (g.banner) spec.banner = g.banner;
    return spec;
  });
  if (s.boss) {
    waves.push({ atX: s.length - 500, enemies: [s.boss.foe], banner: s.boss.name.toUpperCase() });
  }
  return waves;
}

/** Every enemy in a stage, for "how much XP is this worth" and for the map
 *  screen's difficulty pips. */
export function foeCount(s: Stage): number {
  return s.gates.reduce((n, g) => n + foeList(g.foes).length, 0) + (s.boss ? 1 : 0);
}
