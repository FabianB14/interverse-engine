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

export function resetUpgrades(): void {
  for (const u of UPGRADES) store.set(`up_${u.id}`, 0);
}
