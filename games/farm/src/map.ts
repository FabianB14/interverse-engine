import { darken, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 64;

export const TILE = {
  GRASS: 1,
  TREE: 2,
  HOUSE: 3,
  STALL: 4,
  WATER: 5,
  FLOWER: 6,
  PATH: 7,
} as const;

// 18 x 22 tiles = 1152 x 1408 — bigger than the 720x1280 view so the camera
// pans as you walk. `o` = a plot, `@` = spawn, `V` = the market vendor.
export const farmRows: readonly string[] = [
  '##################',
  '#................#',
  '#..HHHHH....FF...#',
  '#..HHHHH.........#',
  '#..HHHHH...VS....#',
  '#................#',
  '#..o.o.o.o......#'.padEnd(17, '.').slice(0, 17) + '#',
  '#................#',
  '#..o.o.o.o......#'.padEnd(17, '.').slice(0, 17) + '#',
  '#................#',
  '#.......@........#',
  '#.....G..........#',
  '#..wwww.....T....#',
  '#..wwww.........#'.padEnd(17, '.').slice(0, 17) + '#',
  '#..wwww.....F....#',
  '#................#',
  '#..F.........F...#',
  '#................#',
  '#......FF........#',
  '#................#',
  '#................#',
  '##################',
];

export const farmLegend: Record<string, TileLegendEntry> = {
  '#': { tile: TILE.TREE, solid: true },
  '.': { tile: TILE.GRASS },
  H: { tile: TILE.HOUSE, solid: true },
  S: { tile: TILE.STALL, solid: true },
  T: { tile: TILE.TREE, solid: true },
  w: { tile: TILE.WATER, solid: true },
  F: { tile: TILE.FLOWER },
  o: { tile: TILE.GRASS, object: 'plot' },
  V: { tile: TILE.GRASS, object: 'vendor' },
  G: { tile: TILE.GRASS, object: 'gift' },
  '@': { tile: TILE.GRASS, object: 'player' },
};

const GRASS = 0x7bab54;
const WATER = 0x4d90b0;

const paintGrass: TilePainter = (g, x, y, s, rng) => {
  const shade = rng() * 0.1;
  g.rect(x, y, s, s).fill(rng() > 0.5 ? lighten(GRASS, shade) : darken(GRASS, shade));
  if (rng() > 0.72) {
    g.rect(x + 8 + rng() * (s - 20), y + 10 + rng() * (s - 20), 3, 8).fill({
      color: darken(GRASS, 0.18),
      alpha: 0.6,
    });
  }
};

const paintTree: TilePainter = (g, x, y, s, rng) => {
  paintGrass(g, x, y, s, rng);
  const cx = x + s / 2;
  const cy = y + s / 2;
  g.roundRect(cx - 6, cy + 8, 12, 20, 4).fill(0x6b4a2f);
  g.circle(cx - 12, cy - 2, 16 + rng() * 4).fill(darken(0x4f7a34, 0.05));
  g.circle(cx + 12, cy - 4, 15 + rng() * 4).fill(0x4f7a34);
  g.circle(cx, cy - 16, 18 + rng() * 4).fill(lighten(0x4f7a34, 0.08));
};

const paintHouse: TilePainter = (g, x, y, s, rng) => {
  const wall = 0xd8a15a;
  g.rect(x, y, s, s).fill(rng() > 0.5 ? wall : darken(wall, 0.06));
  g.rect(x, y, s, s).stroke({ color: darken(wall, 0.3), width: 2 });
  for (let i = 1; i < 3; i++)
    g.rect(x, y + (s * i) / 3, s, 2).fill({ color: darken(wall, 0.25), alpha: 0.5 });
  if (rng() > 0.7) g.roundRect(x + s * 0.3, y + s * 0.3, s * 0.4, s * 0.4, 4).fill(0x9ad8ff);
};

const paintStall: TilePainter = (g, x, y, s, rng) => {
  paintGrass(g, x, y, s, rng);
  g.rect(x + 4, y + s * 0.3, s - 8, s * 0.7).fill(0xc98a4b);
  g.rect(x + 4, y + s * 0.3, s - 8, 6).fill(darken(0xc98a4b, 0.2));
  // striped awning
  const stripes = 4;
  for (let i = 0; i < stripes; i++) {
    g.rect(x + 4 + (i * (s - 8)) / stripes, y, (s - 8) / stripes, s * 0.3).fill(
      i % 2 === 0 ? 0xe07a5f : 0xfff3e2,
    );
  }
  void rng;
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

const paintFlower: TilePainter = (g, x, y, s, rng) => {
  paintGrass(g, x, y, s, rng);
  const fx = x + 16 + rng() * (s - 32);
  const fy = y + 16 + rng() * (s - 32);
  const petal = [0xffd166, 0xff9fb2, 0xf2ffe9, 0xc77dff][Math.floor(rng() * 4)] ?? 0xffd166;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.circle(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4).fill(petal);
  }
  g.circle(fx, fy, 3.5).fill(0xffd166);
};

const paintPath: TilePainter = (g, x, y, s, rng) => {
  const p = 0xcaa877;
  g.rect(x, y, s, s).fill(rng() > 0.5 ? p : darken(p, 0.08));
};

export const farmPainters: Record<number, TilePainter> = {
  [TILE.GRASS]: paintGrass,
  [TILE.TREE]: paintTree,
  [TILE.HOUSE]: paintHouse,
  [TILE.STALL]: paintStall,
  [TILE.WATER]: paintWater,
  [TILE.FLOWER]: paintFlower,
  [TILE.PATH]: paintPath,
};
