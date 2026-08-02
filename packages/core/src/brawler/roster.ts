/**
 * 🎭 Playable characters, told apart by how they look and how they hit.
 *
 * A co-op brawler needs everyone on screen to be instantly distinguishable —
 * four blobs in a scrum is exactly the moment you must be able to find
 * yourself. Colour does most of that work, and a silhouette change (a hat, a
 * held weapon) does the rest at the size a phone actually renders.
 *
 * Classes are DATA, not subclasses: a game picks one and reads numbers off
 * it. That keeps "what is a Knight" answerable in one place, and lets the
 * character-select screen, the HUD and the save file all describe the same
 * thing without duplicating a table.
 */

export interface BrawlerClass {
  id: string;
  name: string;
  /** One line on the select screen — what playing this feels like. */
  blurb: string;
  color: number;
  /** Cosmetics, drawn by the art layer. */
  hat: string;
  held: string;
  /** Multipliers on the shared baseline, so balance is readable at a glance. */
  power: number;
  speed: number;
  hearts: number;
  /** Extra reach in design units — a spear outranges a dagger. */
  reach: number;
}

/**
 * Four classes covering the corners of the design space: the all-rounder,
 * the fragile fast one, the slow heavy one, and the one that wins by never
 * being where the enemy swung. Every number is a multiplier off 1.0 so a
 * reader can see the trade at a glance rather than doing arithmetic.
 */
export const BRAWLER_CLASSES: readonly BrawlerClass[] = [
  {
    id: 'knight',
    name: 'Knight',
    blurb: 'Steady all-rounder. Nothing to learn, nothing to fear.',
    color: 0x6fc3ff,
    hat: 'helm',
    held: 'sword',
    power: 1,
    speed: 1,
    hearts: 1,
    reach: 0,
  },
  {
    id: 'rogue',
    name: 'Rogue',
    blurb: 'Fast and fragile. Hit first, and keep moving.',
    color: 0x8affc1,
    hat: 'hood',
    held: 'dagger',
    power: 0.85,
    speed: 1.3,
    hearts: 0.7,
    reach: -18,
  },
  {
    id: 'brute',
    name: 'Brute',
    blurb: 'Slow, enormous swings. Whatever you hit stays hit.',
    color: 0xffb86b,
    hat: 'horns',
    held: 'club',
    power: 1.6,
    speed: 0.8,
    hearts: 1.4,
    reach: 26,
  },
  {
    id: 'mage',
    name: 'Mage',
    blurb: 'Fights at range. Squishy up close, so do not be up close.',
    color: 0xc77dff,
    hat: 'wizard',
    held: 'staff',
    power: 1.1,
    speed: 0.95,
    hearts: 0.8,
    reach: 44,
  },
];

export function brawlerClass(id: string): BrawlerClass {
  return BRAWLER_CLASSES.find((c) => c.id === id) ?? BRAWLER_CLASSES[0]!;
}

/**
 * Two players who picked the same class still have to be tellable apart, so
 * a joiner's blob is tinted away from the class colour by their slot.
 */
export function playerTint(base: number, slot: number): number {
  if (slot <= 0) return base;
  const shift = [0, 0x101820, 0x201008, 0x081810][slot % 4]!;
  const r = Math.min(255, ((base >> 16) & 255) + ((shift >> 16) & 255));
  const g = Math.min(255, ((base >> 8) & 255) + ((shift >> 8) & 255));
  const b = Math.min(255, (base & 255) + (shift & 255));
  return (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------- progression

/**
 * What a level-up buys. Kept blunt on purpose: a brawler's progression is
 * felt through bigger numbers, not through new systems, and three knobs is
 * enough to make ten levels of growth readable.
 */
export interface Upgrades {
  power: number;
  speed: number;
  hearts: number;
}

export const NO_UPGRADES: Upgrades = { power: 0, speed: 0, hearts: 0 };

/** XP for the next level. Gently superlinear, so early levels come fast and
 *  the last ones are worth reaching. */
export function xpForLevel(level: number): number {
  return Math.round(20 + Math.pow(Math.max(1, level), 1.45) * 14);
}

/** Total XP needed to arrive at `level` from level 1. */
export function xpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpForLevel(l);
  return total;
}

export function levelFromXp(xp: number): number {
  let level = 1;
  let spent = 0;
  while (spent + xpForLevel(level) <= xp && level < 99) {
    spent += xpForLevel(level);
    level++;
  }
  return level;
}

/** The stats a character actually fights with, class and upgrades combined. */
export interface Stats {
  power: number;
  speed: number;
  hearts: number;
  reach: number;
}

export const BASE_SPEED = 330;
export const BASE_REACH = 124;
export const BASE_HEARTS = 5;

export function statsFor(cls: BrawlerClass, up: Upgrades = NO_UPGRADES): Stats {
  return {
    power: cls.power * (1 + up.power * 0.18),
    speed: BASE_SPEED * cls.speed * (1 + up.speed * 0.06),
    // Hearts are whole things you can count on a HUD, so this rounds — and
    // never below one, or a class multiplier could hand you a corpse.
    hearts: Math.max(1, Math.round(BASE_HEARTS * cls.hearts + up.hearts)),
    reach: BASE_REACH + cls.reach,
  };
}
