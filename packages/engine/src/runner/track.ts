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
 *     distance it takes to see it and act, and neither that distance nor the
 *     gap between rows is a constant — both are functions of the CURRENT
 *     speed. A layout that was generous at 700/s is a wall at 2400/s.
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

/**
 * A vertical extent above the road, in design units. 0 is the boards.
 *
 * This is the whole collision model, and it is deliberately a REAL SHAPE
 * rather than a pair of booleans. The first version of this file said things
 * like `{ jump: false, slide: true }` and left the art to be drawn to match
 * by hand — with the result that the line the player was asked to duck under
 * was painted well above the bottom of the thing they had to duck under. The
 * picture and the rule were two objects, and they disagreed.
 *
 * Now there is one object. The art is generated from these numbers, the hit
 * test is an overlap against these numbers, and "can I jump it" is DERIVED
 * rather than declared. They cannot drift apart because there is nothing to
 * drift.
 */
export interface Band {
  /** Lowest point. 0 means it sits on the boards. */
  low: number;
  /** Highest point. */
  high: number;
}

export interface HazardShape extends Band {
  /** A hole in the road. Height is irrelevant: only being off the ground at
   *  all gets you across, and there is nothing to duck under. */
  hole?: boolean;
}

/**
 * Peak of a jump, stated here rather than imported from moves.ts.
 *
 * moves.ts is about *timing* and this file is about *shape*; making shape
 * depend on timing would be a cycle. A test asserts it equals JUMP_HEIGHT,
 * which is the right place for a cross-module agreement to be enforced.
 */
export const JUMP_PEAK = 180;

/** How tall the runner is, stood up, in design units. */
export const RUN_HEIGHT = 92;
/** …and flattened out in a slide. */
export const SLIDE_HEIGHT = 40;

/**
 * The four hazards, as shapes.
 *
 * Chosen so that each answer is forced by the geometry rather than asserted:
 *
 *   log   0–78     a standing runner (0–92) hits it; a slide (0–40) still
 *                  hits it; only getting above 78 clears it.
 *   pit   a hole    only leaving the ground at all.
 *   branch/vines
 *         66–300   a standing runner overlaps at 66; a slide passes with 26
 *                  units to spare; a jump (h to h+92) is inside it for the
 *                  whole arc, which is what makes jumping the mistake.
 *
 * Both hanging hazards share a band on purpose. They look completely
 * different and they mean exactly the same thing — one shape per answer is a
 * lie the player finds out about at speed.
 */
export const HAZARD_SHAPES: Record<HazardKind, HazardShape> = {
  block: { low: 0, high: 78 },
  pit: { low: 0, high: 0, hole: true },
  barrier: { low: 66, high: 300 },
  low: { low: 66, high: 300 },
};

/** Where the runner is, vertically, right now. */
export function playerBand(height: number, crouch: number): Band {
  const tall = RUN_HEIGHT - Math.max(0, Math.min(1, crouch)) * (RUN_HEIGHT - SLIDE_HEIGHT);
  return { low: height, high: height + tall };
}

function overlaps(a: Band, b: Band): boolean {
  return a.low < b.high && b.low < a.high;
}

/** Can the runner, shaped like this, get past a hazard shaped like that? */
export function survivesBand(kind: HazardKind, player: Band): boolean {
  const shape = HAZARD_SHAPES[kind];
  // A hole cares only that you are off the ground.
  if (shape.hole) return player.low > 0;
  return !overlaps(player, shape);
}

/**
 * Whether each answer works — DERIVED from the shapes, never declared.
 *
 * This is what the action tint and any tutorial text read from, so a hazard
 * cannot be painted "slide under me" while being shaped like something you
 * have to jump.
 */
export const HAZARD_RULES: Record<HazardKind, { jump: boolean; slide: boolean; height: number }> =
  (Object.keys(HAZARD_SHAPES) as HazardKind[]).reduce(
    (out, kind) => {
      out[kind] = {
        // At the top of a jump, are you clear?
        jump: survivesBand(kind, playerBand(JUMP_PEAK, 0)),
        slide: survivesBand(kind, playerBand(0, 1)),
        height: HAZARD_SHAPES[kind].high,
      };
      return out;
    },
    {} as Record<HazardKind, { jump: boolean; slide: boolean; height: number }>,
  );

/** Legacy state-based test, kept because it reads well at a call site that
 *  only has booleans. Prefer survivesBand where the real heights are known. */
export function survives(kind: HazardKind, airborne: boolean, sliding: boolean): boolean {
  return survivesBand(kind, playerBand(airborne ? JUMP_PEAK : 0, sliding ? 1 : 0));
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

/**
 * How far apart consecutive rows of stuff are.
 *
 * NOT a constant. A fixed gap in distance is a shrinking gap in TIME as the
 * run speeds up — 620 units is six-tenths of a second at 1000/s and less than
 * a quarter at 2600 — so a track authored to feel fair at the start quietly
 * becomes a wall of obstacles at the end, for no reason anyone chose.
 *
 * Instead the gap grows with speed, but by LESS than speed does. That is the
 * whole pacing curve in one line: the time between obstacles still shortens
 * as you get faster, so the game does get harder — just deliberately, and
 * slowly enough that it never stops being readable.
 */
export const ROW_GAP_BASE = 420;
export const ROW_GAP_PER_SPEED = 0.5;

export function rowGap(
  speed: number,
  base = ROW_GAP_BASE,
  perSpeed = ROW_GAP_PER_SPEED,
): number {
  return base + Math.max(0, speed) * perSpeed;
}

export interface TrackOptions {
  lanes?: number;
  /** Smallest gap between rows, in design units, however slow you are. */
  minGap?: number;
  /** Extra gap per unit of speed. See rowGap. */
  gapPerSpeed?: number;
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
  private readonly minGap: number;
  private readonly gapPerSpeed: number;
  private readonly density: number;
  private readonly rand: () => number;

  constructor(opts: TrackOptions = {}) {
    this.lanes = opts.lanes ?? 3;
    this.minGap = opts.minGap ?? ROW_GAP_BASE;
    this.gapPerSpeed = opts.gapPerSpeed ?? ROW_GAP_PER_SPEED;
    this.density = opts.density ?? 0.72;
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
    const gap = rowGap(speed, this.minGap, this.gapPerSpeed);
    const target = playerZ + ahead;
    while (this.built < target) {
      this.built += gap;
      // Too close to be seen and reacted to — skip the row rather than drop
      // something on the player's head. Skipping leaves a gap, which is a
      // gift; spawning would be an ambush.
      if (this.built - playerZ < minAhead) continue;
      const row = this.row(this.built, gap);
      hazards.push(...row.hazards);
      pickups.push(...row.pickups);
    }
    return { hazards, pickups };
  }

  private row(z: number, gap: number): { hazards: Hazard[]; pickups: Pickup[] } {
    const hazards: Hazard[] = [];
    const pickups: Pickup[] = [];
    if (this.rand() > this.density) {
      // An empty row is not filler — it is the beat that makes the next row
      // land. A wall of obstacles with no gaps is noise.
      pickups.push(...this.coins(z, Math.floor(this.rand() * this.lanes), gap));
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
    if (free !== undefined) pickups.push(...this.coins(z, free, gap));
    return { hazards, pickups };
  }

  /** A short arc of coins rather than one, so a pickup is a line to follow.
   *  Spaced from the row gap so the trail stretches out with the track
   *  instead of bunching into a clump when the rows spread. */
  private coins(z: number, lane: number, gap: number): Pickup[] {
    const n = 2 + Math.floor(this.rand() * 3);
    const step = gap * 0.16;
    const out: Pickup[] = [];
    for (let i = 0; i < n; i++) out.push({ lane, z: z + i * step });
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

export function collides(playerLane: number, hazard: Hazard, player: Band): boolean {
  if (Math.abs(hazard.z) > HIT_DEPTH) return false;
  if (Math.round(playerLane) !== hazard.lane) return false;
  return !survivesBand(hazard.kind, player);
}
