/**
 * ⚔ How an enemy attacks.
 *
 * Before this, every enemy in the engine did exactly two things: walk into
 * you, and optionally lob one aimed blob on a timer. That is enough for a
 * first fight and not enough for a second one — every encounter felt the
 * same because every enemy attacked the same.
 *
 * A pattern is deliberately a small named thing rather than a scripting
 * surface: the author picks "spread shot" from a menu, and the engine owns
 * the fairness rules that make it playable on a phone — chiefly the
 * telegraph, the wind-up flash that says "this is about to happen". An
 * unreadable attack is not difficulty, it is just noise, so every pattern
 * that can hurt you at range has one, and no pattern can skip it.
 *
 * The geometry is pure and lives here so the shapes can be checked without
 * a renderer; the runtime only has to spawn what `attackShots` describes.
 */

export type AttackPattern = 'contact' | 'aimed' | 'spread' | 'burst' | 'ring' | 'charge' | 'slam';

export interface AttackSpec {
  id: AttackPattern;
  emoji: string;
  label: string;
  /** Plain-language description for the inspector — what a player will see. */
  hint: string;
  /** Does it use the "attack every N secs" timer? 'contact' does not. */
  timed: boolean;
  /** Seconds of wind-up before it lands. 0 = no telegraph needed. */
  windup: number;
}

/** Contact is first because it is the default: just walk into the player. */
export const ATTACK_SPECS: readonly AttackSpec[] = [
  {
    id: 'contact', emoji: '👊', label: 'Just touch me', timed: false, windup: 0,
    hint: 'No special attack — bumping into the player costs them a heart.',
  },
  {
    id: 'aimed', emoji: '🎯', label: 'Aimed shot', timed: true, windup: 0.35,
    hint: 'One shot straight at the player. The classic — easy to dodge sideways.',
  },
  {
    id: 'spread', emoji: '🔱', label: 'Spread shot', timed: true, windup: 0.4,
    hint: 'Three shots in a fan. Dodging sideways is not enough; you have to move.',
  },
  {
    id: 'burst', emoji: '💨', label: 'Burst fire', timed: true, windup: 0.3,
    hint: 'Three quick shots in a row, then a long pause. Punishes standing still.',
  },
  {
    id: 'ring', emoji: '💥', label: 'Ring of shots', timed: true, windup: 0.5,
    hint: 'Shots in every direction. Good for a boss — find the gap and run.',
  },
  {
    id: 'charge', emoji: '🐗', label: 'Charge', timed: true, windup: 0.55,
    hint: 'Winds up, then rushes where the player WAS. Step aside and it misses.',
  },
  {
    id: 'slam', emoji: '🌊', label: 'Ground slam', timed: true, windup: 0.5,
    hint: 'A shockwave rolls out from the enemy. Back off, or be somewhere else.',
  },
];

export const ATTACK_IDS = ATTACK_SPECS.map((a) => a.id);

export function attackSpec(id: string): AttackSpec {
  return ATTACK_SPECS.find((a) => a.id === id) ?? ATTACK_SPECS[0]!;
}

export function isAttackPattern(v: unknown): v is AttackPattern {
  return typeof v === 'string' && ATTACK_IDS.includes(v as AttackPattern);
}

export interface Shot {
  /** Radians. 0 points right, like Math.atan2. */
  angle: number;
  speed: number;
  /** Seconds to wait before this one leaves the barrel (burst fire). */
  delay: number;
}

/** Fan of `count` shots centred on `base`, `spread` radians edge to edge. */
export function spreadAngles(base: number, count: number, spread: number): number[] {
  if (count <= 1) return [base];
  const step = spread / (count - 1);
  return Array.from({ length: count }, (_, i) => base - spread / 2 + step * i);
}

/** `count` shots evenly around the circle, starting at `base`. */
export function ringAngles(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => base + (i * Math.PI * 2) / count);
}

export const SHOT_SPEED = 320;

/**
 * What leaves the enemy for one attack. `charge` and `slam` fire nothing —
 * they move the enemy or push out a wave, which the runtime handles — so an
 * empty list is a meaningful answer, not a missing case.
 */
export function attackShots(pattern: AttackPattern, toPlayer: number): Shot[] {
  const shot = (angle: number, delay = 0): Shot => ({ angle, speed: SHOT_SPEED, delay });
  switch (pattern) {
    case 'aimed':
      return [shot(toPlayer)];
    case 'spread':
      return spreadAngles(toPlayer, 3, (40 * Math.PI) / 180).map((a) => shot(a));
    case 'burst':
      return [shot(toPlayer, 0), shot(toPlayer, 0.14), shot(toPlayer, 0.28)];
    case 'ring':
      return ringAngles(toPlayer, 10).map((a) => shot(a));
    default:
      return [];
  }
}

/** How long the whole attack takes, so a cooldown can never start early. */
export function attackDuration(pattern: AttackPattern): number {
  const shots = attackShots(pattern, 0);
  const last = shots.reduce((n, s) => Math.max(n, s.delay), 0);
  if (pattern === 'charge') return Math.max(last, CHARGE_TIME);
  if (pattern === 'slam') return Math.max(last, SLAM_TIME);
  return last;
}

export const CHARGE_TIME = 0.45;
export const CHARGE_SPEED = 3.2;
export const SLAM_TIME = 0.7;
export const SLAM_RADIUS = 260;

/** How far the shockwave has travelled, 0..SLAM_RADIUS. */
export function slamRadius(elapsed: number): number {
  return Math.max(0, Math.min(1, elapsed / SLAM_TIME)) * SLAM_RADIUS;
}

/**
 * Is the player caught by the wave right now? A shockwave is a moving RING,
 * not a growing disc — standing at the centre is safe once it has passed,
 * which is the whole reason it is dodgeable rather than a damage aura.
 */
export function slamHits(elapsed: number, distance: number, band = 46): boolean {
  if (elapsed < 0 || elapsed > SLAM_TIME) return false;
  return Math.abs(distance - slamRadius(elapsed)) <= band;
}

/**
 * Wind-up for this enemy. An enraged boss telegraphs faster — but never so
 * fast that the tell disappears, because "you could not have known" is not
 * a difficulty setting.
 */
export const MIN_WINDUP = 0.18;

export function windupFor(pattern: AttackPattern, enraged: boolean): number {
  const base = attackSpec(pattern).windup;
  if (!base) return 0;
  return Math.max(MIN_WINDUP, enraged ? base * 0.65 : base);
}
