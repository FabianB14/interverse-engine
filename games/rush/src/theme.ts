/**
 * 🐊 The look: a causeway through a swamp.
 *
 * A runner has no levels, so the only way it can feel like it is going
 * somewhere is for the scenery to change under you. Zones swap in on turns —
 * which is what makes a corner feel like a destination rather than a
 * mechanic.
 *
 * All four are the same swamp at different depths and hours, rather than four
 * unrelated biomes. Somewhere that gets darker and stranger the further in you
 * get is a place; a temple followed by a glacier is a slideshow.
 */

export interface Zone {
  name: string;
  sky: number;
  skyLow: number;
  /** The raised causeway you run along. */
  road: number;
  roadEdge: number;
  /** Planking and lane markings. */
  stripe: number;
  /** The water either side. */
  water: number;
  /** Slicks of algae and reflected light on it. */
  waterLight: number;
  /** Mist over the water, thickening toward the horizon. */
  mist: number;
  prop: number;
  propKind: 'cypress' | 'mangrove' | 'deadwood' | 'reeds';
}

export const ZONES: readonly Zone[] = [
  {
    name: 'Misty Bog',
    sky: 0x3d4a4a, skyLow: 0x8fa08c,
    road: 0x6b5c42, roadEdge: 0x4a3f2d, stripe: 0xb9ad8a,
    water: 0x33463c, waterLight: 0x5c7a5e, mist: 0xc8d6c4,
    prop: 0x4a5c42, propKind: 'cypress',
  },
  {
    name: 'Cypress Deep',
    sky: 0x22332c, skyLow: 0x4a6b4f,
    road: 0x5c4f38, roadEdge: 0x3d3325, stripe: 0xa89a72,
    water: 0x1f3329, waterLight: 0x3f6b4a, mist: 0x86a389,
    prop: 0x2a3d28, propKind: 'mangrove',
  },
  {
    name: 'Sunken Ruins',
    sky: 0x1e3542, skyLow: 0x3f6b72,
    road: 0x55564a, roadEdge: 0x373a33, stripe: 0x9fb0a2,
    water: 0x1a3038, waterLight: 0x2f6b6b, mist: 0x7ba3a3,
    prop: 0x5c6b5c, propKind: 'deadwood',
  },
  {
    name: 'Blackwater',
    sky: 0x141c1a, skyLow: 0x2a3d33,
    road: 0x3d3629, roadEdge: 0x261f18, stripe: 0x7a8a6b,
    water: 0x0d1614, waterLight: 0x1f4a33, mist: 0x3f5c4a,
    prop: 0x1a2620, propKind: 'reeds',
  },
];

export function zone(i: number): Zone {
  return ZONES[((i % ZONES.length) + ZONES.length) % ZONES.length]!;
}

export const INK = 0xf2eff8;
export const DIM = 0x9ab0a4;
export const GOLD = 0xffd166;
export const MINT = 0x8affc1;
export const ROSE = 0xff6f91;
export const NIGHT = 0x121a17;

/** The blob you are. One colour, because you are always the same blob — the
 *  hats are what make a run yours. Kept bright: everything else out here is
 *  a shade of wet green, and you must never lose yourself against it. */
export const BLOB_COLOR = 0x6ec5ff;
