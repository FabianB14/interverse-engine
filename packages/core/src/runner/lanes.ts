/**
 * 🛤 Three lanes, and what it takes to change one.
 *
 * A runner's whole control scheme is "which of three slots am I in", so the
 * interesting part is not the arithmetic — it is that the change TAKES TIME.
 * A blob that teleports between lanes cannot be read by the player at speed,
 * and a blob that eases into place can be seen committing to a decision.
 */

export const LANE_COUNT = 3;

/** Sideways distance between lane centres, in design units. */
export const LANE_WIDTH = 190;

/** Lane index (0-based, left to right) to a sideways offset from the road's
 *  centre line. The middle lane is 0 so the road is symmetric. */
export function laneX(lane: number, count = LANE_COUNT, width = LANE_WIDTH): number {
  return (lane - (count - 1) / 2) * width;
}

export function clampLane(lane: number, count = LANE_COUNT): number {
  return Math.max(0, Math.min(count - 1, Math.round(lane)));
}

/**
 * How long a lane change takes. Long enough to see, short enough that the
 * input still feels like it happened when you did it.
 *
 * This is a duration, not a speed, so it does NOT stretch as the run gets
 * faster — which is the point. At 2600 units a second, a dodge that took a
 * fixed *distance* would arrive after the obstacle.
 */
export const LANE_SNAP_SECS = 0.13;

/**
 * A body that lives in lanes.
 *
 * Holds the lane you asked for and the x you are actually at, and closes the
 * gap at a constant rate rather than easing exponentially — an exponential
 * never quite arrives, and "never quite in the lane" is a hitbox bug waiting
 * to be reported as "it hit me when I dodged".
 */
export class LaneRider {
  /** The lane the player has asked for. */
  lane: number;
  /** Where the body actually is, sideways. */
  x: number;
  private readonly count: number;
  private readonly width: number;

  constructor(lane = Math.floor(LANE_COUNT / 2), count = LANE_COUNT, width = LANE_WIDTH) {
    this.count = count;
    this.width = width;
    this.lane = clampLane(lane, count);
    this.x = laneX(this.lane, count, width);
  }

  /** Sideways offset this rider is heading for. */
  get targetX(): number {
    return laneX(this.lane, this.count, this.width);
  }

  /** True while still sliding between lanes. */
  get moving(): boolean {
    return Math.abs(this.x - this.targetX) > 0.5;
  }

  /** Ask for a lane one step left (-1) or right (+1). Returns whether the
   *  move was legal, so the caller can play a bump instead of a swish. */
  step(dir: number): boolean {
    const next = clampLane(this.lane + Math.sign(dir), this.count);
    if (next === this.lane) return false;
    this.lane = next;
    return true;
  }

  update(dt: number): void {
    const target = this.targetX;
    const rate = this.width / LANE_SNAP_SECS;
    const gap = target - this.x;
    const move = rate * dt;
    this.x = Math.abs(gap) <= move ? target : this.x + Math.sign(gap) * move;
  }

  /** Drop straight into a lane with no travel — for spawning and restarts,
   *  never for input. */
  snapTo(lane: number): void {
    this.lane = clampLane(lane, this.count);
    this.x = this.targetX;
  }
}
