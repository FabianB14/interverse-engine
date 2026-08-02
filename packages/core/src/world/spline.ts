/**
 * 〰 Splines — smooth paths through points you actually chose.
 *
 * A path tool earns its place in a game engine the moment anything has to
 * MOVE somewhere that isn't a straight line: a mob streaming in from a
 * gate, a camera sweeping an arena, a river bank, a race line. The input
 * is always the same — a handful of points somebody placed — and the
 * output has to pass through every one of them, smoothly, without the
 * overshoot that makes a tuned path wobble somewhere nobody asked it to.
 *
 * Centripetal Catmull-Rom is the whole answer. Unlike Béziers it
 * interpolates its control points (place a point, the path goes THERE),
 * and unlike uniform Catmull-Rom it cannot loop or self-intersect between
 * tight neighbors. Renderer-free on purpose: the 2D games can drive
 * patrols with it, the 3D ones can sweep cameras, and the tests can walk
 * it without a canvas.
 *
 * Two parameterizations, and the difference matters:
 *
 *   - `at(t)` with t in [0,1] spreads by SEGMENT — fine for shaping.
 *   - `atDistance(d)` moves in world UNITS — what movement wants, because
 *     a mob walking a path must cover road at its speed, not at "one
 *     segment per second" (segments differ in length, so segment-time
 *     motion visibly speeds up and slows down between points).
 */

export interface SplinePoint {
  x: number;
  y: number;
  z: number;
}

export interface SplineOptions {
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Arc-length table resolution per segment. More = straighter distance
   *  answers on very curvy paths. */
  samplesPerSegment?: number;
}

const EPS = 1e-6;

export class Spline {
  private readonly pts: SplinePoint[];
  private readonly closed: boolean;
  /** Cumulative arc length at sampled t values. */
  private readonly table: { t: number; d: number }[] = [];
  readonly length: number;

  constructor(points: readonly SplinePoint[], opts: SplineOptions = {}) {
    if (points.length < 2) throw new Error('a spline needs at least two points');
    this.pts = points.map((p) => ({ ...p }));
    this.closed = opts.closed ?? false;
    const samples = Math.max(4, opts.samplesPerSegment ?? 16);

    // Arc-length table: walk the curve once, remember how far each t is.
    const segs = this.segmentCount();
    let d = 0;
    let prev = this.at(0);
    this.table.push({ t: 0, d: 0 });
    const total = segs * samples;
    for (let i = 1; i <= total; i++) {
      const t = i / total;
      const p = this.at(t);
      d += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      this.table.push({ t, d });
      prev = p;
    }
    this.length = d;
  }

  private segmentCount(): number {
    return this.closed ? this.pts.length : this.pts.length - 1;
  }

  private point(i: number): SplinePoint {
    const n = this.pts.length;
    if (this.closed) return this.pts[((i % n) + n) % n]!;
    return this.pts[Math.max(0, Math.min(n - 1, i))]!;
  }

  /** Position at t in [0,1] across the whole path (segment-uniform). */
  at(t: number): SplinePoint {
    const segs = this.segmentCount();
    const clamped = Math.max(0, Math.min(1, t));
    const scaled = clamped * segs;
    const seg = Math.min(segs - 1, Math.floor(scaled));
    const local = scaled - seg;
    return this.segment(seg, local);
  }

  /** Position after `d` world units of travel along the path. */
  atDistance(d: number): SplinePoint {
    const clamped = Math.max(0, Math.min(this.length, d));
    // Binary search the arc-length table.
    let lo = 0;
    let hi = this.table.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.table[mid]!.d < clamped) lo = mid;
      else hi = mid;
    }
    const a = this.table[lo]!;
    const b = this.table[hi]!;
    const span = b.d - a.d;
    const f = span > EPS ? (clamped - a.d) / span : 0;
    return this.at(a.t + (b.t - a.t) * f);
  }

  /** Unit tangent at t — which way the path is going. */
  tangentAt(t: number): SplinePoint {
    const h = 1e-4;
    const a = this.at(Math.max(0, t - h));
    const b = this.at(Math.min(1, t + h));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  /** n points spread evenly BY DISTANCE — for drawing or scattering. */
  sample(n: number): SplinePoint[] {
    const out: SplinePoint[] = [];
    for (let i = 0; i < n; i++) out.push(this.atDistance((this.length * i) / (n - 1 || 1)));
    return out;
  }

  /**
   * One centripetal Catmull-Rom segment between point i and i+1.
   *
   * The knot spacing (sqrt of chord length) is the centripetal part, and
   * it is the entire reason this class is trustworthy: uniform spacing
   * makes the curve loop and overshoot between close-together points,
   * which in a game reads as a drunk mob rather than a path.
   */
  private segment(i: number, u: number): SplinePoint {
    const p0 = this.point(i - 1);
    const p1 = this.point(i);
    const p2 = this.point(i + 1);
    const p3 = this.point(i + 2);

    const knot = (a: SplinePoint, b: SplinePoint, tPrev: number): number => {
      const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      return tPrev + Math.max(Math.sqrt(dist), EPS);
    };
    const t0 = 0;
    const t1 = knot(p0, p1, t0);
    const t2 = knot(p1, p2, t1);
    const t3 = knot(p2, p3, t2);
    const t = t1 + (t2 - t1) * u;

    const lerp = (a: SplinePoint, b: SplinePoint, ta: number, tb: number): SplinePoint => {
      const span = tb - ta;
      const f = span > EPS ? (t - ta) / span : 0;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
      };
    };
    const a1 = lerp(p0, p1, t0, t1);
    const a2 = lerp(p1, p2, t1, t2);
    const a3 = lerp(p2, p3, t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    return lerp(b1, b2, t1, t2);
  }
}
