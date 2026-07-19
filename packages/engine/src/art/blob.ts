import { Graphics } from 'pixi.js';

export interface BlobOptions {
  /** Base radius in design units. */
  radius: number;
  /** Number of control lobes around the blob. More = rounder. Default 8. */
  points?: number;
  /** 0..1 how much each lobe deviates from a perfect circle. Default 0.18. */
  wobble?: number;
  /** Deterministic seed so the same blob shape is reproducible. Default 1. */
  seed?: number;
  /** Fill color. Default 0xff6f91 (party-pop pink). */
  color?: number;
  /** Optional outline color. */
  stroke?: number;
  /** Outline width in design units. Default 0 (no outline). */
  strokeWidth?: number;
}

/** Tiny deterministic PRNG (mulberry32) so blob shapes are reproducible by seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute the control points of an organic blob as [x, y, x, y, ...] centered
 * on the origin. Exposed so callers can animate/deform the shape if needed.
 */
export function blobPoints(opts: BlobOptions): number[] {
  const { radius, points = 8, wobble = 0.18, seed = 1 } = opts;
  const rand = rng(seed);
  const pts: number[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius * (1 + (rand() * 2 - 1) * wobble);
    pts.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return pts;
}

/**
 * Draw a smooth, organic code-drawn blob into a PixiJS Graphics object (§4.5).
 * The path is closed and smoothed by threading a quadratic curve through the
 * midpoints of consecutive control points — no sprite assets required.
 */
export function drawBlob(g: Graphics, opts: BlobOptions): Graphics {
  const { color = 0xff6f91, stroke, strokeWidth = 0 } = opts;
  const pts = blobPoints(opts);
  const n = pts.length / 2;

  const px = (i: number): number => pts[(i % n) * 2] as number;
  const py = (i: number): number => pts[(i % n) * 2 + 1] as number;

  // Start at the midpoint of the last and first control points.
  const startX = (px(n - 1) + px(0)) / 2;
  const startY = (py(n - 1) + py(0)) / 2;
  g.moveTo(startX, startY);

  for (let i = 0; i < n; i++) {
    const cx = px(i);
    const cy = py(i);
    const midX = (px(i) + px(i + 1)) / 2;
    const midY = (py(i) + py(i + 1)) / 2;
    g.quadraticCurveTo(cx, cy, midX, midY);
  }
  g.closePath();

  g.fill(color);
  if (stroke !== undefined && strokeWidth > 0) {
    g.stroke({ color: stroke, width: strokeWidth, alignment: 0.5 });
  }
  return g;
}
