import { Graphics } from 'pixi.js';

/**
 * Crops you can grow. Grow times are in seconds (cozy-fast for a phone
 * session). Fruit is shown as an emoji, or code-drawn when there's no good
 * emoji for it (radish).
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const RARITY: Record<Rarity, { name: string; color: number; star: string }> = {
  common: { name: 'Common', color: 0xbfc6cc, star: '⭐' },
  uncommon: { name: 'Uncommon', color: 0x7bd06a, star: '⭐⭐' },
  rare: { name: 'Rare', color: 0x5aa9ff, star: '⭐⭐⭐' },
  epic: { name: 'Epic', color: 0xc77dff, star: '⭐⭐⭐⭐' },
  legendary: { name: 'Legendary', color: 0xffb03a, star: '⭐⭐⭐⭐⭐' },
};

export interface CropDef {
  id: string;
  name: string;
  emoji?: string;
  /** Code-drawn ripe fruit, when no emoji fits. `s` is a pixel scale. */
  drawFruit?: (g: Graphics, s: number) => void;
  /** Verium to plant a seed. */
  seedCost: number;
  /** Verium earned per harvest (its "worth"). */
  sellPrice: number;
  growSeconds: number;
  /** Foliage color for the growing plant. */
  leaf: number;
  /** How prized it is — rarer crops are worth more and sparkle. */
  rarity: Rarity;
}

function drawRadish(g: Graphics, s: number): void {
  g.ellipse(0, s * 0.15, s * 0.42, s * 0.5).fill(0xe0556a);
  g.ellipse(-s * 0.12, s * 0.05, s * 0.14, s * 0.2).fill(0xff8fa0);
  g.moveTo(0, -s * 0.3)
    .lineTo(-s * 0.28, -s * 0.75)
    .moveTo(0, -s * 0.3)
    .lineTo(0, -s * 0.85)
    .moveTo(0, -s * 0.3)
    .lineTo(s * 0.28, -s * 0.75)
    .stroke({ color: 0x6cbf4a, width: Math.max(3, s * 0.12) });
}

export const CROPS: CropDef[] = [
  {
    id: 'carrot',
    name: 'Carrot',
    emoji: '🥕',
    seedCost: 5,
    sellPrice: 12,
    growSeconds: 30,
    leaf: 0x6cbf4a,
    rarity: 'common',
  },
  {
    id: 'radish',
    name: 'Radish',
    drawFruit: drawRadish,
    seedCost: 4,
    sellPrice: 10,
    growSeconds: 24,
    leaf: 0x6cbf4a,
    rarity: 'common',
  },
  {
    id: 'potato',
    name: 'Potato',
    emoji: '🥔',
    seedCost: 7,
    sellPrice: 16,
    growSeconds: 36,
    leaf: 0x6cbf4a,
    rarity: 'common',
  },
  {
    id: 'corn',
    name: 'Corn',
    emoji: '🌽',
    seedCost: 8,
    sellPrice: 22,
    growSeconds: 50,
    leaf: 0x8fbf5a,
    rarity: 'uncommon',
  },
  {
    id: 'tomato',
    name: 'Tomato',
    emoji: '🍅',
    seedCost: 10,
    sellPrice: 26,
    growSeconds: 48,
    leaf: 0x5f9c4a,
    rarity: 'uncommon',
  },
  {
    id: 'strawberry',
    name: 'Strawberry',
    emoji: '🍓',
    seedCost: 12,
    sellPrice: 30,
    growSeconds: 40,
    leaf: 0x5f9c4a,
    rarity: 'rare',
  },
  {
    id: 'pumpkin',
    name: 'Pumpkin',
    emoji: '🎃',
    seedCost: 20,
    sellPrice: 55,
    growSeconds: 85,
    leaf: 0x5f8f43,
    rarity: 'rare',
  },
  {
    id: 'apple',
    name: 'Apple',
    emoji: '🍎',
    seedCost: 40,
    sellPrice: 110,
    growSeconds: 120,
    leaf: 0x4d7a3a,
    rarity: 'epic',
  },
  {
    id: 'orange',
    name: 'Orange',
    emoji: '🍊',
    seedCost: 45,
    sellPrice: 120,
    growSeconds: 130,
    leaf: 0x4d7a3a,
    rarity: 'epic',
  },
  {
    id: 'pineapple',
    name: 'Pineapple',
    emoji: '🍍',
    seedCost: 60,
    sellPrice: 170,
    growSeconds: 160,
    leaf: 0x6cae4a,
    rarity: 'legendary',
  },
];

const BY_ID = new Map(CROPS.map((c) => [c.id, c]));

export function cropById(id: string | null | undefined): CropDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}
