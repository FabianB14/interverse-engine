/**
 * 🛣 Looking down a road.
 *
 * An endless runner is a 3D idea — things approach from a vanishing point —
 * living in a 2D engine. The whole illusion is one pinhole projection, so it
 * lives in one file that nothing else has to understand:
 *
 *   screen = project(sideways, depth)
 *
 * `z` is depth in design units: 0 is the plane the player stands on, larger
 * is further away. Nothing beyond the camera exists, so z is never negative
 * in a drawing — a runner deletes what it has passed rather than showing it.
 *
 * Everything is derived from `scale`, which falls off as 1/(1+z/focal).
 * Positions, sizes and even how fast a thing seems to approach all come from
 * that one number, which is why objects never drift out of agreement with
 * the road they are standing on.
 */

export interface Projection {
  /** Screen x the road vanishes toward. */
  cx: number;
  /** Screen y of the horizon — where scale reaches zero. */
  horizonY: number;
  /** Screen y of the ground directly under the camera (z = 0). */
  groundY: number;
  /**
   * How fast things shrink. Larger = flatter, more telephoto; smaller = a
   * wide angle where obstacles rush at you. This is the single knob that
   * decides how a track *feels* to run down.
   */
  focal: number;
}

export const DEFAULT_PROJECTION: Projection = {
  cx: 640,
  horizonY: 250,
  groundY: 690,
  focal: 900,
};

export interface Projected {
  x: number;
  y: number;
  /** 1 at the camera, → 0 at the horizon. Multiply sizes by this. */
  scale: number;
}

/** How big something at depth `z` appears. */
export function depthOf(z: number, p: Projection = DEFAULT_PROJECTION): number {
  // Clamped rather than allowed to blow up: something that has drifted a
  // hair behind the camera should be huge, not infinite.
  return p.focal / (p.focal + Math.max(-p.focal * 0.9, z));
}

/**
 * Put a point at (sideways `x`, depth `z`, height `y` above the road) on the
 * screen. Height is applied AFTER the perspective scale, so a jump of the
 * same height looks smaller further away — which is the only reason a jump
 * reads as a jump rather than as a lane change.
 */
export function project(
  x: number,
  z: number,
  height = 0,
  p: Projection = DEFAULT_PROJECTION,
): Projected {
  const scale = depthOf(z, p);
  return {
    x: p.cx + x * scale,
    y: p.horizonY + (p.groundY - p.horizonY) * scale - height * scale,
    scale,
  };
}

/**
 * Draw order. Painter's algorithm: far things first.
 *
 * Returned as a zIndex rather than a sort, because sorting a few hundred
 * moving objects every frame is the easiest way to lose 60fps on a phone,
 * and PixiJS will do it for us from this number.
 */
export function depthIndex(z: number): number {
  return -z;
}

/**
 * Is this deep enough to bother drawing?
 *
 * Beyond the draw distance everything is sub-pixel and overlapping, so it
 * costs frames and buys nothing. Fog at the same distance hides the pop-in.
 */
export const DRAW_DISTANCE = 4200;

export function visible(z: number, far = DRAW_DISTANCE): boolean {
  return z > -120 && z < far;
}

/**
 * Fade for distance, so things resolve out of the haze instead of appearing.
 * The alternative — objects blinking into existence at full opacity — is the
 * single most obvious tell that a runner is a treadmill.
 */
export function fogAlpha(z: number, far = DRAW_DISTANCE): number {
  const start = far * 0.62;
  if (z <= start) return 1;
  return Math.max(0, 1 - (z - start) / (far - start));
}
