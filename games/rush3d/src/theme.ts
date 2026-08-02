/**
 * 🐊 The same journey as Blob Rush, lit for real this time.
 *
 * Same eight zones, same order, same names — the 3D game IS Blob Rush, so
 * the places must be the places. The color set is trimmed to what a lit
 * renderer needs: sky pair (unlit — used verbatim by the dome and fog),
 * and tint colors that MULTIPLY the world's neutral vertex paint (road,
 * ground, trees, water), which is how a whole world restyles on a corner
 * for the cost of a few material.color writes.
 *
 * Tints run brighter than the 2D palette on purpose: they multiply
 * mid-grey vertex colors and then get lit, so a 2D-dark tint would land
 * near black. Albedo darker than the target, tints brighter — both are
 * the same rule seen from opposite sides of the light.
 */

export interface Zone3 {
  name: string;
  /** Fog + sky dome horizon (unlit, used verbatim). */
  sky: number;
  /** Sky dome zenith. */
  skyHigh: number;
  /** Multiplied over the road's neutral planks. */
  road: number;
  /** Multiplied over terrain. */
  ground: number;
  /** Multiplied over the trees. */
  prop: number;
  /** The water plane's material color. */
  water: number;
  /** Emissive accent — wisps, coin glint. */
  glow: number;
}

export const ZONES3: readonly Zone3[] = [
  { name: 'Misty Bog',    sky: 0x8fa08c, skyHigh: 0x3d4a4a, road: 0xd8c49a, ground: 0x9ec48e, prop: 0xa8c496, water: 0x33463c, glow: 0x8affc1 },
  { name: 'Cypress Deep', sky: 0x4a6b4f, skyHigh: 0x22332c, road: 0xc4ad84, ground: 0x7aa878, prop: 0x74a06a, water: 0x1f3329, glow: 0x8affc1 },
  { name: 'Sunken Ruins', sky: 0x3f6b72, skyHigh: 0x1e3542, road: 0xb8bca4, ground: 0x84a894, prop: 0xa2b8a2, water: 0x1a3038, glow: 0x5cf0d0 },
  { name: 'Blackwater',   sky: 0x2a3d33, skyHigh: 0x141c1a, road: 0x9a9478, ground: 0x5c7a62, prop: 0x54705c, water: 0x0d1614, glow: 0x2fd6a8 },
  { name: 'Witchlight',   sky: 0x1f4a5c, skyHigh: 0x101a26, road: 0x9a9ab8, ground: 0x5c7a88, prop: 0x63f5c4, water: 0x0b1620, glow: 0x63f5c4 },
  { name: 'Bone Fen',     sky: 0x9aa0ac, skyHigh: 0x2e3040, road: 0xe0dcc8, ground: 0xb8b8a8, prop: 0xe8e2cc, water: 0x35404a, glow: 0xf0ecdc },
  { name: 'Ember Marsh',  sky: 0xb04a1e, skyHigh: 0x3a1410, road: 0xc49068, ground: 0x9a6a4a, prop: 0x8a5038, water: 0x24100c, glow: 0xff9a4a },
  { name: 'The Mouth',    sky: 0x3a1f52, skyHigh: 0x120b1c, road: 0x8a7aa8, ground: 0x5c4a7a, prop: 0xa070e0, water: 0x090610, glow: 0xb08aff },
];

export function zone3(i: number): Zone3 {
  return ZONES3[((i % ZONES3.length) + ZONES3.length) % ZONES3.length]!;
}

/** Same blob as the 2D game — you are the same blob, in a deeper swamp.
 *  Authored darker than the 2D 0x6ec5ff because the sun does the lifting. */
export const BLOB_COLOR = 0x3d9bdd;
export const GOLD = 0xffd166;
export const MINT = 0x8affc1;
export const ROSE = 0xff6f91;
