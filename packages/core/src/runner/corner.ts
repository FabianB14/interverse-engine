/**
 * ↩️ A road that turns a corner, and a camera that turns with it.
 *
 * A bend (perspective.ts) sways the road while you keep facing the same way.
 * A CORNER is the other thing: the path stops going where it was going and
 * heads off at a right angle, and the camera has to swing round to follow it.
 *
 * The whole model is one piecewise map from path coordinates to camera
 * coordinates:
 *
 *   before the corner   the path runs straight ahead, as usual
 *   after the corner    it runs sideways, starting from the corner's depth
 *
 * which means the road ahead of you visibly ENDS and a wall of road runs
 * left-to-right across it. That is what a right-angle turn looks like from a
 * hundred metres back, and it is a far better warning than any arrow: the
 * player can see the shape of the thing they have to do.
 *
 * Then the camera yaws — a real rotation of the world about the camera, not a
 * pan — and as it completes, what was sideways is straight ahead again.
 *
 * The neat part is that the yaw finishing and the player reaching the corner
 * coincide EXACTLY, so at that instant the turned frame and a fresh straight
 * frame produce identical output. The scene can swap one for the other on
 * that frame and nothing moves. No blend, no seam.
 */

/** Where the corner is and how far round the camera has come. */
export interface CornerFrame {
  /** Depth of the corner ahead of the player. Negative once it is behind. */
  ahead: number;
  /** Which way the path turns: +1 right, -1 left. */
  dir: number;
  /** Camera yaw in radians. 0 facing down the old path, ∓π/2 facing the new. */
  yaw: number;
}

/**
 * Over what distance the camera swings round.
 *
 * SHORT, and the reason is geometric rather than stylistic. The yaw finishes
 * as the corner arrives, so all of it happens while the runner is still on
 * the old road — and a camera that has turned 45° while its owner is still
 * running straight puts the ground under them at 45° too. That is correct
 * for a head turning, and wrong for a runner turning, and the difference is
 * visible as the boards underfoot tilting.
 *
 * Keeping the arc under about a quarter of a second of running confines that
 * to a stub of road right under the player while the new road swings in to
 * fill the frame — which is what a snap-turn at a junction actually looks
 * like. A long, luxurious swing shows the seam.
 *
 * It is also far shorter than the window in which the swipe is accepted: you
 * may commit to a corner from a long way out, but nothing moves until you
 * are on top of it.
 */
export const TURN_ARC = 420;

/**
 * How far round the camera should be, given how far the corner still is.
 *
 * Reaches a full right angle exactly as the corner arrives. Eased at both
 * ends, because a rotation that starts and stops abruptly reads as a glitch
 * rather than as the runner turning their head.
 */
export function yawFor(ahead: number, dir: number, arc = TURN_ARC): number {
  if (ahead >= arc) return 0;
  const t = Math.max(0, Math.min(1, 1 - ahead / arc));
  // Smoothstep.
  const eased = t * t * (3 - 2 * t);
  return -dir * (Math.PI / 2) * eased;
}

/**
 * Map a point on the path into camera space.
 *
 * `lateral` is sideways offset from the path's centre line; `depth` is how
 * far along the path it is, ahead of the player. The result is the same pair
 * in the camera's own frame, ready for the perspective divide.
 */
export function cornerSpace(
  lateral: number,
  depth: number,
  frame: CornerFrame | null,
): { x: number; z: number } {
  let cx = lateral;
  let cz = depth;
  if (frame && depth > frame.ahead) {
    // Past the corner the path runs off at a right angle, starting from the
    // corner's depth. Forward becomes (dir, 0); the right-hand side of that
    // new heading is (0, -dir) — face east and your right is south.
    const past = depth - frame.ahead;
    cx = frame.dir * past;
    cz = frame.ahead - frame.dir * lateral;
  }
  const yaw = frame?.yaw ?? 0;
  if (!yaw) return { x: cx, z: cz };
  // Rotate the world by -yaw: a camera turning right sends the world left.
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { x: cx * c + cz * s, z: -cx * s + cz * c };
}

/**
 * Has the camera come all the way round?
 *
 * The scene uses this to drop the corner frame and go back to a plain
 * straight one. Checked on the corner's position rather than the yaw so that
 * it cannot be true a frame before the geometry agrees.
 */
export function cornerDone(frame: CornerFrame): boolean {
  return frame.ahead <= 0;
}
