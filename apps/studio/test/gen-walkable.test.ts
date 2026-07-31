import { describe, expect, it } from 'vitest';
import { MIN_GAP_TILES, generateRows, seededRng } from '../src/gen.js';

const SOLID = new Set(['w', 'k', 't', 'b']);
const isOpen = (rows: string[], c: number, r: number): boolean => {
  const ch = rows[r]?.[c];
  return ch !== undefined && !SOLID.has(ch);
};

/** The narrowest walkable run anywhere, along either axis. */
function narrowestGap(rows: string[]): number {
  const cols = rows[0]!.length;
  let min = Infinity;
  const scan = (get: (i: number) => boolean, len: number): void => {
    let run = 0;
    for (let i = 0; i < len; i++) {
      if (get(i)) run++;
      else {
        if (run) min = Math.min(min, run);
        run = 0;
      }
    }
    if (run) min = Math.min(min, run);
  };
  for (let r = 0; r < rows.length; r++) scan((c) => isOpen(rows, c, r), cols);
  for (let c = 0; c < cols; c++) scan((r) => isOpen(rows, c, r), rows.length);
  return min === Infinity ? 0 : min;
}

/** Can you actually get everywhere? Flood from the largest open area. */
function reachableFraction(rows: string[]): number {
  const cols = rows[0]!.length;
  const seen = new Set<string>();
  let total = 0;
  let best = 0;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) if (isOpen(rows, c, r)) total++;
  }
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isOpen(rows, c, r) || seen.has(`${c},${r}`)) continue;
      let size = 0;
      const stack = [[c, r]];
      seen.add(`${c},${r}`);
      while (stack.length) {
        const [x, y] = stack.pop()!;
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx!;
          const ny = y + dy!;
          const k = `${nx},${ny}`;
          if (isOpen(rows, nx, ny) && !seen.has(k)) {
            seen.add(k);
            stack.push([nx, ny]);
          }
        }
      }
      best = Math.max(best, size);
    }
  }
  return total ? best / total : 0;
}

describe('a generated level has to be walkable', () => {
  const kinds = ['maze', 'dungeon', 'island'] as const;

  /** Tiles are 40 units and a character is drawn ~68 across, so a one-tile
   *  corridor is narrower than the person walking down it: the art overlaps
   *  both walls and every corner snags. */
  it.each(kinds)('leaves no gap narrower than a character (%s)', (kind) => {
    for (let seed = 1; seed <= 12; seed++) {
      const rows = generateRows(kind, 18, 32, seededRng(seed));
      expect(narrowestGap(rows), `${kind} seed ${seed}`).toBeGreaterThanOrEqual(MIN_GAP_TILES);
    }
  });

  /** Widening must not have carved the map into islands you cannot reach. */
  it.each(kinds)('keeps nearly all of it reachable (%s)', (kind) => {
    for (let seed = 1; seed <= 8; seed++) {
      const rows = generateRows(kind, 18, 32, seededRng(seed));
      expect(reachableFraction(rows), `${kind} seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it.each(kinds)('still fills the level it was asked for (%s)', (kind) => {
    const rows = generateRows(kind, 18, 32, seededRng(3));
    expect(rows).toHaveLength(32);
    expect(rows.every((r) => r.length === 18)).toBe(true);
  });

  /** A maze with no walls left is not a maze — widening must not flatten it. */
  it('still builds a maze worth solving', () => {
    const rows = generateRows('maze', 18, 32, seededRng(5));
    const all = rows.join('');
    const walls = [...all].filter((c) => c === 'k').length;
    expect(walls / all.length).toBeGreaterThan(0.2);
    expect(walls / all.length).toBeLessThan(0.8);
  });

  it('is the same level every time for the same seed', () => {
    for (const kind of kinds) {
      expect(generateRows(kind, 18, 32, seededRng(9))).toEqual(
        generateRows(kind, 18, 32, seededRng(9)),
      );
    }
  });
});
