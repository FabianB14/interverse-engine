import { darken, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 64;

export const TILE = {
  FLOOR: 1,
  WALL: 2,
  RUG: 3,
  PLANT: 4,
  TABLE: 5,
} as const;

// 18 x 22 tiles = 1152 x 1408 px — larger than the 720x1280 design view,
// so the camera has room to pan on both axes.
export const roomRows: readonly string[] = [
  '##################',
  '#................#',
  '#.p............p.#',
  '#................#',
  '#....rrrrrr......#',
  '#....rrrrrr.tt...#',
  '#....rrrrrr.tt...#',
  '#....rrrrrr......#',
  '#......F.........#',
  '#................#',
  '#................#',
  '#................#',
  '#.t..............#',
  '#.t..........p...#',
  '#................#',
  '#.......@........#',
  '#................#',
  '#................#',
  '#.p..............#',
  '#................#',
  '#...........p....#',
  '##################',
];

export const roomLegend: Record<string, TileLegendEntry> = {
  '#': { tile: TILE.WALL, solid: true },
  '.': { tile: TILE.FLOOR },
  r: { tile: TILE.RUG },
  p: { tile: TILE.PLANT, solid: true },
  t: { tile: TILE.TABLE, solid: true },
  F: { tile: TILE.FLOOR, object: 'fern' },
  '@': { tile: TILE.FLOOR, object: 'player' },
};

const FLOOR_COLOR = 0x4a3527;
const WALL_COLOR = 0x241611;
const RUG_COLOR = 0xa26769;
const WOOD_COLOR = 0xc98a4b;
const LEAF_COLOR = 0x81b29a;

const paintFloor: TilePainter = (g, x, y, s, rng) => {
  // Subtle per-tile shade variation reads as wooden planks.
  const shade = rng() * 0.08;
  g.rect(x, y, s, s).fill(rng() > 0.5 ? lighten(FLOOR_COLOR, shade) : darken(FLOOR_COLOR, shade));
  g.rect(x, y + s - 2, s, 2).fill({ color: darken(FLOOR_COLOR, 0.35), alpha: 0.6 });
  if (rng() > 0.82) {
    g.circle(x + 8 + rng() * (s - 16), y + 8 + rng() * (s - 16), 3).fill({
      color: darken(FLOOR_COLOR, 0.4),
      alpha: 0.5,
    });
  }
};

const paintWall: TilePainter = (g, x, y, s, rng) => {
  g.rect(x, y, s, s).fill(rng() > 0.5 ? WALL_COLOR : darken(WALL_COLOR, 0.12));
  g.rect(x, y, s, 6).fill({ color: lighten(WALL_COLOR, 0.12), alpha: 0.8 });
};

const paintRug: TilePainter = (g, x, y, s, rng) => {
  paintFloor(g, x, y, s, rng);
  g.rect(x + 1, y + 1, s - 2, s - 2).fill({ color: RUG_COLOR, alpha: 0.95 });
  // Stitch dots.
  for (let i = 0; i < 3; i++) {
    g.circle(x + 10 + rng() * (s - 20), y + 10 + rng() * (s - 20), 2.5).fill({
      color: 0xf2cc8f,
      alpha: 0.7,
    });
  }
};

const paintPlant: TilePainter = (g, x, y, s, rng) => {
  paintFloor(g, x, y, s, rng);
  const cx = x + s / 2;
  g.roundRect(cx - 14, y + s - 26, 28, 20, 6).fill(darken(WOOD_COLOR, 0.15));
  for (let i = 0; i < 4; i++) {
    const lx = cx + (rng() * 2 - 1) * 14;
    const ly = y + s - 30 - rng() * 18;
    g.circle(lx, ly, 9 + rng() * 5).fill(i % 2 === 0 ? LEAF_COLOR : darken(LEAF_COLOR, 0.18));
  }
};

const paintTable: TilePainter = (g, x, y, s, rng) => {
  paintFloor(g, x, y, s, rng);
  g.roundRect(x + 4, y + 4, s - 8, s - 8, 10).fill(WOOD_COLOR);
  g.roundRect(x + 4, y + 4, s - 8, 10, 10).fill({ color: lighten(WOOD_COLOR, 0.18), alpha: 0.9 });
};

export const roomPainters: Record<number, TilePainter> = {
  [TILE.FLOOR]: paintFloor,
  [TILE.WALL]: paintWall,
  [TILE.RUG]: paintRug,
  [TILE.PLANT]: paintPlant,
  [TILE.TABLE]: paintTable,
};
