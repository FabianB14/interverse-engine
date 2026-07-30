import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { dungeonRows, islandRows, mazeRows, seededRng } from '../src/gen.js';
import { HATS, HELD_ITEMS, drawOutfit } from '../src/cosmetics.js';

/** All reachable floor tiles from the first floor tile (4-way flood fill). */
function connected(rows: string[], floors: Set<string>): { total: number; reached: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  let start: [number, number] | null = null;
  let total = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (floors.has(rows[r]![c]!)) {
        total++;
        start ??= [c, r];
      }
    }
  }
  if (!start) return { total: 0, reached: 0 };
  const seen = new Set<string>([start.join(',')]);
  const queue = [start];
  while (queue.length) {
    const [c, r] = queue.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (nc < 0 || nr < 0 || nc >= w || nr >= h || seen.has(key)) continue;
      if (!floors.has(rows[nr]![nc]!)) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return { total, reached: seen.size };
}

describe('procedural generators', () => {
  it('maze: right dimensions, walls + paths, every path reachable', () => {
    const rows = mazeRows(18, 32, seededRng(7));
    expect(rows.length).toBe(32);
    expect(rows[0]!.length).toBe(18);
    expect(rows.join('')).toMatch(/k/);
    const { total, reached } = connected(rows, new Set(['d']));
    expect(total).toBeGreaterThan(50);
    expect(reached).toBe(total); // perfect maze: fully connected
  });

  it('dungeon: rooms + corridors all connected', () => {
    const rows = dungeonRows(18, 32, seededRng(11));
    const { total, reached } = connected(rows, new Set(['p']));
    expect(total).toBeGreaterThan(30);
    expect(reached).toBe(total);
  });

  it('island: water at the borders, walkable heart in the middle', () => {
    const rows = islandRows(18, 32, seededRng(3));
    expect(rows[0]!.startsWith('w')).toBe(true);
    expect(rows[31]!.endsWith('w')).toBe(true);
    const centre = rows[16]![9];
    expect(['g', 'f', 's']).toContain(centre);
  });

  it('is deterministic under a seed', () => {
    expect(mazeRows(18, 32, seededRng(42))).toEqual(mazeRows(18, 32, seededRng(42)));
    expect(mazeRows(18, 32, seededRng(42))).not.toEqual(mazeRows(18, 32, seededRng(43)));
  });
});

describe('cosmetics', () => {
  it('ships hats and held items beyond bare', () => {
    expect(HATS.length).toBeGreaterThanOrEqual(6);
    expect(HELD_ITEMS.length).toBeGreaterThanOrEqual(5);
    expect(HATS[0]).toBe('');
  });

  it('drawOutfit renders every combination without throwing', () => {
    for (const hat of HATS) {
      for (const held of HELD_ITEMS) {
        const g = new Graphics();
        expect(() => drawOutfit(g, { hat, held, radius: 34, color: 0xff6f91 })).not.toThrow();
      }
    }
  });
});
