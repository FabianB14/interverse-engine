import { describe, expect, it } from 'vitest';
import { darken, lighten, palettes, pickColor } from '@interverse/core';
import { blobPoints } from '../src/art/blob.js';

describe('palette color math', () => {
  it('lighten/darken stay inside the 24-bit range', () => {
    expect(lighten(0xffffff, 1)).toBe(0xffffff);
    expect(darken(0x000000, 1)).toBe(0x000000);
    expect(lighten(0x000000, 0.5)).toBeGreaterThan(0);
    expect(darken(0xffffff, 0.5)).toBeLessThan(0xffffff);
  });

  it('darken then lighten roughly round-trips a mid color', () => {
    const c = darken(0x808080, 0.5);
    expect(c).toBeLessThan(0x808080);
    expect(lighten(c, 0.5)).toBeGreaterThan(c);
  });

  it('ships non-empty named palettes', () => {
    expect(Object.keys(palettes).length).toBeGreaterThanOrEqual(3);
    for (const p of Object.values(palettes)) {
      expect(p.colors.length).toBeGreaterThan(0);
      expect(p.bg).toBeGreaterThanOrEqual(0);
    }
  });

  it('pickColor is deterministic under a seeded random', () => {
    const colors = [1, 2, 3, 4];
    expect(pickColor(colors, () => 0)).toBe(1);
    expect(pickColor(colors, () => 0.99)).toBe(4);
  });
});

describe('blobPoints', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = blobPoints({ radius: 30, seed: 7 });
    const b = blobPoints({ radius: 30, seed: 7 });
    const c = blobPoints({ radius: 30, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('keeps every point within the wobble envelope', () => {
    const pts = blobPoints({ radius: 100, seed: 3, wobble: 0.2 });
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.hypot(pts[i]!, pts[i + 1]!);
      expect(r).toBeGreaterThanOrEqual(79);
      expect(r).toBeLessThanOrEqual(121);
    }
  });
});
