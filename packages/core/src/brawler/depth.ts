/**
 * 🎭 The 2.5D ground plane — the thing that makes a brawler a brawler.
 *
 * A side-scrolling beat-'em-up is not a platformer and not top-down. It is a
 * flat stage seen at a slight angle: you walk left and right along it, and
 * you also walk "into" and "out of" the screen along a shallow band of
 * ground. Two rules do all the work of selling that:
 *
 *   1. Further back (smaller y) draws BEHIND and slightly smaller.
 *   2. Nobody may walk above the horizon — the back of the band is a wall.
 *
 * Both are pure functions of y, which is why this file has no state and no
 * dependencies: every game, editor preview and headless test can agree on
 * where the ground is without instantiating anything.
 */

/** Top of the walkable band, in design units. Above this is scenery. */
export const HORIZON_Y = 300;

/** How much smaller things are at the very back of the band. */
export const DEPTH_MIN_SCALE = 0.82;

/**
 * Where the band ends.
 *
 * A brawler stage is LANDSCAPE — a wide room seen slightly from above — so
 * the design space these numbers assume is 1280x720 and the walkable band is
 * the lower two thirds of it. Sizing the band for a portrait screen was the
 * first thing that went wrong here: the camera sat inside a 940-unit band on
 * a 720-tall screen and the player never saw the horizon at all.
 */
export const GROUND_BOTTOM_Y = 690;

/**
 * How large something standing at `y` should be drawn.
 *
 * Deliberately subtle. Real perspective over a 400-unit band would be a
 * dramatic size change and would make characters at the back unreadable on a
 * phone; a hint of it is enough for the eye to read depth.
 */
export function depthScale(y: number, minScale = DEPTH_MIN_SCALE): number {
  const t = Math.max(0, Math.min(1, (y - HORIZON_Y) / (GROUND_BOTTOM_Y - HORIZON_Y)));
  return minScale + (1 - minScale) * t;
}

/** Draw order for the depth plane: further back draws first. Feeding this to
 *  a container's zIndex is the whole of the sorting rule. */
export function depthZ(y: number): number {
  return y;
}

/** Clamp a walk to the ground band. The horizon is a wall you cannot cross,
 *  which is what stops a brawler feeling like a top-down game. */
export function clampToGround(y: number, top = HORIZON_Y, bottom = GROUND_BOTTOM_Y): number {
  return Math.max(top, Math.min(bottom, y));
}

/** Is this on the walkable ground at all? */
export function onGround(y: number, top = HORIZON_Y, bottom = GROUND_BOTTOM_Y): boolean {
  return y >= top && y <= bottom;
}

/**
 * Lanes are how a brawler decides "are we close enough to trade blows".
 *
 * Being level with someone matters far more than being near them: an attack
 * that connects with an enemy standing a whole body-depth up the stage feels
 * like it missed. So depth distance is weighted heavily against horizontal
 * distance rather than measured as a plain radius.
 */
export const LANE_TOLERANCE = 46;

export function inSameLane(aY: number, bY: number, tolerance = LANE_TOLERANCE): boolean {
  return Math.abs(aY - bY) <= tolerance;
}

/**
 * Can `a` hit `b` with a melee swing of `reach`, facing `dir` (+1 right)?
 *
 * The check is: same lane, in front (or very close — you can hit someone
 * standing on top of you either way), and within reach.
 */
export function meleeConnects(
  a: { x: number; y: number; dir: number },
  b: { x: number; y: number },
  reach: number,
  tolerance = LANE_TOLERANCE,
): boolean {
  if (!inSameLane(a.y, b.y, tolerance)) return false;
  const dx = b.x - a.x;
  // Behind you only counts at point-blank range, where "behind" is a
  // technicality rather than something the player would call a miss.
  if (dx * a.dir < -24) return false;
  return Math.abs(dx) <= reach;
}

/**
 * Vertical offset for something `z` units above the ground plane.
 *
 * A brawler jump does not move you along the ground: you rise off it, keep
 * steering in both axes while airborne, and land wherever you have got to.
 * So height is drawn as an offset and never touches the y that decides
 * depth, sorting or lanes — that separation is the whole trick.
 */
export function airOffset(z: number): number {
  return -Math.max(0, z);
}
