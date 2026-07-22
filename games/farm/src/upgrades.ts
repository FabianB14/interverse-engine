import { verium } from '@interverse/engine';
import { store } from './store.js';

/**
 * Farm upgrades — spend Verium for permanent boosts. Each has a few levels
 * with a rising cost, and a getter that turns the level into a gameplay
 * multiplier the farm applies while you play.
 */
export interface UpgradeDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  maxLevel: number;
  /** Cost to buy the NEXT level from the given current level. */
  cost: (level: number) => number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'soil',
    name: 'Rich Soil',
    emoji: '🌱',
    desc: 'crops grow faster',
    maxLevel: 3,
    cost: (l) => 80 + l * 110,
  },
  {
    id: 'sprinkler',
    name: 'Sprinklers',
    emoji: '💧',
    desc: 'soil stays moist longer',
    maxLevel: 3,
    cost: (l) => 60 + l * 90,
  },
  {
    id: 'tools',
    name: 'Golden Tools',
    emoji: '🛠️',
    desc: 'sell crops for more',
    maxLevel: 3,
    cost: (l) => 100 + l * 130,
  },
  {
    id: 'land',
    name: 'More Land',
    emoji: '🏞️',
    desc: '+4 planting plots per level',
    maxLevel: 2,
    cost: (l) => 150 + l * 200,
  },
  {
    id: 'expand',
    name: 'Expand Farm',
    emoji: '🗺️',
    desc: 'grow the whole farm map',
    maxLevel: 2,
    cost: (l) => 300 + l * 250,
  },
];

export function upgradeById(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}

export function upgradeLevel(id: string): number {
  return store.get<number>(`up_${id}`, 0);
}

/** Cost of the next level, or null if maxed. */
export function nextCost(id: string): number | null {
  const def = upgradeById(id);
  if (!def) return null;
  const lvl = upgradeLevel(id);
  return lvl >= def.maxLevel ? null : def.cost(lvl);
}

/** Buy the next level of an upgrade; false if maxed or too little Verium. */
export function buyUpgrade(id: string): boolean {
  const cost = nextCost(id);
  if (cost === null) return false;
  if (!verium.spend(cost)) return false;
  store.set(`up_${id}`, upgradeLevel(id) + 1);
  return true;
}

// --- Effect getters applied by the farm/market ---

/** Growth is faster with Rich Soil (+35% per level). */
export function growthMultiplier(): number {
  return 1 + upgradeLevel('soil') * 0.35;
}

/** Moisture drains slower with Sprinklers (−28% decay per level). */
export function moistureDecayMultiplier(): number {
  return Math.max(0.1, 1 - upgradeLevel('sprinkler') * 0.28);
}

/** Crops sell for more with Golden Tools (+20% per level). */
export function sellMultiplier(): number {
  return 1 + upgradeLevel('tools') * 0.2;
}

/** Extra plot tile coords (col,row) unlocked by More Land — visual + real. */
export function extraPlotTiles(): { col: number; row: number }[] {
  const lvl = upgradeLevel('land');
  const tiles: { col: number; row: number }[] = [];
  if (lvl >= 1)
    tiles.push({ col: 3, row: 16 }, { col: 5, row: 16 }, { col: 7, row: 16 }, { col: 9, row: 16 });
  if (lvl >= 2)
    tiles.push(
      { col: 11, row: 16 },
      { col: 13, row: 16 },
      { col: 11, row: 6 },
      { col: 13, row: 6 },
    );
  return tiles;
}

export function resetUpgrades(): void {
  for (const u of UPGRADES) store.set(`up_${u.id}`, 0);
}
