/**
 * 🧱 What is on the road ahead.
 *
 * The generator is the game. Everything else in a runner is polish on top of
 * "is the next thing fair, and is it different from the last thing" — so the
 * rules that answer those two questions live here, in one readable place,
 * rather than being smeared across a spawn function.
 *
 * The constraints, and why each exists:
 *
 *   - **There is always a way through.** Every row leaves at least one lane
 *     that can be taken. A runner that can generate an unwinnable row trains
 *     players to blame the game, and they are right to.
 *   - **A hazard is never a surprise.** Nothing spawns closer than the
 *     distance it takes to see it and act, which is a function of the CURRENT
 *     speed, not a constant — at 1500/s a gap that was generous at 620/s is
 *     an ambush.
 *   - **The same thing twice is a pattern; three times is a rut.** Runs are
 *     remembered by their variety, so the picker refuses to repeat a kind it
 *     just used.
 */

/** What you can meet on the road. */
export type HazardKind = 'block' | 'barrier' | 'pit' | 'low';

export interface Hazard {
  kind: HazardKind;
  lane: number;
  /** Depth ahead of the player, in design units. */
  z: number;
}

export interface Pickup {
  lane: number;
  z: number;
}

/** How each hazard is beaten. The single source of truth for both the
 *  collision test and the tutorial text — they cannot drift apart. */
export const HAZARD_RULES: Record<HazardKind, { jump: boolean; slide: boolean; height: number }> = {
  // A crate: go over it, or go around it.
  block: { jump: true, slide: false, height: 120 },
  // A bar across the lane at head height: get low.
  barrier: { jump: false, slide: true, height: 130 },
  // A hole: only a jump clears it, and sliding into it is worse.
  pit: { jump: true, slide: false, height: 0 },
  // An overhang low enough that jumping puts you into it.
  low: { jump: false, slide: true, height: 150 },
};

/** Can a player in this state get past this hazard? */
export function survives(kind: HazardKind, airborne: boolean, sliding: boolean): boolean {
  const rule = HAZARD_RULES[kind];
  if (rule.jump && airborne) return true;
  if (rule.slide && sliding) return true;
  // Jumping into an overhang is worse than running into it: being in the air
  // when you meet a `low` is exactly the mistake it is there to punish.
  return false;
}

/**
 * How far ahead a hazard must appear to be fair.
 *
 * Reaction time is roughly a third of a second, and a lane change takes
 * another sixth — so the player needs half a second of road, plus a margin.
 * Scaling with speed is the whole point: this is why the game stays fair
 * as it gets faster.
 */
export const REACTION_SECS = 0.85;

export function fairDistance(speed: number): number {
  return speed * REACTION_SECS;
}

export interface TrackOptions {
  lanes?: number;
  /** Gap between rows of stuff, in design units. */
  spacing?: number;
  /** 0..1 — how often a row carries hazards at all. */
  density?: number;
  rand?: () => number;
}

/**
 * The generator.
 *
 * Stateful only in the ways it must be: how far it has built to, and what it
 * built last (so it can refuse to repeat itself).
 */
export class TrackBuilder {
  private built = 0;
  private lastKind: HazardKind | null = null;
  private sameKindRuns = 0;
  private readonly lanes: number;
  private readonly spacing: number;
  private readonly density: number;
  private readonly rand: () => number;

  constructor(opts: TrackOptions = {}) {
    this.lanes = opts.lanes ?? 3;
    this.spacing = opts.spacing ?? 620;
    this.density = opts.density ?? 0.78;
    this.rand = opts.rand ?? Math.random;
  }

  /** How far out the track has been generated. */
  get frontier(): number {
    return this.built;
  }

  /**
   * Build road from the frontier out to `ahead` beyond the player.
   *
   * `z` on the way in and out is ABSOLUTE — distance from the start of the
   * run, not from the player. That is what lets the fairness rule work at
   * all: it has to compare where a hazard will be against where the player
   * is *now*, and those are only comparable in the same frame of reference.
   *
   * Returns the new rows rather than mutating a world, so the caller decides
   * what a hazard looks like and this stays testable without a renderer.
   */
  build(playerZ: number, ahead: number, speed: number): { hazards: Hazard[]; pickups: Pickup[] } {
    const hazards: Hazard[] = [];
    const pickups: Pickup[] = [];
    const minAhead = fairDistance(speed);
    const target = playerZ + ahead;
    while (this.built < target) {
      this.built += this.spacing;
      // Too close to be seen and reacted to — skip the row rather than drop
      // something on the player's head. Skipping leaves a gap, which is a
      // gift; spawning would be an ambush.
      if (this.built - playerZ < minAhead) continue;
      const row = this.row(this.built);
      hazards.push(...row.hazards);
      pickups.push(...row.pickups);
    }
    return { hazards, pickups };
  }

  private row(z: number): { hazards: Hazard[]; pickups: Pickup[] } {
    const hazards: Hazard[] = [];
    const pickups: Pickup[] = [];
    if (this.rand() > this.density) {
      // An empty row is not filler — it is the beat that makes the next row
      // land. A wall of obstacles with no gaps is noise.
      pickups.push(...this.coins(z, Math.floor(this.rand() * this.lanes)));
      return { hazards, pickups };
    }

    const kind = this.pickKind();
    // How many lanes to block. Never all of them: the free lane IS the
    // puzzle, and a row with no answer is a bug, not a hard row.
    const blocked = 1 + Math.floor(this.rand() * (this.lanes - 1));
    const lanes = this.shuffledLanes().slice(0, blocked);
    for (const lane of lanes) hazards.push({ kind, lane, z });

    // Coins go in a lane that is open, so chasing them is compatible with
    // surviving — a runner where greed and safety always conflict is a
    // runner where the coins are decoration.
    const free = this.shuffledLanes().find((l) => !lanes.includes(l));
    if (free !== undefined) pickups.push(...this.coins(z, free));
    return { hazards, pickups };
  }

  /** A short arc of coins rather than one, so a pickup is a line to follow. */
  private coins(z: number, lane: number): Pickup[] {
    const n = 2 + Math.floor(this.rand() * 3);
    const out: Pickup[] = [];
    for (let i = 0; i < n; i++) out.push({ lane, z: z + i * 90 });
    return out;
  }

  private pickKind(): HazardKind {
    const kinds: HazardKind[] = ['block', 'barrier', 'pit', 'low'];
    for (let tries = 0; tries < 8; tries++) {
      const k = kinds[Math.floor(this.rand() * kinds.length)]!;
      // Two in a row is a pattern the player can learn; three is a rut.
      if (k !== this.lastKind || this.sameKindRuns < 1) {
        this.sameKindRuns = k === this.lastKind ? this.sameKindRuns + 1 : 0;
        this.lastKind = k;
        return k;
      }
    }
    this.sameKindRuns = 0;
    this.lastKind = kinds[0]!;
    return kinds[0]!;
  }

  private shuffledLanes(): number[] {
    const ls = Array.from({ length: this.lanes }, (_, i) => i);
    for (let i = ls.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [ls[i], ls[j]] = [ls[j]!, ls[i]!];
    }
    return ls;
  }

  reset(): void {
    this.built = 0;
    this.lastKind = null;
    this.sameKindRuns = 0;
  }
}

/**
 * Did the player hit it?
 *
 * Depth tolerance is deliberately tighter than the visual body, and lane
 * tolerance is looser. Players forgive being hit by something they were
 * clearly standing in; they do not forgive being hit by something they had
 * already passed.
 */
export const HIT_DEPTH = 90;

export function collides(
  playerLane: number,
  hazard: Hazard,
  airborne: boolean,
  sliding: boolean,
): boolean {
  if (Math.abs(hazard.z) > HIT_DEPTH) return false;
  if (Math.round(playerLane) !== hazard.lane) return false;
  return !survives(hazard.kind, airborne, sliding);
}
