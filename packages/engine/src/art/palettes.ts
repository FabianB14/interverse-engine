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

export const forestDeep: Palette = {
  bg: 0x16281c,
  ink: 0xf2ffe9,
  inkSoft: 0xa8c8a0,
  accent: 0xffd166,
  colors: [0x8fbf6b, 0x5e9c76, 0x4d7ea8, 0xc98a4b, 0xa26769],
};

export const palettes: Record<string, Palette> = {
  'party-pop': partyPop,
  'cozy-autumn': cozyAutumn,
  'forest-deep': forestDeep,
};

/** Mix a 24-bit color toward white by `amount` (0..1). */
export function lighten(color: number, amount: number): number {
  const f = Math.min(1, Math.max(0, amount));
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) + (255 - ((color >> 16) & 0xff)) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) + (255 - ((color >> 8) & 0xff)) * f));
  const b = Math.min(255, Math.round((color & 0xff) + (255 - (color & 0xff)) * f));
  return (r << 16) | (g << 8) | b;
}

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
