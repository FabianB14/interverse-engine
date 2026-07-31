/**
 * 👾 What each enemy actually does.
 *
 * Five archetypes, chosen so that each one asks a different question of the
 * player and the answers do not overlap:
 *
 *   grunt   — walks at you. Teaches the combo.
 *   archer  — shoots from range. Teaches "do not stand still".
 *   brute   — armoured and slow. Teaches the launcher (armour breaks in the air).
 *   shaman  — heals the others. Teaches target priority.
 *   howler  — fast, erratic, fragile. Teaches spacing.
 *
 * A sixth, the boss, is a brute that also does everything else, scaled up.
 *
 * All of it is data plus one small behaviour tag, because the fight logic
 * lives in the scene where the world is: what belongs here is the answer to
 * "what IS a shaman", in one place, where it can be balanced by reading.
 */

import { BRAWLER_CLASSES } from '@interverse/engine';
import type { FoeId } from './levels.js';

export type FoeMind = 'charge' | 'keepAway' | 'support' | 'dart';

export interface FoeSpec {
  id: FoeId;
  name: string;
  color: number;
  hat: string;
  held: string;
  radius: number;
  hp: number;
  damage: number;
  speed: number;
  mind: FoeMind;
  /** Seconds between attacks. 0 = contact only. */
  every: number;
  /** Reduces incoming damage until the armour is broken by a launcher. */
  armour?: number;
  xp: number;
  /** Shown once, the first time this foe appears. Teaching by label. */
  tip?: string;
}

export const FOES: Record<FoeId, FoeSpec> = {
  grunt: {
    id: 'grunt', name: 'Grunt', color: 0xff6f91, hat: '', held: 'dagger',
    radius: 30, hp: 3, damage: 1, speed: 120, mind: 'charge', every: 0, xp: 6,
  },
  archer: {
    id: 'archer', name: 'Archer', color: 0xffd166, hat: 'hood', held: 'staff',
    radius: 28, hp: 2, damage: 1, speed: 100, mind: 'keepAway', every: 2.1, xp: 9,
    tip: 'Archers keep their distance — close in fast.',
  },
  brute: {
    id: 'brute', name: 'Brute', color: 0x9d4edd, hat: 'horns', held: 'club',
    radius: 46, hp: 9, damage: 2, speed: 78, mind: 'charge', every: 3.4, armour: 0.5, xp: 18,
    tip: 'Brutes are armoured. Launch them — armour is no use in the air.',
  },
  shaman: {
    id: 'shaman', name: 'Shaman', color: 0x8affc1, hat: 'wizard', held: 'staff',
    radius: 30, hp: 4, damage: 1, speed: 96, mind: 'support', every: 3.2, xp: 14,
    tip: 'Shamans heal the others. Take them out first.',
  },
  howler: {
    id: 'howler', name: 'Howler', color: 0xffb86b, hat: '', held: '',
    radius: 26, hp: 2, damage: 1, speed: 210, mind: 'dart', every: 0, xp: 10,
    tip: 'Howlers are quick and reckless. Give yourself room.',
  },
  boss: {
    id: 'boss', name: 'Boss', color: 0xc77dff, hat: 'crown', held: 'club',
    radius: 68, hp: 40, damage: 2, speed: 92, mind: 'charge', every: 2.4, armour: 0.35, xp: 90,
  },
};

/**
 * Scale a foe for the stage it appears in.
 *
 * Health and damage grow with the tier, speed barely does. That is on
 * purpose: a stage-14 grunt should take longer to kill and hurt more, but a
 * grunt that also moves twice as fast stops being a grunt and starts being
 * an enemy the player has never met, at exactly the moment they thought they
 * understood the game.
 */
export function foeAt(id: FoeId, tier: number): FoeSpec {
  const base = FOES[id];
  const t = Math.max(1, tier);
  return {
    ...base,
    hp: Math.round(base.hp * (1 + (t - 1) * 0.38)),
    damage: base.damage + Math.floor((t - 1) / 4),
    speed: Math.round(base.speed * (1 + (t - 1) * 0.035)),
    xp: Math.round(base.xp * (1 + (t - 1) * 0.25)),
  };
}

/** Boss health comes from the stage table, not the tier curve — a named
 *  fight should be exactly as long as it was designed to be. */
export function bossAt(hp: number, tier: number): FoeSpec {
  return { ...foeAt('boss', tier), hp };
}

/** How much damage actually lands, given armour and whether the target is
 *  airborne. Armour is the brute's whole identity, and the launcher is the
 *  answer to it — so the rule that connects them lives in one function. */
export function damageThrough(spec: FoeSpec, damage: number, airborne: boolean): number {
  if (!spec.armour || airborne) return damage;
  return Math.max(0.5, damage * spec.armour);
}

/** Palette-friendly colours for the four playable classes, so the select
 *  screen and the in-game blobs cannot drift apart. */
export const PLAYER_COLORS = BRAWLER_CLASSES.map((c) => c.color);
