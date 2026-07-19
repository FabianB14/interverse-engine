/**
 * Named palette system (§4.5) so games look cohesive by default.
 */
export interface Palette {
  /** Scene background. */
  bg: number;
  /** Primary text / outline color. */
  ink: number;
  /** Softer secondary text. */
  inkSoft: number;
  /** Highlight color for CTAs and scores. */
  accent: number;
  /** Entity fill colors, in rotation order. */
  colors: readonly number[];
}

export const partyPop: Palette = {
  bg: 0x1b1035,
  ink: 0xffffff,
  inkSoft: 0xb8a8e0,
  accent: 0xffd166,
  colors: [0xff6f91, 0xffc75f, 0x8affc1, 0x6fc3ff, 0xc77dff],
};

export const cozyAutumn: Palette = {
  bg: 0x2b1d16,
  ink: 0xfff3e2,
  inkSoft: 0xd9b899,
  accent: 0xff9f5a,
  colors: [0xe07a5f, 0xf2cc8f, 0x81b29a, 0xc98a4b, 0xa26769],
};

export const palettes: Record<string, Palette> = {
  'party-pop': partyPop,
  'cozy-autumn': cozyAutumn,
};

/** Multiply a 24-bit color's channels toward black by `amount` (0..1). */
export function darken(color: number, amount: number): number {
  const f = Math.max(0, 1 - amount);
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.floor((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** Pick a random entry from a palette color list. */
export function pickColor(colors: readonly number[], random: () => number = Math.random): number {
  return colors[Math.floor(random() * colors.length)] ?? 0xffffff;
}
