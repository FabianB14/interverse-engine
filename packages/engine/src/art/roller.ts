/**
 * 🎡 A blob that rolls, wearing a hat that doesn't.
 *
 * The whole trick is that "the blob" is two transforms, not one:
 *
 *   view                 ← position this
 *     wheel  (spins)     ← the body: silhouette, spots, shading
 *     rider  (never)     ← the face, the hat, anything you bolt on
 *
 * Rolling the hat with the body is technically more correct and looks
 * terrible: the character stops being a character and becomes a texture. A
 * face and a hat that stay level read as *a blob that is rolling*, which is
 * the thing we actually want the player to see. Same reason a car's wheels
 * spin and its driver does not.
 *
 * Roll is driven by GROUND DISTANCE, not by time. `roll(d)` turns the wheel
 * by `d / radius`, which is what rolling without slipping actually means —
 * so speeding up, slowing down and stopping all look right for free, and the
 * blob never skids. Driving it off a fixed spin rate is the classic version
 * of this bug and it is visible immediately.
 */

import { Container, Graphics } from 'pixi.js';
import { blobCharacter } from './character.js';
import { darken, lighten } from '@interverse/core';

export interface RollingBlobOptions {
  radius: number;
  color: number;
  seed?: number;
  /** Blotches on the body. They are what makes the spin readable — a plain
   *  circle rotating is indistinguishable from a circle standing still. */
  spots?: number;
  spotColor?: number;
  /** Draw eyes on the (non-rolling) rider. Default true. */
  face?: boolean;
}

export interface RollingBlob {
  /** Position and scale this. */
  view: Container;
  /** The part that spins. Add anything that should look painted ON the blob. */
  wheel: Container;
  /** The part that never spins. Add hats, ears, trails — anything worn. */
  rider: Container;
  /** Advance the roll by a distance travelled along the ground. */
  roll(distance: number): void;
  /** Current wheel rotation in radians — for saving, or for matching a
   *  second body to this one. */
  readonly spin: number;
}

export function rollingBlob(opts: RollingBlobOptions): RollingBlob {
  const { radius, color, seed = 1, spots = 5, spotColor, face = true } = opts;

  const view = new Container();
  const wheel = new Container();
  const rider = new Container();

  // The body comes from the same blob art as every other character in the
  // engine, minus the face — the face belongs to the rider, because a face
  // going past upside down is the exact thing this module exists to avoid.
  const char = blobCharacter({
    radius, color, seed, face: false, shadow: false,
    // Explicit and proportional. blobCharacter's default is
    // `Math.max(3, radius * 0.06)`, whose floor of 3 assumes a radius in
    // pixels — author a roller at radius 1 and scale it up, as this module
    // is built to do, and that floor becomes an outline three times wider
    // than the blob.
    strokeWidth: radius * 0.06,
  });
  wheel.addChild(char.view);

  if (spots > 0) {
    const g = new Graphics();
    const tint = spotColor ?? darken(color, 0.28);
    for (let i = 0; i < spots; i++) {
      // Spread around the body rather than randomly, so no arrangement ever
      // comes out looking like a face competing with the real one.
      const a = (i / spots) * Math.PI * 2 + seed;
      const d = radius * (0.34 + ((i * 7) % 5) * 0.09);
      const r = radius * (0.1 + ((i * 3) % 4) * 0.035);
      g.circle(Math.cos(a) * d, Math.sin(a) * d, r).fill({ color: tint, alpha: 0.55 });
    }
    wheel.addChild(g);
  }

  // A highlight fixed to the WHEEL, so the light appears to travel over the
  // surface as it turns. On the rider it would look like a sticker.
  const shine = new Graphics()
    .ellipse(-radius * 0.34, -radius * 0.4, radius * 0.3, radius * 0.2)
    .fill({ color: lighten(color, 0.55), alpha: 0.5 });
  wheel.addChild(shine);

  if (face) {
    const eye = radius * 0.13;
    const g = new Graphics();
    g.circle(-radius * 0.3, -radius * 0.16, eye).fill(0x2b2b3a);
    g.circle(radius * 0.3, -radius * 0.16, eye).fill(0x2b2b3a);
    g.circle(-radius * 0.46, radius * 0.16, eye * 0.9).fill({ color: darken(color, 0.25), alpha: 0.6 });
    g.circle(radius * 0.46, radius * 0.16, eye * 0.9).fill({ color: darken(color, 0.25), alpha: 0.6 });
    rider.addChild(g);
  }

  view.addChild(wheel, rider);

  let spin = 0;
  return {
    view,
    wheel,
    rider,
    roll(distance: number): void {
      if (!Number.isFinite(distance)) return;
      spin = wrapAngle(spin + distance / radius);
      wheel.rotation = spin;
    },
    get spin(): number {
      return spin;
    },
  };
}

/** Keep the angle small. Left to accumulate, a long run reaches a float
 *  magnitude where rotation visibly quantises — the blob starts to stutter
 *  after a few minutes, which is a bug nobody finds in a ten-second test. */
export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
