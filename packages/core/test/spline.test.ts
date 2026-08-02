import { describe, expect, it } from 'vitest';
import { Spline } from '../src/world/spline.js';
import type { SplinePoint } from '../src/world/spline.js';

const close = (a: SplinePoint, b: SplinePoint, tol = 1): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < tol;

describe('splines', () => {
  const zig: SplinePoint[] = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: 50 },
    { x: 200, y: 0, z: -50 },
    { x: 300, y: 0, z: 0 },
  ];

  it('passes through every control point — place a point, the path goes there', () => {
    const s = new Spline(zig);
    expect(close(s.at(0), zig[0]!)).toBe(true);
    expect(close(s.at(1 / 3), zig[1]!)).toBe(true);
    expect(close(s.at(2 / 3), zig[2]!)).toBe(true);
    expect(close(s.at(1), zig[3]!)).toBe(true);
  });

  it('measures at least the straight-line distance', () => {
    const s = new Spline(zig);
    expect(s.length).toBeGreaterThan(300);
    expect(s.length).toBeLessThan(600);
  });

  it('moves in world units, not segment time', () => {
    // Wildly uneven segments: one short hop then one long run.
    const s = new Spline([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 1000, y: 0, z: 0 },
    ]);
    // Halfway BY DISTANCE is far into the long segment, nowhere near the
    // middle control point that halfway-by-t would give.
    const mid = s.atDistance(s.length / 2);
    expect(mid.x).toBeGreaterThan(300);
    // Equal steps of distance cover equal ground.
    const step = s.length / 10;
    let prev = s.atDistance(0);
    for (let i = 1; i <= 10; i++) {
      const p = s.atDistance(step * i);
      const covered = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      expect(covered).toBeGreaterThan(step * 0.8);
      expect(covered).toBeLessThan(step * 1.2);
      prev = p;
    }
  });

  it('clamps distance to the ends instead of extrapolating', () => {
    const s = new Spline(zig);
    expect(close(s.atDistance(-50), zig[0]!)).toBe(true);
    expect(close(s.atDistance(s.length + 50), zig[3]!)).toBe(true);
  });

  it('does not overshoot between tight neighbors (the centripetal point)', () => {
    // Two points almost touching in a wide path — uniform Catmull-Rom
    // loops here; centripetal must stay in the neighborhood.
    const s = new Spline([
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 101, y: 0, z: 1 },
      { x: 200, y: 0, z: 0 },
    ]);
    for (let i = 0; i <= 40; i++) {
      const p = s.at(i / 40);
      expect(p.x).toBeGreaterThan(-20);
      expect(p.x).toBeLessThan(220);
      expect(Math.abs(p.z)).toBeLessThan(30);
    }
  });

  it('closes a loop back through the first point', () => {
    const square: SplinePoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 100 },
      { x: 0, y: 0, z: 100 },
    ];
    const s = new Spline(square, { closed: true });
    expect(close(s.at(0), square[0]!)).toBe(true);
    // The end of the loop arrives back where it began.
    expect(close(s.at(1), square[0]!, 2)).toBe(true);
  });

  it('tangent points the way the path is going', () => {
    const s = new Spline([
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 200, y: 0, z: 0 },
    ]);
    const tan = s.tangentAt(0.5);
    expect(tan.x).toBeCloseTo(1, 1);
    expect(Math.abs(tan.z)).toBeLessThan(0.1);
  });

  it('samples spread evenly by distance', () => {
    const s = new Spline(zig);
    const pts = s.sample(9);
    expect(pts.length).toBe(9);
    expect(close(pts[0]!, zig[0]!)).toBe(true);
    expect(close(pts[8]!, zig[3]!)).toBe(true);
  });

  it('refuses a one-point path loudly', () => {
    expect(() => new Spline([{ x: 0, y: 0, z: 0 }])).toThrow();
  });
});
