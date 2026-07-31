/**
 * 🎨 Drawing a road that goes away from you.
 *
 * Everything here is code-vector, so the whole game is tens of kilobytes and
 * every colour is a zone away from being something else.
 *
 * The road is redrawn every frame into ONE Graphics. That sounds wasteful
 * and is not: it is a couple of dozen quads, and the alternative — a scroll
 * of persistent strips — has to solve recycling, z-fighting and the seam at
 * the horizon, none of which a redraw has to think about at all.
 *
 * Props and obstacles are the opposite: drawn ONCE at a unit size and then
 * only moved and scaled, because those have real geometry and redrawing them
 * sixty times a second is how a phone gets warm.
 */

import { Container, Graphics } from 'pixi.js';
import { LANE_WIDTH, darken, fogAlpha, lighten, project } from '@interverse/engine';
import type { HazardKind, Projection } from '@interverse/engine';
import type { Zone } from './theme.js';

/** Half-width of the drivable road, in design units. */
export const ROAD_HALF = LANE_WIDTH * 1.5;

/** Gap between the moving stripes down the lane lines. */
const STRIPE_GAP = 300;
const STRIPE_LEN = 150;

/**
 * The sky. Static, so it is built once and only recoloured on a zone change.
 */
export function skyOf(zone: Zone, w: number, horizonY: number): Graphics {
  const g = new Graphics();
  // A cheap two-tone gradient: enough bands that it reads as a gradient,
  // few enough that it costs nothing.
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const c = mix(zone.sky, zone.skyLow, t);
    g.rect(0, (horizonY * i) / bands, w, horizonY / bands + 1).fill(c);
  }
  return g;
}

function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * The road, the verges either side, and the stripes that make speed visible.
 *
 * `travelled` is total distance run: the stripes are positioned from it
 * modulo their spacing, so they scroll toward the camera at exactly the speed
 * the world is moving. Anything else — a stripe offset driven by its own
 * timer — drifts out of sync with the obstacles and looks like ice.
 */
export function drawRoad(
  g: Graphics,
  zone: Zone,
  travelled: number,
  p: Projection,
  w: number,
  h: number,
  far: number,
): void {
  g.clear();

  // Verge: everything below the horizon that is not road.
  g.rect(0, p.horizonY, w, h - p.horizonY).fill(zone.verge);

  // The road itself as one trapezoid from the camera to the draw distance.
  const nearL = project(-ROAD_HALF, 0, 0, p);
  const nearR = project(ROAD_HALF, 0, 0, p);
  const farL = project(-ROAD_HALF, far, 0, p);
  const farR = project(ROAD_HALF, far, 0, p);
  g.poly([nearL.x, nearL.y, nearR.x, nearR.y, farR.x, farR.y, farL.x, farL.y]).fill(zone.road);

  // Kerbs, drawn as their own thin trapezoids so the road has an edge to
  // read against the verge at speed.
  const kerb = 26;
  for (const side of [-1, 1]) {
    const a = project(side * ROAD_HALF, 0, 0, p);
    const b = project(side * (ROAD_HALF + kerb), 0, 0, p);
    const c = project(side * (ROAD_HALF + kerb), far, 0, p);
    const d = project(side * ROAD_HALF, far, 0, p);
    g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(zone.roadEdge);
  }

  // Lane divider stripes. Positioned from total distance so they belong to
  // the world rather than to a timer.
  const phase = travelled % STRIPE_GAP;
  for (const lineX of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
    for (let k = 0; k * STRIPE_GAP < far; k++) {
      const z0 = k * STRIPE_GAP - phase;
      const z1 = z0 + STRIPE_LEN;
      if (z1 <= 0) continue;
      const alpha = fogAlpha(z0, far) * 0.6;
      if (alpha <= 0.01) continue;
      const s0 = project(lineX, Math.max(0, z0), 0, p);
      const s1 = project(lineX, z1, 0, p);
      const halfNear = 9 * s0.scale;
      const halfFar = 9 * s1.scale;
      g.poly([
        s0.x - halfNear, s0.y, s0.x + halfNear, s0.y,
        s1.x + halfFar, s1.y, s1.x - halfFar, s1.y,
      ]).fill({ color: zone.stripe, alpha });
    }
  }
}

/** A roadside prop, drawn once at unit scale. Whatever the zone is themed
 *  as — the shape is what tells you where you are at a glance. */
export function propView(zone: Zone): Container {
  const c = new Container();
  const g = new Graphics();
  switch (zone.propKind) {
    case 'tree':
      g.rect(-0.06, -0.55, 0.12, 0.55).fill(darken(zone.prop, 0.4));
      g.circle(0, -0.72, 0.34).fill(zone.prop);
      g.circle(-0.18, -0.55, 0.24).fill(lighten(zone.prop, 0.12));
      break;
    case 'crystal':
      g.poly([0, -1.15, 0.22, -0.4, 0, 0, -0.22, -0.4]).fill(zone.prop);
      g.poly([0, -1.15, 0.06, -0.4, 0, 0]).fill(lighten(zone.prop, 0.35));
      break;
    case 'torch':
      g.rect(-0.07, -0.75, 0.14, 0.75).fill(0x4a3826);
      g.circle(0, -0.86, 0.16).fill(zone.prop);
      g.circle(0, -0.9, 0.09).fill(0xffe9a8);
      break;
    default:
      // Pillar: a temple's worth of them is what makes the first zone read
      // as a temple.
      g.rect(-0.2, -1.5, 0.4, 1.5).fill(zone.prop);
      g.rect(-0.28, -1.62, 0.56, 0.14).fill(lighten(zone.prop, 0.2));
      g.rect(-0.28, -0.12, 0.56, 0.14).fill(darken(zone.prop, 0.25));
      break;
  }
  c.addChild(g);
  return c;
}

/**
 * An obstacle, drawn once at unit scale (1 = one lane width).
 *
 * Each one has to say how it is beaten from a hundred metres away, so the
 * shapes are deliberately not subtle: things you go OVER are solid and low,
 * things you go UNDER hang from above with nothing beneath them, and a pit
 * is a hole with no geometry at all above the road.
 */
export function hazardView(kind: HazardKind, zone: Zone): Container {
  const c = new Container();
  const g = new Graphics();
  const w = 0.62;
  switch (kind) {
    case 'block':
      g.roundRect(-w, -0.62, w * 2, 0.62, 0.05).fill(0x9c6b3f);
      g.rect(-w, -0.62, w * 2, 0.09).fill(0xc08a55);
      g.rect(-0.06, -0.62, 0.12, 0.62).fill(0x7a5230);
      g.rect(-w, -0.36, w * 2, 0.08).fill(0x7a5230);
      break;
    case 'barrier':
      // Legs plus a bar at head height: the gap underneath IS the message.
      g.rect(-w, -0.9, 0.12, 0.9).fill(0x8a8fa8);
      g.rect(w - 0.12, -0.9, 0.12, 0.9).fill(0x8a8fa8);
      g.roundRect(-w, -0.9, w * 2, 0.22, 0.04).fill(0xff6f91);
      g.rect(-w, -0.8, w * 2, 0.06).fill(0xffffff);
      break;
    case 'low':
      // Hangs from nothing, which is exactly how it should read: there is no
      // ground contact anywhere, so jumping is obviously wrong.
      g.roundRect(-w, -1.5, w * 2, 0.62, 0.06).fill(darken(zone.prop, 0.15));
      g.rect(-w, -0.92, w * 2, 0.08).fill(0xffd166);
      break;
    default:
      // Pit: a dark hole with a lip, and nothing standing up out of it.
      g.ellipse(0, 0, w, 0.2).fill(0x120e22);
      g.ellipse(0, -0.02, w * 0.86, 0.15).fill(0x000000);
      g.ellipse(0, 0, w, 0.2).stroke({ color: darken(zone.road, 0.35), width: 0.05 });
      break;
  }
  c.addChild(g);
  return c;
}

/** A coin. Spun by scaling x, which is cheaper than rotating and reads
 *  better at the size a coin actually appears on screen. */
export function coinView(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 0.22).fill(0xffd166);
  g.circle(0, 0, 0.15).fill(0xffe9a8);
  g.circle(0, 0, 0.06).fill(0xffd166);
  c.addChild(g);
  return c;
}

/** The shadow under the blob — the thing the player actually aims a jump
 *  with, because it is the only part that stays on the road. */
export function shadowView(): Graphics {
  return new Graphics().ellipse(0, 0, 1, 0.32).fill({ color: 0x000000, alpha: 0.32 });
}
