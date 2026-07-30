import { describe, expect, it } from 'vitest';
import {
  TILE_SIZE,
  anyTiles,
  colsFor,
  emptyRows,
  normalizeRows,
  rowsFor,
  setTileChar,
  tileCharAt,
} from '../src/tiles.js';
import { DEPTH_LANE_SPEED, DEPTH_MIN_Y, DEPTH_WORLD_H, depthScale } from '../src/runtime.js';

describe('tile grid sizing', () => {
  it('derives grid dimensions from world size', () => {
    expect(colsFor(720)).toBe(720 / TILE_SIZE);
    expect(rowsFor(1280)).toBe(1280 / TILE_SIZE);
    expect(colsFor(2160)).toBe(2160 / TILE_SIZE);
  });

  it('normalizeRows pads and trims to the target grid', () => {
    const rows = normalizeRows(['gg', 'g'], 4, 3);
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.length).toBe(4);
    expect(rows[0]!.startsWith('gg')).toBe(true);
    const trimmed = normalizeRows(['gggggg', 'gggggg', 'gggggg', 'gggggg'], 2, 2);
    expect(trimmed).toEqual(['gg', 'gg']);
  });

  it('setTileChar/tileCharAt respect bounds', () => {
    const rows = emptyRows(3, 2);
    setTileChar(rows, 1, 1, 'w');
    expect(tileCharAt(rows, 1, 1)).toBe('w');
    setTileChar(rows, 99, 0, 'w'); // silently out of bounds
    expect(tileCharAt(rows, 99, 0)).toBe('.');
    expect(anyTiles(rows)).toBe(true);
    expect(anyTiles(emptyRows(2, 2))).toBe(false);
    expect(anyTiles(undefined)).toBe(false);
  });
});

describe('2.5D depth math', () => {
  it('boards are one landscape screen tall with a horizon', () => {
    expect(DEPTH_WORLD_H).toBe(720);
    expect(DEPTH_MIN_Y).toBeGreaterThan(0);
    expect(DEPTH_MIN_Y).toBeLessThan(DEPTH_WORLD_H);
    expect(DEPTH_LANE_SPEED).toBeGreaterThan(0);
    expect(DEPTH_LANE_SPEED).toBeLessThan(1);
  });

  it('scaling is subtle (Castle Crashers), clamped, and monotonic', () => {
    expect(depthScale(DEPTH_MIN_Y)).toBeCloseTo(0.82, 2);
    expect(depthScale(DEPTH_WORLD_H)).toBeCloseTo(1.0, 2);
    expect(depthScale(-999)).toBeCloseTo(0.82, 2); // clamped above the horizon
    expect(depthScale(99999)).toBeCloseTo(1.0, 2);
    expect(depthScale(400)).toBeLessThan(depthScale(600));
  });
});
