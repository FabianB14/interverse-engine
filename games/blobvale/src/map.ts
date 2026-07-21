import { darken, forestDeep, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 64;

export const TILE = { GRASS: 1, TREE: 2, WATER: 3, PATH: 4, FLOWER: 5 } as const;

// 26 x 34 tiles = 1664 x 2176 px — a glade with a lake, tree walls, and a
// path north toward the future mob camps / boss arena (Milestones 2–3).
export const valeRows: readonly string[] = [
  '##########################',
  '#..........pp...........#'.padEnd(26, '#').slice(0, 26),
  '#..f.......pp......f....#'.padEnd(26, '#').slice(0, 26),
  '#....m.....pp.....m.....#'.padEnd(26, '#').slice(0, 26),
  '#...##.....pp.....##....#'.padEnd(26, '#').slice(0, 26),
  '#...##.....pp.....##....#'.padEnd(26, '#').slice(0, 26),
  '#..........pp...........#'.padEnd(26, '#').slice(0, 26),
  '#..f.......pp......f....#'.padEnd(26, '#').slice(0, 26),
  '#..........pp...........#'.padEnd(26, '#').slice(0, 26),
  '#.....wwww.pp...........#'.padEnd(26, '#').slice(0, 26),
  '#....wwwwww.pp......##..#'.padEnd(26, '#').slice(0, 26),
  '#....wwwwww..pp.....##..#'.padEnd(26, '#').slice(0, 26),
  '#.....wwww....pp........#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#......f...m...pp...f...#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#....##........pp..m....#'.padEnd(26, '#').slice(0, 26),
  '#....##........pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#...........@..pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..f...........pp...f...#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#.....##.......pp.......#'.padEnd(26, '#').slice(0, 26),
  '#.....##.......pp..##...#'.padEnd(26, '#').slice(0, 26),
  '#..............pp..##...#'.padEnd(26, '#').slice(0, 26),
  '#......wwww....pp.......#'.padEnd(26, '#').slice(0, 26),
  '#.....wwwwww...pp.......#'.padEnd(26, '#').slice(0, 26),
  '#......wwww....pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..f.......f...pp...f...#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '#..............pp.......#'.padEnd(26, '#').slice(0, 26),
  '##########################',
];

export const valeLegend: Record<string, TileLegendEntry> = {
  '#': { tile: TILE.TREE, solid: true },
  '.': { tile: TILE.GRASS },
  w: { tile: TILE.WATER, solid: true },
  p: { tile: TILE.PATH },
  f: { tile: TILE.FLOWER },
  '@': { tile: TILE.GRASS, object: 'spawn' },
  m: { tile: TILE.GRASS, object: 'camp' },
};

const GRASS = 0x3d6b3a;
const WATER = 0x3a6d9c;
const PATH = 0x9c8556;

const paintGrass: TilePainter = (g, x, y, s, rng) => {
  const shade = rng() * 0.09;
  g.rect(x, y, s, s).fill(rng() > 0.5 ? lighten(GRASS, shade) : darken(GRASS, shade));
  if (rng() > 0.7) {
    g.rect(x + 8 + rng() * (s - 20), y + 8 + rng() * (s - 20), 3, 8).fill({
      color: lighten(GRASS, 0.2),
      alpha: 0.7,
    });
  }
};

const paintTree: TilePainter = (g, x, y, s, rng) => {
  paintGrass(g, x, y, s, rng);
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.roundRect(cx - 6, cy + 6, 12, 18, 4).fill(0x5c4327);
  g.circle(cx - 10, cy - 2, 16 + rng() * 4).fill(darken(GRASS, 0.25));
  g.circle(cx + 10, cy - 4, 15 + rng() * 4).fill(darken(GRASS, 0.15));
  g.circle(cx, cy - 14, 17 + rng() * 4).fill(darken(GRASS, 0.05));
};

const paintWater: TilePainter = (g, x, y, s, rng) => {
  g.rect(x, y, s, s).fill(rng() > 0.5 ? WATER : darken(WATER, 0.08));
  if (rng() > 0.6) {
    g.ellipse(x + 12 + rng() * (s - 24), y + 12 + rng() * (s - 24), 8, 3).fill({
      color: lighten(WATER, 0.25),
      alpha: 0.6,
    });
  }
};

const paintPath: TilePainter = (g, x, y, s, rng) => {
  g.rect(x, y, s, s).fill(rng() > 0.5 ? PATH : darken(PATH, 0.08));
  if (rng() > 0.65) {
    g.circle(x + 10 + rng() * (s - 20), y + 10 + rng() * (s - 20), 3).fill({
      color: darken(PATH, 0.3),
      alpha: 0.6,
    });
  }
};

const paintFlower: TilePainter = (g, x, y, s, rng) => {
  paintGrass(g, x, y, s, rng);
  const fx = x + 16 + rng() * (s - 32);
  const fy = y + 16 + rng() * (s - 32);
  const petal = [0xffd166, 0xff9fb2, 0xf2ffe9][Math.floor(rng() * 3)] ?? 0xffd166;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.circle(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4).fill(petal);
  }
  g.circle(fx, fy, 3.5).fill(forestDeep.accent);
};

export const valePainters: Record<number, TilePainter> = {
  [TILE.GRASS]: paintGrass,
  [TILE.TREE]: paintTree,
  [TILE.WATER]: paintWater,
  [TILE.PATH]: paintPath,
  [TILE.FLOWER]: paintFlower,
};
