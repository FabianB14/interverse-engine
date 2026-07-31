/**
 * 👊 What makes a hit feel like a hit.
 *
 * A brawler lives or dies on the quarter-second around contact, and almost
 * none of that is damage numbers. It is: the game stopping dead for a
 * moment, the target sliding away, a window where you cannot be hit again,
 * and a chain of swings that gets stronger if you keep the rhythm.
 *
 * All of it is arithmetic on a few numbers, so all of it lives here as pure
 * functions and tiny state machines. Nothing in this file draws anything —
 * which is what lets a headless test assert that the third hit of a combo
 * launches, without a renderer.
 */

// ------------------------------------------------------------- hit stop

/**
 * Freeze frames. On contact the whole world stops for a few dozen
 * milliseconds — the single cheapest thing that makes a swing feel like it
 * landed on something solid rather than passing through fog.
 *
 * Heavier hits stop longer, but the scale is tight: past about a tenth of a
 * second it stops reading as impact and starts reading as a dropped frame.
 */
export function hitStopFor(damage: number): number {
  return Math.max(0.04, Math.min(0.12, 0.04 + damage * 0.02));
}

export class HitStop {
  private left = 0;

  add(secs: number): void {
    // Overlapping hits do not add up into a freeze you notice as a stall.
    this.left = Math.max(this.left, secs);
  }

  /** Advance, returning the time the WORLD should advance by. */
  tick(dt: number): number {
    if (this.left <= 0) return dt;
    this.left = Math.max(0, this.left - dt);
    return 0;
  }

  get frozen(): boolean {
    return this.left > 0;
  }
}

// ------------------------------------------------------------ knockback

export interface Knock {
  vx: number;
  vy: number;
  /** Height above the plane, for a launcher. */
  vz: number;
}

/** How hard, and in which direction, a hit throws its target. */
export function knockbackFrom(dir: number, power: number, launch = false): Knock {
  return { vx: dir * power * 260, vy: 0, vz: launch ? power * 420 : 0 };
}

/** Decay knockback. Fast enough that control comes back quickly — a brawler
 *  where you slide for a second is a brawler you are not playing. */
export const KNOCK_DRAG = 6.5;

export function decayKnock(k: Knock, dt: number): Knock {
  const f = Math.exp(-KNOCK_DRAG * dt);
  return { vx: k.vx * f, vy: k.vy * f, vz: k.vz };
}

// --------------------------------------------------------------- combos

export interface ComboStep {
  /** Multiplies the attack's base damage. */
  damage: number;
  /** How far the swing reaches, in design units. */
  reach: number;
  /** Throws the target upward — the classic third-hit launcher. */
  launch?: boolean;
  /** How long the swing takes before another may start. */
  recovery: number;
}

/**
 * The default three-hit chain: two jabs and a launcher.
 *
 * Escalating on the last hit is what turns mashing into rhythm — the player
 * learns that finishing the chain is worth more than restarting it.
 */
export const DEFAULT_COMBO: readonly ComboStep[] = [
  { damage: 1, reach: 120, recovery: 0.26 },
  { damage: 1.1, reach: 128, recovery: 0.28 },
  { damage: 1.8, reach: 150, launch: true, recovery: 0.42 },
];

/** Keep swinging within this long and the chain continues; pause and it
 *  resets. Long enough to be forgiving on a touchscreen, short enough that
 *  the launcher has to be earned. */
export const COMBO_WINDOW = 0.62;

/**
 * Where you are in a chain. Deliberately a tiny state machine rather than a
 * set of flags: "which swing is this" and "has the window closed" are the
 * only two questions, and both have to be answerable in a test.
 */
export class Combo {
  private index = 0;
  private since = Infinity;
  private recover = 0;

  constructor(private readonly steps: readonly ComboStep[] = DEFAULT_COMBO) {}

  tick(dt: number): void {
    this.since += dt;
    this.recover = Math.max(0, this.recover - dt);
    if (this.since > COMBO_WINDOW) this.index = 0;
  }

  /** Mid-swing: another attack may not start yet. */
  get busy(): boolean {
    return this.recover > 0;
  }

  /** 0 when idle, else how far into the chain the last swing was (1-based). */
  get step(): number {
    return this.since > COMBO_WINDOW ? 0 : this.index;
  }

  /** Try to swing. Returns the step, or null if still recovering. */
  swing(): ComboStep | null {
    if (this.recover > 0) return null;
    if (this.since > COMBO_WINDOW) this.index = 0;
    const step = this.steps[Math.min(this.index, this.steps.length - 1)]!;
    this.index = (this.index + 1) % this.steps.length;
    this.since = 0;
    this.recover = step.recovery;
    return step;
  }

  reset(): void {
    this.index = 0;
    this.since = Infinity;
    this.recover = 0;
  }
}

// ---------------------------------------------------- invulnerability

/**
 * A moment after being hit where nothing can hit you again.
 *
 * Without it a crowd of three enemies is not a fight, it is a stunlock: each
 * one's contact damage lands before you have recovered from the last, and
 * the player dies without ever having had a turn. In a game whose whole
 * premise is being surrounded, this is not polish — it is the difference
 * between playable and not.
 */
export const IFRAME_SECS = 0.75;

export class Invulnerable {
  private left = 0;

  hit(secs = IFRAME_SECS): boolean {
    if (this.left > 0) return false;
    this.left = secs;
    return true;
  }

  tick(dt: number): void {
    this.left = Math.max(0, this.left - dt);
  }

  get active(): boolean {
    return this.left > 0;
  }

  /** Flash on and off while it lasts, so the state is visible. */
  get alpha(): number {
    return this.left > 0 ? (Math.floor(this.left * 14) % 2 ? 0.45 : 1) : 1;
  }
}

// ---------------------------------------------------------- telegraphs

/**
 * The wind-up before an attack lands.
 *
 * The engine owns this rather than each enemy, because it is a promise to
 * the player rather than a property of the monster: something is about to
 * happen, here, and you have this long to not be there. An attack without
 * one is not difficulty, it is noise.
 */
export const MIN_TELEGRAPH = 0.18;

export class Telegraph {
  private left = 0;
  private total = 0;

  /** Begin a wind-up. Never shorter than MIN_TELEGRAPH, however angry the
   *  enemy is — "you could not have known" is not a difficulty setting. */
  start(secs: number): void {
    this.total = Math.max(MIN_TELEGRAPH, secs);
    this.left = this.total;
  }

  /** Advance; true on the frame it completes. */
  tick(dt: number): boolean {
    if (this.left <= 0) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = 0;
    return true;
  }

  get running(): boolean {
    return this.left > 0;
  }

  /** 0 at the start of the wind-up, 1 the moment it lands — for drawing a
   *  ring that closes in, so "how long have I got" needs no HUD. */
  get progress(): number {
    return this.total > 0 ? 1 - this.left / this.total : 1;
  }

  cancel(): void {
    this.left = 0;
  }
}
