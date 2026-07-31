/**
 * 🎨 The look, and the zones you run through.
 *
 * A runner has no levels, so the only way it can feel like it is going
 * somewhere is for the scenery to change under you. Zones swap in on turns —
 * which is what makes a corner feel like a destination rather than a
 * mechanic.
 */

export interface Zone {
  name: string;
  sky: number;
  skyLow: number;
  road: number;
  roadEdge: number;
  stripe: number;
  /** Ground either side of the road. */
  verge: number;
  prop: number;
  propKind: 'pillar' | 'tree' | 'crystal' | 'torch';
}

export const ZONES: readonly Zone[] = [
  {
    name: 'Temple Steps', sky: 0x2a1f4a, skyLow: 0x6b4f8a, road: 0x8a7a5f,
    roadEdge: 0x6b5c47, stripe: 0xe8dcc0, verge: 0x3d5a3a, prop: 0xa89578, propKind: 'pillar',
  },
  {
    name: 'Jungle Run', sky: 0x1d4a3f, skyLow: 0x4f9a72, road: 0x7a6a4f,
    roadEdge: 0x5c4f3a, stripe: 0xd9e8c0, verge: 0x2a5c33, prop: 0x1f4429, propKind: 'tree',
  },
  {
    name: 'Crystal Deep', sky: 0x1a1533, skyLow: 0x4a3b8a, road: 0x3f3a5c,
    roadEdge: 0x2e2a45, stripe: 0xb08aff, verge: 0x241d3d, prop: 0x8a6fd0, propKind: 'crystal',
  },
  {
    name: 'Ember Way', sky: 0x3d1418, skyLow: 0xa8422a, road: 0x5c3428,
    roadEdge: 0x42241c, stripe: 0xffb86b, verge: 0x33191a, prop: 0xd9622b, propKind: 'torch',
  },
];

export function zone(i: number): Zone {
  return ZONES[((i % ZONES.length) + ZONES.length) % ZONES.length]!;
}

export const INK = 0xf2eff8;
export const DIM = 0x9a97b8;
export const GOLD = 0xffd166;
export const MINT = 0x8affc1;
export const ROSE = 0xff6f91;
export const NIGHT = 0x120e22;

/** The blob you are. One colour, because you are always the same blob — the
 *  hats are what make a run yours. */
export const BLOB_COLOR = 0x6ec5ff;
