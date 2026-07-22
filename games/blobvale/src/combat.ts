/**
 * Combat numbers — host-authoritative. All ranges/positions in design
 * units. M4 adds move-changing upgrade mods and a roster of bosses.
 */

export interface AbilityDef {
  /** Auto-aim reach. */
  range: number;
  /** Splash radius around the target point (0 = single target). */
  splash: number;
  damage: number;
  /** Heals allies in `splash` around the caster (cleric). */
  heals?: boolean;
  /** Dash to the target before hitting. */
  dashes?: boolean;
  cooldown: number;
  /** fx event kind clients render. */
  fx: 'slash' | 'arrow' | 'fire' | 'heal' | 'dash' | 'smite';
  label: string;
}

export const ABILITIES: Record<string, AbilityDef> = {
  knight: { range: 140, splash: 110, damage: 26, cooldown: 1.1, fx: 'slash', label: '⚔️' },
  archer: { range: 480, splash: 0, damage: 18, cooldown: 0.8, fx: 'arrow', label: '🏹' },
  mage: { range: 360, splash: 130, damage: 22, cooldown: 1.4, fx: 'fire', label: '🔥' },
  cleric: {
    range: 260,
    splash: 220,
    damage: 14,
    heals: true,
    cooldown: 1.2,
    fx: 'smite',
    label: '💚',
  },
  rogue: {
    range: 300,
    splash: 0,
    damage: 30,
    dashes: true,
    cooldown: 1.0,
    fx: 'dash',
    label: '🗡️',
  },
};

export const CLERIC_HEAL = 22;

// ------------------------------------------------- upgrade cards (M3/M4)

/** Flat stat cards — always in the level-up pool. */
export const STAT_CARDS: Record<string, string> = {
  dmg: '💥 +20% damage',
  hp: '❤️ +25% max HP (full heal)',
  cd: '⚡ 20% faster cooldown',
};

/**
 * Move-changing mods (M4). Each is owned at most once and rewires how the
 * class attack resolves on the host:
 *  - bomb:   attacks also drop a bomb at the target (delayed AoE blast)
 *  - freeze: attack victims freeze solid for a moment
 *  - radial: attacks also burst in all directions around the caster
 */
export const MODS = {
  BOMB_FUSE: 0.9,
  BOMB_RADIUS: 150,
  BOMB_FACTOR: 0.8,
  RADIAL_RADIUS: 240,
  RADIAL_FACTOR: 0.6,
  FREEZE_SECONDS: 2.2,
  CHILL_SECONDS: 2.0,
  CHILL_FACTOR: 0.55,
};

/** Which mods each class can roll — the same effect, class-flavored. */
export const CLASS_MODS: Record<string, string[]> = {
  knight: ['bomb', 'radial'],
  archer: ['radial', 'freeze'],
  mage: ['bomb', 'freeze'],
  cleric: ['radial', 'bomb'],
  rogue: ['freeze', 'bomb'],
};

const MOD_LABELS: Record<string, Record<string, string>> = {
  knight: {
    bomb: '💣 Shield Bomb — slashes lob a bomb',
    radial: '🌀 Whirl Slash — strike all around you',
  },
  archer: {
    radial: '🌀 Arrow Storm — arrows fly everywhere',
    freeze: '❄️ Frost Arrows — hits freeze mobs',
  },
  mage: {
    bomb: '💣 Ember Bomb — fireballs leave a bomb',
    freeze: '❄️ Frost Nova — flames freeze mobs',
  },
  cleric: {
    radial: '🌀 Radiant Burst — smite all around you',
    bomb: '💣 Holy Bomb — smites drop a bomb',
  },
  rogue: {
    freeze: '❄️ Ice Daggers — strikes freeze mobs',
    bomb: '💣 Smoke Bomb — strikes leave a bomb',
  },
};

/** Display label for any card id, flavored by the picker's class. */
export function cardLabel(classId: string, cardId: string): string {
  return STAT_CARDS[cardId] ?? MOD_LABELS[classId]?.[cardId] ?? cardId;
}

// --------------------------------------------------------------- mobs

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
  /** Boss kind (index into BOSSES); undefined for regular mobs. */
  kind?: number;
  /** Frozen (no move/attack) until this sim time. */
  frozenUntil?: number;
  /** Boss special-attack countdown. */
  specialIn?: number;
  /** Last roar time, so bosses announce themselves only on fresh aggro. */
  roaredAt?: number;
}

export const MOB = {
  MAX_HP: 45,
  SPEED: 130,
  AGGRO_RANGE: 260,
  LEASH_RANGE: 520,
  ATTACK_RANGE: 70,
  ATTACK_DAMAGE: 5,
  ATTACK_EVERY: 1.2,
  PER_CAMP: 3,
  RESPAWN_SECONDS: 12,
  XP_PER_KILL: 20,
  XP_RANGE: 700,
};

// -------------------------------------------------------------- bosses

export interface BossDef {
  name: string;
  emoji: string;
  color: number;
  hp: number;
  speed: number;
  enragedSpeed: number;
  attackRange: number;
  attackDamage: number;
  attackEvery: number;
  /** Signature move, fired every `specialEvery` while a target is near. */
  special: 'slam' | 'frostbolt' | 'bomb';
  specialEvery: number;
  specialDamage: number;
  /** AoE radius for slam/bomb; reach for frostbolt. */
  specialRadius: number;
  specialRange: number;
  xp: number;
}

/** The lair cycles through these — each kill summons the next, nastier one. */
export const BOSSES: BossDef[] = [
  {
    name: 'King Slime',
    emoji: '👑',
    color: 0x6b4f8f,
    hp: 1600,
    speed: 90,
    enragedSpeed: 150,
    attackRange: 100,
    attackDamage: 12,
    attackEvery: 1.6,
    special: 'slam',
    specialEvery: 4.0,
    specialDamage: 16,
    specialRadius: 190,
    specialRange: 190,
    xp: 140,
  },
  {
    name: 'Frost Wraith',
    emoji: '❄️',
    color: 0x7fd4e8,
    hp: 2100,
    speed: 100,
    enragedSpeed: 160,
    attackRange: 100,
    attackDamage: 12,
    attackEvery: 1.6,
    special: 'frostbolt',
    specialEvery: 3.0,
    specialDamage: 12,
    specialRadius: 0,
    specialRange: 440,
    xp: 180,
  },
  {
    name: 'Ember Titan',
    emoji: '🔥',
    color: 0xd96a3b,
    hp: 2800,
    speed: 85,
    enragedSpeed: 140,
    attackRange: 110,
    attackDamage: 16,
    attackEvery: 1.7,
    special: 'bomb',
    specialEvery: 4.5,
    specialDamage: 22,
    specialRadius: 170,
    specialRange: 420,
    xp: 240,
  },
];

export const BOSS = {
  ID: 9999,
  AGGRO_RANGE: 340,
  RESPAWN_SECONDS: 60,
  MINIONS_ON_ENRAGE: 2,
};

/** Bosses get burlier with each extra adventurer piling on. */
export function bossHpFor(baseHp: number, players: number): number {
  return Math.round(baseHp * (1 + 0.4 * Math.max(0, players - 1)));
}

export const PLAYER_BASE_HP = 120;
export const RESPAWN_SECONDS = 5;

/** Verium dropped by a kill (shared Interverse currency). */
export const VERIUM_PER_MOB = 5;
export const VERIUM_PER_BOSS = 60;

export function xpForLevel(level: number): number {
  return 40 + (level - 1) * 30;
}

export function damageAtLevel(base: number, level: number): number {
  return Math.round(base * (1 + 0.1 * (level - 1)));
}

export function maxHpAtLevel(level: number): number {
  return Math.round(PLAYER_BASE_HP * (1 + 0.05 * (level - 1)));
}
