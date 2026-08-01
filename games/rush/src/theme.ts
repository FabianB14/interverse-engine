/**
 * 🐊 The look: a causeway deeper and deeper into a swamp.
 *
 * A runner has no levels, so the only way it can feel like it is going
 * somewhere is for the scenery to change under you. Zones swap in on corners —
 * which is what makes a corner feel like a destination rather than a mechanic.
 *
 * These are ordered as a JOURNEY rather than a shuffle: the same swamp at
 * increasing depth and worsening hours, then out the far side into places
 * that are barely swamp at all. Somewhere that gets stranger the further in
 * you go is a place; a rotation of four moods is a screensaver.
 *
 * Eight of them, and a corner every eleven seconds or so, so seeing the last
 * one is a real run rather than a warm-up. Past the end it wraps, but anyone
 * who gets there has earned the repeat.
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
  propKind: 'cypress' | 'mangrove' | 'deadwood' | 'reeds' | 'bones' | 'wisp';
}

export const ZONES: readonly Zone[] = [
  {
    // 1. The edge of it, at dawn. Still almost pleasant.
    name: 'Misty Bog',
    sky: 0x3d4a4a, skyLow: 0x8fa08c,
    road: 0x6b5c42, roadEdge: 0x4a3f2d, stripe: 0xb9ad8a,
    water: 0x33463c, waterLight: 0x5c7a5e, mist: 0xc8d6c4,
    prop: 0x4a5c42, propKind: 'cypress',
  },
  {
    // 2. Under the canopy. The light goes.
    name: 'Cypress Deep',
    sky: 0x22332c, skyLow: 0x4a6b4f,
    road: 0x5c4f38, roadEdge: 0x3d3325, stripe: 0xa89a72,
    water: 0x1f3329, waterLight: 0x3f6b4a, mist: 0x86a389,
    prop: 0x2a3d28, propKind: 'mangrove',
  },
  {
    // 3. Somebody built here once.
    name: 'Sunken Ruins',
    sky: 0x1e3542, skyLow: 0x3f6b72,
    road: 0x55564a, roadEdge: 0x373a33, stripe: 0x9fb0a2,
    water: 0x1a3038, waterLight: 0x2f6b6b, mist: 0x7ba3a3,
    prop: 0x5c6b5c, propKind: 'deadwood',
  },
  {
    // 4. The bottom of the swamp, and the bottom of the night.
    name: 'Blackwater',
    sky: 0x141c1a, skyLow: 0x2a3d33,
    road: 0x3d3629, roadEdge: 0x261f18, stripe: 0x7a8a6b,
    water: 0x0d1614, waterLight: 0x1f4a33, mist: 0x3f5c4a,
    prop: 0x1a2620, propKind: 'reeds',
  },
  {
    // 5. Lights that are not lights.
    name: 'Witchlight',
    sky: 0x101a26, skyLow: 0x1f4a5c,
    road: 0x3a3a4a, roadEdge: 0x24242f, stripe: 0x8affd6,
    water: 0x0b1620, waterLight: 0x2fd6a8, mist: 0x4fb0a0,
    prop: 0x63f5c4, propKind: 'wisp',
  },
  {
    // 6. Bleached. Nothing has grown here in a long time.
    name: 'Bone Fen',
    sky: 0x2e3040, skyLow: 0x9aa0ac,
    road: 0x6e6a5e, roadEdge: 0x4a473e, stripe: 0xe4e0d2,
    water: 0x35404a, waterLight: 0x6f8290, mist: 0xd6d8dc,
    prop: 0xcfc9b4, propKind: 'bones',
  },
  {
    // 7. The swamp on fire, which turns out to be worse than the dark.
    name: 'Ember Marsh',
    sky: 0x3a1410, skyLow: 0xb04a1e,
    road: 0x5c3324, roadEdge: 0x3a1e14, stripe: 0xffb86b,
    water: 0x24100c, waterLight: 0xd9622b, mist: 0xc08050,
    prop: 0x40241a, propKind: 'deadwood',
  },
  {
    // 8. Where all of it drains to. You do not want to stop here.
    name: 'The Mouth',
    sky: 0x120b1c, skyLow: 0x3a1f52,
    road: 0x2e2438, roadEdge: 0x1a1422, stripe: 0xb08aff,
    water: 0x090610, waterLight: 0x5c2f9a, mist: 0x50387a,
    prop: 0x7a4fd0, propKind: 'wisp',
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
 *  hats are what make a run yours. Kept bright: the places out here go from
 *  wet green to bleached bone to violet, and you must never lose yourself
 *  against any of them. */
export const BLOB_COLOR = 0x6ec5ff;
