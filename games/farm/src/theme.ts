/** Cozy farm palette — warm soil, soft greens, gentle sky. */
export const FARM = {
  bg: 0x2a2016,
  soil: 0x7a5334,
  soilDark: 0x5f4026,
  soilWet: 0x4a3320,
  grass: 0x7bab54,
  grassDark: 0x5f8f43,
  ink: 0xfff3e2,
  inkSoft: 0xd9b899,
  accent: 0xe9c46a,
  coin: 0x9ad8ff,
  panel: 0x3a2a1c,
} as const;

/** Season tints applied over the grass for a subtle mood shift. */
export const SEASON_TINT: Record<string, number> = {
  spring: 0x8fd06a,
  summer: 0x7bab54,
  fall: 0xc98a4b,
  winter: 0xbfd6d0,
};
