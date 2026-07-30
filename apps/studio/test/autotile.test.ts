import { describe, expect, it } from 'vitest';
import { neighborMask, tileMapFromRows } from '@interverse/engine';
import { TILE_SIZE, legend, sameTerrain } from '../src/tiles.js';

const mapOf = (rows: string[]) => tileMapFromRows(rows, TILE_SIZE, legend);

describe('autotiling neighbor masks', () => {
  it('an interior tile of one terrain has all-same neighbors (no edges)', () => {
    const m = mapOf(['ggg', 'ggg', 'ggg']);
    expect(neighborMask(m, 1, 1, sameTerrain)).toBe(15);
  });

  it('map borders count as same so the world edge grows no fringe', () => {
    const m = mapOf(['gg', 'gg']);
    expect(neighborMask(m, 0, 0, sameTerrain)).toBe(15);
  });

  it('terrain boundaries open the facing edge', () => {
    // water row above grass row: grass tile (1,1) is open to the north
    const m = mapOf(['www', 'ggg', 'ggg']);
    const mask = neighborMask(m, 1, 1, sameTerrain);
    expect(mask & 1).toBe(0); // north differs -> edge drawn
    expect(mask & 2).toBe(2); // east same
    expect(mask & 4).toBe(4); // south same
    expect(mask & 8).toBe(8); // west same
    // and the water tile above is open to the south (the shoreline)
    expect(neighborMask(m, 1, 0, sameTerrain) & 4).toBe(0);
  });

  it('grass and flowers belong to one terrain group (no seam between them)', () => {
    const m = mapOf(['gfg']);
    expect(neighborMask(m, 1, 0, sameTerrain)).toBe(15);
  });

  it('painted terrain against unpainted background counts as an edge', () => {
    const m = mapOf(['.g.']);
    const mask = neighborMask(m, 1, 0, sameTerrain);
    expect(mask & 2).toBe(0);
    expect(mask & 8).toBe(0);
  });

  it('different solid walls do not bond with each other', () => {
    const m = mapOf(['kb']);
    expect(neighborMask(m, 0, 0, sameTerrain) & 2).toBe(0);
    // ...but bricks bond with bricks
    const m2 = mapOf(['bb']);
    expect(neighborMask(m2, 0, 0, sameTerrain) & 2).toBe(2);
  });
});
