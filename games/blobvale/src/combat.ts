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
  CHILL_SECONDS: 2.0,
  CHILL_FACTOR: 0.55,
};

/**
 * Status effects (M8). Each attack that carries a status mod rolls its
 * `chance` per victim — nothing is guaranteed. Freeze is a stun that then
 * leaves the mob CC-immune for `ccCooldown` so it can't be frozen forever;
 * poison/burn are damage-over-time; shock slows movement.
 */
export type StatusKind = 'freeze' | 'poison' | 'burn' | 'shock';

export const STATUS = {
  freeze: { chance: 0.35, duration: 2.0, ccCooldown: 4.0 },
  poison: { chance: 0.5, duration: 4.2, tick: 0.7, dmg: 5 },
  burn: { chance: 0.5, duration: 3.0, tick: 0.5, dmg: 7 },
  shock: { chance: 0.45, duration: 2.0, slow: 0.5 },
} as const;

export const STATUS_KINDS: StatusKind[] = ['freeze', 'poison', 'burn', 'shock'];

/** Which mods each class can roll — the same effect, class-flavored. */
export const CLASS_MODS: Record<string, string[]> = {
  knight: ['bomb', 'radial', 'shock'],
  archer: ['radial', 'freeze', 'poison'],
  mage: ['bomb', 'freeze', 'burn'],
  cleric: ['radial', 'poison', 'burn'],
  rogue: ['freeze', 'poison', 'shock'],
};

const MOD_LABELS: Record<string, Record<string, string>> = {
  knight: {
    bomb: '💣 Shield Bomb — slashes lob a bomb',
    radial: '🌀 Whirl Slash — strike all around you',
    shock: '⚡ Thunder Slam — chance to shock & slow',
  },
  archer: {
    radial: '🌀 Arrow Storm — arrows fly everywhere',
    freeze: '❄️ Frost Arrows — chance to freeze',
    poison: '☠️ Venom Tips — chance to poison',
  },
  mage: {
    bomb: '💣 Ember Bomb — fireballs leave a bomb',
    freeze: '❄️ Frost Nova — chance to freeze',
    burn: '🔥 Wildfire — chance to set ablaze',
  },
  cleric: {
    radial: '🌀 Radiant Burst — smite all around you',
    poison: '☠️ Plague Touch — chance to poison',
    burn: '🔥 Holy Fire — chance to set ablaze',
  },
  rogue: {
    freeze: '❄️ Ice Daggers — chance to freeze',
    poison: '☠️ Toxic Blades — chance to poison',
    shock: '⚡ Shock Daggers — chance to shock & slow',
  },
};

/** Display label for any card id, flavored by the picker's class. */
export function cardLabel(classId: string, cardId: string): string {
  return STAT_CARDS[cardId] ?? MOD_LABELS[classId]?.[cardId] ?? cardId;
}

// --------------------------------------------------------------- mobs

export type MobVariant = 'melee' | 'ranged' | 'aoe';

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
  /** Attack style (regular mobs): melee / ranged bolt / telegraphed slam. */
  variant?: MobVariant;
  /** Boss kind (index into BOSSES); undefined for regular mobs. */
  kind?: number;
  /** Frozen (no move/attack) until this sim time. */
  frozenUntil?: number;
  /** Immune to re-freeze until this time (CC cooldown). */
  ccImmuneUntil?: number;
  /** Damage-over-time timers. */
  poisonUntil?: number;
  poisonNext?: number;
  burnUntil?: number;
  burnNext?: number;
  /** Movement slow (shock) until this time. */
  shockUntil?: number;
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

export interface MobVariantDef {
  color: number;
  radius: number;
  /** Reach at which it attacks (bolt range for ranged, slam trigger for aoe). */
  range: number;
  every: number;
  dmg: number;
  hp: number;
  /** Blast radius for the aoe slam. */
  blast?: number;
}

/** Three regular-mob flavors; each camp spawns one of each. */
export const MOB_VARIANTS: Record<MobVariant, MobVariantDef> = {
  melee: { color: 0x8fbf6b, radius: 26, range: 70, every: 1.2, dmg: 5, hp: 45 },
  ranged: { color: 0x8ab0e0, radius: 24, range: 380, every: 1.7, dmg: 7, hp: 38 },
  aoe: { color: 0xe08a8a, radius: 30, range: 150, every: 2.4, dmg: 10, hp: 62, blast: 135 },
};

export const CAMP_VARIANTS: MobVariant[] = ['melee', 'ranged', 'aoe'];

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
