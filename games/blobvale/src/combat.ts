/**
 * Milestone 2 combat numbers — host-authoritative. All ranges/positions in
 * design units.
 */

export interface AbilityDef {
  /** Auto-aim reach. */
  range: number;
  /** Splash radius around the target point (0 = single target). */
  splash: number;
  damage: number;
  /** Heals allies instead of damaging mobs. */
  heals?: boolean;
  /** Dash to the target before hitting. */
  dashes?: boolean;
  cooldown: number;
  /** fx event kind clients render. */
  fx: 'slash' | 'arrow' | 'fire' | 'heal' | 'dash';
  label: string;
}

export const ABILITIES: Record<string, AbilityDef> = {
  knight: { range: 140, splash: 110, damage: 26, cooldown: 1.1, fx: 'slash', label: '⚔️' },
  archer: { range: 480, splash: 0, damage: 18, cooldown: 0.8, fx: 'arrow', label: '🏹' },
  mage: { range: 360, splash: 130, damage: 22, cooldown: 1.4, fx: 'fire', label: '🔥' },
  cleric: { range: 260, splash: 220, damage: 10, heals: true, cooldown: 1.2, fx: 'heal', label: '💚' },
  rogue: { range: 300, splash: 0, damage: 30, dashes: true, cooldown: 1.0, fx: 'dash', label: '🗡️' },
};

export const CLERIC_HEAL = 22;

export interface MobState {
  id: number;
  x: number;
  y: number;
  hp: number;
  max: number;
  /** camp anchor for wander/leash */
  homeX: number;
  homeY: number;
  target: string | null;
  attackIn: number;
}

export const MOB = {
  MAX_HP: 60,
  SPEED: 130,
  AGGRO_RANGE: 260,
  LEASH_RANGE: 520,
  ATTACK_RANGE: 70,
  ATTACK_DAMAGE: 8,
  ATTACK_EVERY: 1.2,
  PER_CAMP: 3,
  RESPAWN_SECONDS: 12,
  XP_PER_KILL: 20,
  XP_RANGE: 700,
};

export const PLAYER_BASE_HP = 100;
export const RESPAWN_SECONDS = 5;

export function xpForLevel(level: number): number {
  return 40 + (level - 1) * 30;
}

export function damageAtLevel(base: number, level: number): number {
  return Math.round(base * (1 + 0.1 * (level - 1)));
}

export function maxHpAtLevel(level: number): number {
  return Math.round(PLAYER_BASE_HP * (1 + 0.05 * (level - 1)));
}
