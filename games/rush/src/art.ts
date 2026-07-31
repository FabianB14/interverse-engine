/**
 * 🎨 Drawing a causeway through a swamp.
 *
 * Everything here is code-vector, so the whole game is tens of kilobytes and
 * every colour is a zone away from being something else.
 *
 * The road is redrawn every frame into ONE Graphics. That sounds wasteful and
 * is not: it is a few dozen quads, and it is the only way to draw a road that
 * BENDS — a single trapezoid from here to the horizon can only ever be
 * straight. Slicing it into segments and projecting each one is what lets the
 * causeway swing away out of sight.
 *
 * Props and obstacles are the opposite: drawn ONCE at a unit size and then
 * only moved and scaled, because those have real geometry and redrawing them
 * sixty times a second is how a phone gets warm.
 */

import { Container, Graphics } from 'pixi.js';
import { LANE_WIDTH, darken, fogAlpha, lighten, project } from '@interverse/engine';
import type { HazardKind, Projection } from '@interverse/engine';
import type { Zone } from './theme.js';

/** Half-width of the drivable causeway, in design units. */
export const ROAD_HALF = LANE_WIDTH * 1.5;

/** Gap between the planks that make speed visible. */
const STRIPE_GAP = 300;
const STRIPE_LEN = 150;

/**
 * How many slices the road is cut into.
 *
 * Spaced by the SQUARE of the fraction, so most of them land in the near
 * half where the curve is actually legible. Evenly spaced slices spend
 * their whole budget on the two-pixel band by the horizon.
 */
const SEGMENTS = 26;

function segZ(i: number, far: number): number {
  const t = i / SEGMENTS;
  return far * t * t;
}

/** The sky. Static, so it is built once and only rebuilt on a zone change. */
export function skyOf(zone: Zone, w: number, horizonY: number): Graphics {
  const g = new Graphics();
  // A cheap two-tone gradient: enough bands that it reads as a gradient, few
  // enough that it costs nothing.
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    g.rect(0, (horizonY * i) / bands, w, horizonY / bands + 1).fill(mix(zone.sky, zone.skyLow, t));
  }
  // A bank of mist sitting on the horizon. In a swamp this is most of the
  // atmosphere, and it doubles as cover for anything popping in at the
  // draw distance.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    g.rect(0, horizonY - 46 + i * 11, w, 12).fill({ color: zone.mist, alpha: 0.05 + t * 0.16 });
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
 * The causeway, the water either side, and the planks that make speed visible.
 *
 * `travelled` is total distance run: the planks are positioned from it modulo
 * their spacing, so they scroll toward the camera at exactly the speed the
 * world is moving. Anything else — a stripe offset driven by its own timer —
 * drifts out of sync with the obstacles and looks like ice.
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

  // The water: everything below the horizon that is not causeway.
  g.rect(0, p.horizonY, w, h - p.horizonY).fill(zone.water);
  // Slicks of algae and standing light, scrolling with the world so the
  // water is moving past rather than painted on.
  const slickGap = 520;
  const slickPhase = travelled % slickGap;
  for (let k = 0; k * slickGap < far; k++) {
    const z = k * slickGap - slickPhase;
    if (z <= 0) continue;
    const a = fogAlpha(z, far) * 0.32;
    if (a <= 0.01) continue;
    for (const side of [-1, 1]) {
      const q0 = project(side * (ROAD_HALF + 120), z, 0, p);
      const q1 = project(side * (ROAD_HALF + 900), z + 240, 0, p);
      g.ellipse((q0.x + q1.x) / 2, (q0.y + q1.y) / 2, 260 * q0.scale, 26 * q0.scale)
        .fill({ color: zone.waterLight, alpha: a });
    }
  }

  // The causeway, sliced so it can bend. Each slice is a quad between two
  // depths, and every corner goes through project(), so the bend is applied
  // once in one place and the whole road agrees with it.
  const kerb = 30;
  for (let i = 0; i < SEGMENTS; i++) {
    const z0 = segZ(i, far);
    const z1 = segZ(i + 1, far);
    const a0 = project(-ROAD_HALF, z0, 0, p);
    const b0 = project(ROAD_HALF, z0, 0, p);
    const b1 = project(ROAD_HALF, z1, 0, p);
    const a1 = project(-ROAD_HALF, z1, 0, p);
    // Alternate slices a shade apart: on a bending road this reads as the
    // planking of a boardwalk, and it makes the curve legible.
    const shade = i % 2 === 0 ? zone.road : darken(zone.road, 0.08);
    g.poly([a0.x, a0.y, b0.x, b0.y, b1.x, b1.y, a1.x, a1.y]).fill(shade);
    // Kerbs — the rotting timber edge that keeps you out of the water.
    for (const side of [-1, 1]) {
      const c0 = project(side * ROAD_HALF, z0, 0, p);
      const d0 = project(side * (ROAD_HALF + kerb), z0, 0, p);
      const d1 = project(side * (ROAD_HALF + kerb), z1, 0, p);
      const c1 = project(side * ROAD_HALF, z1, 0, p);
      g.poly([c0.x, c0.y, d0.x, d0.y, d1.x, d1.y, c1.x, c1.y]).fill(zone.roadEdge);
    }
  }

  // Lane dividers. Positioned from total distance so they belong to the
  // world rather than to a timer.
  const phase = travelled % STRIPE_GAP;
  for (const lineX of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
    for (let k = 0; k * STRIPE_GAP < far; k++) {
      const z0 = k * STRIPE_GAP - phase;
      const z1 = z0 + STRIPE_LEN;
      if (z1 <= 0) continue;
      const alpha = fogAlpha(z0, far) * 0.5;
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

  // Mist lying on the water, thickest at the far end. Drawn last so it sits
  // over the road too — that is what makes distance feel like distance.
  for (let i = 0; i < 6; i++) {
    const z = far * (0.45 + i * 0.09);
    const q = project(0, z, 0, p);
    g.rect(0, q.y - 30 * q.scale, w, 74 * q.scale + 6)
      .fill({ color: zone.mist, alpha: 0.05 + i * 0.035 });
  }
}

/**
 * A swamp prop, drawn once at unit scale.
 *
 * Every one is rooted in water rather than standing on grass — the shape at
 * the waterline is what tells you where you are before any colour does.
 */
export function propView(zone: Zone): Container {
  const c = new Container();
  const g = new Graphics();
  const bark = darken(zone.prop, 0.45);
  switch (zone.propKind) {
    case 'mangrove':
      // Stilt roots straight out of the water — the silhouette that says
      // "swamp" faster than anything else.
      g.poly([-0.42, 0, -0.16, -0.62, -0.06, -0.62, -0.28, 0]).fill(bark);
      g.poly([0.42, 0, 0.16, -0.62, 0.06, -0.62, 0.28, 0]).fill(bark);
      g.poly([-0.14, 0, -0.05, -0.7, 0.05, -0.7, 0.14, 0]).fill(bark);
      g.rect(-0.09, -1.35, 0.18, 0.7).fill(bark);
      g.ellipse(-0.2, -1.5, 0.44, 0.26).fill(zone.prop);
      g.ellipse(0.24, -1.62, 0.4, 0.24).fill(lighten(zone.prop, 0.1));
      g.ellipse(0.02, -1.78, 0.34, 0.2).fill(zone.prop);
      break;

    case 'deadwood':
      // A bare snapped trunk with two broken limbs. Nothing alive on it.
      g.poly([-0.1, 0, 0.1, 0, 0.06, -1.5, -0.05, -1.5]).fill(bark);
      g.poly([0.05, -0.95, 0.52, -1.32, 0.44, -1.4, 0.02, -1.06]).fill(bark);
      g.poly([-0.05, -1.15, -0.42, -1.02, -0.38, -1.12, -0.02, -1.24]).fill(bark);
      g.ellipse(0, 0, 0.24, 0.08).fill({ color: zone.waterLight, alpha: 0.5 });
      break;

    case 'reeds': {
      // A clump of stems at slightly different heights, with heads.
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 0.11;
        const top = -0.55 - ((i * 7) % 5) * 0.14;
        g.poly([x - 0.025, 0, x + 0.025, 0, x + 0.012 + x * 0.3, top]).fill(zone.prop);
        if (i % 2 === 0) {
          g.ellipse(x + 0.012 + x * 0.3, top - 0.04, 0.035, 0.11).fill(darken(zone.prop, 0.2));
        }
      }
      break;
    }

    default:
      // Cypress: a flared buttress at the waterline, a straight trunk, a flat
      // moss-hung crown — and the "knees" poking out of the water beside it.
      g.poly([-0.34, 0, 0.34, 0, 0.13, -0.62, -0.13, -0.62]).fill(bark);
      g.rect(-0.09, -1.7, 0.18, 1.1).fill(bark);
      g.ellipse(0, -1.82, 0.62, 0.24).fill(zone.prop);
      g.ellipse(-0.24, -1.7, 0.36, 0.16).fill(darken(zone.prop, 0.15));
      g.ellipse(0.28, -1.74, 0.32, 0.15).fill(lighten(zone.prop, 0.12));
      // Moss hanging off the crown — the detail that makes it a swamp
      // cypress rather than a broccoli.
      for (const mx of [-0.4, -0.12, 0.22, 0.46]) {
        g.rect(mx, -1.82, 0.035, 0.3 + Math.abs(mx) * 0.4).fill({ color: zone.prop, alpha: 0.75 });
      }
      g.poly([-0.5, 0, -0.42, 0, -0.46, -0.2]).fill(bark);
      g.poly([0.44, 0, 0.54, 0, 0.49, -0.26]).fill(bark);
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
 * things you go UNDER hang from above with nothing beneath them, and a gap in
 * the boards has no geometry at all above the road.
 */
export function hazardView(kind: HazardKind, zone: Zone): Container {
  const c = new Container();
  const g = new Graphics();
  const w = 0.62;
  switch (kind) {
    case 'block':
      // A mossy crate washed up on the boards.
      g.roundRect(-w, -0.62, w * 2, 0.62, 0.05).fill(0x6b5230);
      g.rect(-w, -0.62, w * 2, 0.09).fill(0x8a6b42);
      g.rect(-0.06, -0.62, 0.12, 0.62).fill(0x4f3d24);
      g.rect(-w, -0.36, w * 2, 0.08).fill(0x4f3d24);
      g.ellipse(-0.3, -0.6, 0.26, 0.07).fill({ color: 0x5c7a4a, alpha: 0.8 });
      g.ellipse(0.34, -0.61, 0.2, 0.06).fill({ color: 0x5c7a4a, alpha: 0.6 });
      break;

    case 'barrier':
      // A fallen log on two stumps: legs plus a bar at head height, and the
      // gap underneath IS the message.
      g.rect(-w, -0.9, 0.14, 0.9).fill(0x4f3d24);
      g.rect(w - 0.14, -0.9, 0.14, 0.9).fill(0x4f3d24);
      g.roundRect(-w - 0.06, -0.94, w * 2 + 0.12, 0.26, 0.13).fill(0x7a5c38);
      g.roundRect(-w - 0.06, -0.9, w * 2 + 0.12, 0.08, 0.04).fill({ color: 0x6b8a4a, alpha: 0.9 });
      break;

    case 'low':
      // A hanging mat of moss and branches. It touches the ground NOWHERE,
      // so jumping is obviously the wrong answer.
      g.roundRect(-w, -1.6, w * 2, 0.5, 0.08).fill(darken(zone.prop, 0.25));
      for (let i = 0; i < 7; i++) {
        const x = -w + 0.1 + i * ((w * 2 - 0.2) / 6);
        g.rect(x, -1.16, 0.05, 0.16 + ((i * 5) % 4) * 0.06).fill({ color: zone.prop, alpha: 0.85 });
      }
      g.rect(-w, -1.18, w * 2, 0.07).fill(0xffd166);
      break;

    default:
      // A gap in the boards, straight down into the water. No geometry above
      // the road at all.
      g.ellipse(0, 0, w, 0.2).fill(darken(zone.water, 0.55));
      g.ellipse(0, -0.02, w * 0.86, 0.15).fill(0x000000);
      g.ellipse(-0.16, -0.03, 0.16, 0.05).fill({ color: zone.waterLight, alpha: 0.45 });
      g.ellipse(0, 0, w, 0.2).stroke({ color: 0x4f3d24, width: 0.06 });
      break;
  }
  c.addChild(g);
  return c;
}

/** A coin. Flipped by scaling x, which is cheaper than rotating and reads
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
  return new Graphics().ellipse(0, 0, 1, 0.32).fill({ color: 0x000000, alpha: 0.34 });
}
