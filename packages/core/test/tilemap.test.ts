import { describe, expect, it } from 'vitest';
import { moveWithCollision, solidAt, tileMapFromRows } from '../src/world/TileMap.js';
import type { TileLegendEntry } from '../src/world/TileMap.js';

const LEGEND: Record<string, TileLegendEntry> = {
  '.': { tile: 1 },
  '#': { tile: 2, solid: true },
  S: { tile: 1, object: 'spawn' },
};

const map = (rows: string[]) => tileMapFromRows(rows, 40, LEGEND);

describe('tileMapFromRows', () => {
  it('builds ground, solids, and named objects', () => {
    const m = map(['.#.', '.S.']);
    expect(m.width).toBe(3);
    expect(m.height).toBe(2);
    expect(m.ground[0]).toEqual([1, 2, 1]);
    expect(m.solid[0]).toEqual([false, true, false]);
    expect(m.objects).toEqual([{ name: 'spawn', x: 60, y: 60, tileX: 1, tileY: 1 }]);
  });

  it('rejects ragged rows and unknown characters', () => {
    expect(() => map(['..', '...'])).toThrow(/row 1/);
    expect(() => map(['.?'])).toThrow(/no legend entry/);
  });
});

describe('solidAt', () => {
  it('treats out-of-bounds as solid so nothing escapes the map', () => {
    const m = map(['..']);
    expect(solidAt(m, -1, 0)).toBe(true);
    expect(solidAt(m, 0, -1)).toBe(true);
    expect(solidAt(m, 2, 0)).toBe(true);
    expect(solidAt(m, 0, 1)).toBe(true);
    expect(solidAt(m, 0, 0)).toBe(false);
  });
});

describe('moveWithCollision', () => {
  // 5x3 room: solid border, open middle row.
  const m = map(['#####', '#...#', '#####']);

  it('moves freely across open floor', () => {
    const p = moveWithCollision(m, 60, 60, 10, 10, 40, 0);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(60);
  });

  it('stops at a wall across repeated frame-sized steps', () => {
    // Contract: per-frame steps (a few px at 60Hz), not teleports. The east
    // wall starts at x=160, so the center may never pass 160 - halfW.
    let x = 140;
    for (let i = 0; i < 20; i++) x = moveWithCollision(m, x, 60, 10, 10, 8, 0).x;
    expect(x).toBeLessThanOrEqual(150);
    expect(x).toBeGreaterThan(145); // pinned right against the wall
  });

  it('slides along a wall while blocked on the other axis', () => {
    // Push diagonally up-right every frame: x pins at the east wall while
    // y pins against the north wall (its face is y=40, halfH 10 -> ~50).
    let x = 100;
    let y = 60;
    for (let i = 0; i < 30; i++) {
      const p = moveWithCollision(m, x, y, 10, 10, 8, -8);
      x = p.x;
      y = p.y;
    }
    expect(x).toBeLessThanOrEqual(150);
    expect(x).toBeGreaterThan(145);
    expect(y).toBeGreaterThanOrEqual(50);
    expect(y).toBeLessThan(52);
  });
});
