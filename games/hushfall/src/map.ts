import { darken, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';
import { NIGHT } from './theme.js';

export const TILE_SIZE = 64;

export const TILE = { GROUND: 1, WALL: 2, PATH: 3, TOMB: 4, BUSH: 5 } as const;

export const legend: Record<string, TileLegendEntry> = {
  '#': { tile: TILE.WALL, solid: true },
  '.': { tile: TILE.GROUND },
  p: { tile: TILE.PATH },
  t: { tile: TILE.TOMB, solid: true },
  b: { tile: TILE.BUSH, object: 'bush' },
  L: { tile: TILE.PATH, object: 'lantern' },
  G: { tile: TILE.PATH, object: 'gate' },
  '@': { tile: TILE.PATH, object: 'spawn' },
  S: { tile: TILE.PATH, object: 'seekerspawn' },
};

const CH: Record<number, string> = {
  [TILE.GROUND]: '.',
  [TILE.WALL]: '#',
  [TILE.PATH]: 'p',
  [TILE.TOMB]: 't',
  [TILE.BUSH]: 'b',
};

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const W = 34;
const H = 30;

/**
 * A moonlit graveyard arena, generated deterministically so the host and every
 * client agree on collision. Fixed anchors (hider spawn south, Seeker spawn
 * centre, escape gate north, five lanterns in a spread ring) are kept clear;
 * crypt walls, tombstones and hedges are scattered between them for cover and
 * sightline breaks, with hedges doubling as hiding spots.
 */
export function generateArena(seed = 4207): string[] {
  const rng = lcg(seed);
  const grid: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(TILE.GROUND));
  const set = (x: number, y: number, t: number): void => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[y]![x] = t;
  };
  for (let x = 0; x < W; x++) {
    grid[0]![x] = TILE.WALL;
    grid[H - 1]![x] = TILE.WALL;
  }
  for (let y = 0; y < H; y++) {
    grid[y]![0] = TILE.WALL;
    grid[y]![W - 1] = TILE.WALL;
  }

  const anchors: [number, number][] = [
    [Math.floor(W / 2), H - 3], // hider spawn
    [Math.floor(W / 2), Math.floor(H / 2)], // seeker spawn
    [Math.floor(W / 2), 2], // gate
    [6, 6],
    [W - 7, 6],
    [6, H - 7],
    [W - 7, H - 7],
    [Math.floor(W / 2), 8], // fifth lantern up top
  ];
  const clear = new Set<string>();
  for (const [ax, ay] of anchors) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) clear.add(`${ax + dx},${ay + dy}`);
  }
  const near = (x: number, y: number): boolean => clear.has(`${x},${y}`);

  // Crypt-wall stubs (solid cover).
  for (let i = 0; i < 14; i++) {
    const horiz = rng() > 0.5;
    const len = 2 + Math.floor(rng() * 3);
    const cx = 3 + Math.floor(rng() * (W - 6));
    const cy = 3 + Math.floor(rng() * (H - 6));
    for (let k = 0; k < len; k++) {
      const x = cx + (horiz ? k : 0);
      const y = cy + (horiz ? 0 : k);
      if (!near(x, y)) set(x, y, TILE.WALL);
    }
  }
  // Tombstones (small solid obstacles).
  for (let i = 0; i < 26; i++) {
    const x = 2 + Math.floor(rng() * (W - 4));
    const y = 2 + Math.floor(rng() * (H - 4));
    if (!near(x, y) && grid[y]![x] === TILE.GROUND) set(x, y, TILE.TOMB);
  }
  // Hedges (walkable hiding spots).
  for (let i = 0; i < 30; i++) {
    const x = 2 + Math.floor(rng() * (W - 4));
    const y = 2 + Math.floor(rng() * (H - 4));
    if (!near(x, y) && grid[y]![x] === TILE.GROUND) set(x, y, TILE.BUSH);
  }

  const rows = grid.map((row) => row.map((t) => CH[t] ?? '.').join(''));
  const stamp = (x: number, y: number, ch: string): void => {
    const r = rows[y]!;
    rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
  };
  stamp(anchors[0]![0], anchors[0]![1], '@');
  stamp(anchors[1]![0], anchors[1]![1], 'S');
  stamp(anchors[2]![0], anchors[2]![1], 'G');
  for (const [lx, ly] of [anchors[3]!, anchors[4]!, anchors[5]!, anchors[6]!, anchors[7]!]) stamp(lx, ly, 'L');
  return rows;
}

export const arenaRows: readonly string[] = generateArena();

/** Tile painters — moonlit stone, dirt, crypt walls, tombstones, hedges. */
export const painters: Record<number, TilePainter> = {
  [TILE.GROUND]: (g, x, y, s, rng) => {
    const base = rng() > 0.5 ? NIGHT.ground : NIGHT.groundAlt;
    g.rect(x, y, s, s).fill(base);
    if (rng() > 0.82) g.circle(x + rng() * s, y + rng() * s, 2).fill({ color: lighten(base, 0.3), alpha: 0.5 });
  },
  [TILE.PATH]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(rng() > 0.5 ? NIGHT.path : darken(NIGHT.path, 0.1));
    if (rng() > 0.7) g.rect(x + 8, y + 8, s - 16, s - 16).stroke({ color: lighten(NIGHT.path, 0.15), alpha: 0.3, width: 2 });
  },
  [TILE.WALL]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(NIGHT.wall);
    g.rect(x + 3, y + 3, s - 6, s - 6).fill(rng() > 0.5 ? 0x1c1a2a : 0x181626);
    g.rect(x + 3, y + s / 2 - 1, s - 6, 2).fill({ color: 0x0a0912, alpha: 0.8 });
  },
  [TILE.TOMB]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(NIGHT.ground);
    const cx = x + s / 2;
    g.roundRect(cx - s * 0.22, y + s * 0.2, s * 0.44, s * 0.7, s * 0.2).fill(0x3a3850);
    g.roundRect(cx - s * 0.22, y + s * 0.2, s * 0.44, s * 0.7, s * 0.2).stroke({ color: 0x14121e, width: 3 });
    if (rng() > 0.5)
      g.moveTo(cx, y + s * 0.34)
        .lineTo(cx, y + s * 0.56)
        .moveTo(cx - s * 0.1, y + s * 0.42)
        .lineTo(cx + s * 0.1, y + s * 0.42)
        .stroke({ color: 0x14121e, width: 3 });
  },
  [TILE.BUSH]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(NIGHT.ground);
    const cx = x + s / 2;
    const cy = y + s / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.circle(cx + Math.cos(a) * s * 0.2, cy + Math.sin(a) * s * 0.2, s * 0.2 + rng() * 4).fill(
        i % 2 ? NIGHT.hedge : darken(NIGHT.hedge, 0.15),
      );
    }
    g.circle(cx, cy, s * 0.22).fill(lighten(NIGHT.hedge, 0.05));
  },
};
