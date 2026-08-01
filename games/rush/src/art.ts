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
import {
  HAZARD_RULES, HAZARD_SHAPES, LANE_WIDTH, darken, fogAlpha, lighten, projectPath,
} from '@interverse/engine';
import type { CornerFrame, HazardKind, Projection } from '@interverse/engine';
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
const SEGMENTS = 40;

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
  frame: CornerFrame | null,
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
      const q0 = projectPath(side * (ROAD_HALF + 120), z, 0, p, frame);
      const q1 = projectPath(side * (ROAD_HALF + 900), z + 240, 0, p, frame);
      g.ellipse((q0.x + q1.x) / 2, (q0.y + q1.y) / 2, 260 * q0.scale, 26 * q0.scale)
        .fill({ color: zone.waterLight, alpha: a });
    }
  }

  // The causeway, sliced so it can bend AND turn. Each slice is a quad
  // between two depths and every corner of it goes through projectPath, so
  // the bend and the right-angle corner are applied in one place and the
  // whole road agrees with them.
  //
  // The junction needs care. Two ribbons of road crossing at a right angle
  // overlap in a SQUARE, and the piecewise map is discontinuous across it for
  // every point off the centre line — so a slice that straddles the corner
  // joins two edges that do not belong to each other and comes out as a
  // twisted bowtie. That is what made the turn look broken. The fix is to cut
  // the slice list at the junction's two edges, skip the span between them,
  // and draw the junction square explicitly.
  const kerb = 30;
  const junction = frame ? { near: frame.ahead - ROAD_HALF, far: frame.ahead + ROAD_HALF } : null;
  for (let i = 0; i < SEGMENTS; i++) {
    let z0 = segZ(i, far);
    let z1 = segZ(i + 1, far);
    if (junction) {
      // Nothing may span the junction; clip each slice to one side of it.
      if (z0 < junction.near && z1 > junction.near) z1 = junction.near;
      else if (z0 < junction.far && z1 > junction.far) z0 = junction.far;
      else if (z0 >= junction.near && z1 <= junction.far) continue;
      if (z1 <= z0) continue;
    }
    const a0 = projectPath(-ROAD_HALF, z0, 0, p, frame);
    const b0 = projectPath(ROAD_HALF, z0, 0, p, frame);
    const b1 = projectPath(ROAD_HALF, z1, 0, p, frame);
    const a1 = projectPath(-ROAD_HALF, z1, 0, p, frame);
    // Alternate slices a shade apart: on a bending road this reads as the
    // planking of a boardwalk, and it makes the curve legible.
    const shade = i % 2 === 0 ? zone.road : darken(zone.road, 0.08);
    g.poly([a0.x, a0.y, b0.x, b0.y, b1.x, b1.y, a1.x, a1.y]).fill(shade);
    // Kerbs — the rotting timber edge that keeps you out of the water. Not
    // across the junction, where the road opens out to the side.
    for (const side of [-1, 1]) {
      const c0 = projectPath(side * ROAD_HALF, z0, 0, p, frame);
      const d0 = projectPath(side * (ROAD_HALF + kerb), z0, 0, p, frame);
      const d1 = projectPath(side * (ROAD_HALF + kerb), z1, 0, p, frame);
      const c1 = projectPath(side * ROAD_HALF, z1, 0, p, frame);
      g.poly([c0.x, c0.y, d0.x, d0.y, d1.x, d1.y, c1.x, c1.y]).fill(zone.roadEdge);
    }
  }

  // The junction itself: the square where the two ribbons overlap. Drawn
  // from the four corners of that square in the pre-corner frame, which is
  // the only description both roads agree on.
  if (junction && junction.far > 0) {
    const q = [
      projectPath(-ROAD_HALF, junction.near, 0, p, frame),
      projectPath(ROAD_HALF, junction.near, 0, p, frame),
      projectPath(ROAD_HALF, junction.far, 0, p, frame),
      projectPath(-ROAD_HALF, junction.far, 0, p, frame),
    ];
    g.poly(q.flatMap((v) => [v.x, v.y])).fill(lighten(zone.road, 0.06));
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
      const s0 = projectPath(lineX, Math.max(0, z0), 0, p, frame);
      const s1 = projectPath(lineX, z1, 0, p, frame);
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
    const q = projectPath(0, z, 0, p, frame);
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
 * The two answers, and the colour each one is always drawn in.
 *
 * Every hazard carries the colour of the thing you must DO about it. That is
 * the single biggest readability win available here: at speed, in a swamp
 * where everything is a shade of wet green, the player is not identifying a
 * log versus a branch — they are reading amber-means-up, cyan-means-down, and
 * they can do that from the far end of the draw distance.
 */
export const JUMP_TINT = 0xffb03a;
export const SLIDE_TINT = 0x5fd7ff;

export function hazardTint(kind: HazardKind): number {
  return HAZARD_RULES[kind].jump ? JUMP_TINT : SLIDE_TINT;
}

export function hazardGlyph(kind: HazardKind): string {
  return HAZARD_RULES[kind].jump ? '⤒' : '⤓';
}

/**
 * How big one design unit of hazard art is on the road. The game scales the
 * view by this, so the art can be authored against the collision band by
 * dividing through it.
 */
export const HAZARD_UNIT = LANE_WIDTH * 0.7;

/**
 * An obstacle, drawn FROM its collision band.
 *
 * This is the important part. The band in HAZARD_SHAPES is the hit test, and
 * every edge below is computed from it — so the bottom of a vine curtain IS
 * the line you have to get under, and the top of a log IS the line you have
 * to clear. There is no eyeballing and nothing to keep in sync.
 *
 * The previous version drew these by hand to look about right, and the cyan
 * "get under this" band on the vines ended up painted a third of the way UP
 * the strands. The picture said one thing and the rule did another, which is
 * exactly the bug this arrangement makes impossible.
 */
export function hazardView(kind: HazardKind, zone: Zone): Container {
  const c = new Container();
  const g = new Graphics();
  const shape = HAZARD_SHAPES[kind];
  // Collision band in the unit space the art is authored in. Negative y is
  // up, so `lo` is the visually lower edge.
  const lo = -shape.low / HAZARD_UNIT;
  // Clamped: the hanging hazards reach 300 units so a jump can never clear
  // them, which is far taller than is worth drawing.
  const hi = -Math.min(shape.high, 250) / HAZARD_UNIT;
  const w = 0.62;
  const bark = 0x6b5230;
  const barkDark = 0x4a3822;

  switch (kind) {
    case 'block': {
      // A fallen log lying across the boards. Its TOP is the band's top:
      // clear that and you are over it.
      const r = (lo - hi) / 2;
      const midY = (lo + hi) / 2;
      g.roundRect(-w, hi, w * 2, lo - hi, r).fill(bark);
      g.roundRect(-w, hi, w * 2, (lo - hi) * 0.3, r * 0.6).fill(lighten(bark, 0.18));
      // End grain, so it reads as a cut log rather than a pipe.
      g.ellipse(-w, midY, 0.09, r).fill(0x8a6b42);
      g.ellipse(-w, midY, 0.045, r * 0.55).fill(barkDark);
      g.ellipse(-0.28, hi + 0.02, 0.3, 0.06).fill({ color: 0x5c7a4a, alpha: 0.85 });
      g.ellipse(0.3, hi + 0.01, 0.22, 0.05).fill({ color: 0x5c7a4a, alpha: 0.7 });
      // A stub of branch, breaking the straight line.
      g.poly([0.1, hi, 0.2, hi, 0.3, hi - 0.26, 0.24, hi - 0.28]).fill(barkDark);
      // The action band sits ON the edge you must clear.
      g.rect(-w, hi - 0.05, w * 2, 0.09).fill({ color: JUMP_TINT, alpha: 0.95 });
      break;
    }

    case 'barrier': {
      // A branch caught on two broken stumps. The stumps rise to the band's
      // bottom; the branch sits on top of them. The gap underneath is real
      // and it is exactly `shape.low` tall.
      g.poly([-w, 0, -w + 0.15, 0, -w + 0.12, lo, -w + 0.02, lo]).fill(barkDark);
      g.poly([w, 0, w - 0.15, 0, w - 0.12, lo, w - 0.02, lo]).fill(barkDark);
      // Thick at the left, thin at the right, sagging in the middle —
      // irregularity is what stops a shape reading as furniture.
      const top = lo - 0.3;
      g.poly([
        -w, top, -w * 0.4, top + 0.1, 0.1, top + 0.18, w, top + 0.18,
        w, lo, 0.1, lo + 0.02, -w * 0.4, lo - 0.02, -w, lo,
      ]).fill(bark);
      g.ellipse(-w, (top + lo) / 2, 0.06, 0.11).fill(0x8a6b42);
      g.circle(-0.16, lo - 0.14, 0.06).fill(barkDark);
      // Twigs and leaves, above the line you duck under.
      g.poly([-0.3, top, -0.42, top - 0.32, -0.36, top - 0.34, -0.24, top - 0.02]).fill(barkDark);
      g.ellipse(-0.43, top - 0.38, 0.12, 0.07).fill(zone.prop);
      g.poly([0.34, top + 0.04, 0.48, top - 0.24, 0.42, top - 0.26, 0.28, top + 0.02]).fill(barkDark);
      g.ellipse(0.5, top - 0.3, 0.11, 0.06).fill(zone.prop);
      // The action band sits ON the edge you must get under.
      g.rect(-w, lo - 0.04, w * 2, 0.08).fill({ color: SLIDE_TINT, alpha: 0.95 });
      break;
    }

    case 'low': {
      // A curtain of hanging vines. It touches the ground NOWHERE, and every
      // strand ends exactly at the band's bottom edge — which is what makes
      // "can I get under that" answerable by looking.
      g.poly([-w, hi, w, hi + 0.04, w, hi + 0.3, -w, hi + 0.26]).fill(lighten(zone.prop, 0.05));
      for (let i = 0; i < 9; i++) {
        const x = -w + 0.06 + i * ((w * 2 - 0.12) / 8);
        // Strands vary, but none of them hangs below the band — the shortest
        // is what you would misread as the limit, so they all end together.
        const from = hi + 0.26 + ((i * 5) % 4) * 0.06;
        g.rect(x, from, 0.045, lo - from).fill({ color: zone.prop, alpha: 0.9 });
        g.ellipse(x + 0.022, lo, 0.05, 0.035).fill({ color: zone.prop, alpha: 0.9 });
      }
      g.rect(-w, lo - 0.04, w * 2, 0.08).fill({ color: SLIDE_TINT, alpha: 0.95 });
      break;
    }

    default:
      // Boards rotted straight through into the water. No geometry at all
      // above the road, so there is nothing to duck under.
      g.ellipse(0, 0, w, 0.2).fill(darken(zone.water, 0.55));
      g.ellipse(0, -0.02, w * 0.86, 0.15).fill(0x000000);
      g.ellipse(-0.16, -0.03, 0.16, 0.05).fill({ color: zone.waterLight, alpha: 0.45 });
      g.poly([-w, -0.05, -w + 0.16, -0.12, -w + 0.2, 0.02, -w + 0.02, 0.06]).fill(barkDark);
      g.poly([w, -0.05, w - 0.18, -0.13, w - 0.22, 0.01, w - 0.02, 0.06]).fill(barkDark);
      g.ellipse(0, 0, w, 0.2).stroke({ color: JUMP_TINT, width: 0.075 });
      break;
  }

  // ONE small chevron, pointing the way out, just clear of the obstacle.
  // An early cut drew two big ones per hazard and, with four hazards on
  // screen, the swamp vanished behind a wall of arrows — the warning has to
  // be quieter than the thing it is warning about.
  const up = HAZARD_RULES[kind].jump;
  const y = up ? hi - 0.34 : lo + 0.5;
  const d = up ? -1 : 1;
  g.poly([
    -0.15, y, 0, y + 0.13 * d, 0.15, y,
    0.15, y + 0.08 * d, 0, y + 0.21 * d, -0.15, y + 0.08 * d,
  ]).fill({ color: hazardTint(kind), alpha: 0.9 });

  c.addChild(g);
  return c;
}

/**
 * The mark painted on the boards in a blocked lane.
 *
 * The obstacle itself is a few pixels tall when it first appears, but a
 * stripe lying flat on the road keeps its width all the way out — so this,
 * not the object, is what tells you WHICH LANE is blocked while there is
 * still time to leave it. Drawn per-frame with the road, because it has to
 * follow the bend and the corner exactly.
 */
export function drawLaneMark(
  g: Graphics,
  kind: HazardKind,
  corners: { x: number; y: number }[],
  alpha: number,
): void {
  const pts: number[] = [];
  for (const p of corners) pts.push(p.x, p.y);
  // Faint. It is a stain on the boards that you read without looking at —
  // any stronger and it stops being a warning and starts being scenery you
  // try to avoid stepping on.
  g.poly(pts).fill({ color: hazardTint(kind), alpha: alpha * 0.3 });
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
