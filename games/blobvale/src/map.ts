import { darken, forestDeep, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 64;

export const TILE = { GRASS: 1, TREE: 2, WATER: 3, PATH: 4, FLOWER: 5 } as const;

// 26 x 34 tiles = 1664 x 2176 px — a glade with a lake, tree walls, and a
// path north toward the future mob camps / boss arena (Milestones 2–3).
export const valeRows: readonly string[] = [
  '##########################',
  '#..........Bp...........#'.padEnd(26, '#').slice(0, 26),
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
  B: { tile: TILE.GRASS, object: 'boss' },
};

/**
 * A zone's ground palette. The same map layout is repainted in three very
 * different looks as the party advances past each boss (M6 levels).
 */
export interface ZonePalette {
  ground: number;
  water: number;
  path: number;
  trunk: number;
  leaf: number;
  petals: number[];
  accent: number;
  /** Letterbox / backdrop tint for this zone. */
  bg: number;
}

/** Build the five tile painters for a zone from its palette. */
function makePainters(pal: ZonePalette): Record<number, TilePainter> {
  const paintGround: TilePainter = (g, x, y, s, rng) => {
    const shade = rng() * 0.09;
    g.rect(x, y, s, s).fill(rng() > 0.5 ? lighten(pal.ground, shade) : darken(pal.ground, shade));
    if (rng() > 0.7) {
      g.rect(x + 8 + rng() * (s - 20), y + 8 + rng() * (s - 20), 3, 8).fill({
        color: lighten(pal.ground, 0.2),
        alpha: 0.7,
      });
    }
  };
  const paintTree: TilePainter = (g, x, y, s, rng) => {
    paintGround(g, x, y, s, rng);
    const cx = x + s / 2;
    const cy = y + s / 2;
    g.roundRect(cx - 6, cy + 6, 12, 18, 4).fill(pal.trunk);
    g.circle(cx - 10, cy - 2, 16 + rng() * 4).fill(darken(pal.leaf, 0.2));
    g.circle(cx + 10, cy - 4, 15 + rng() * 4).fill(darken(pal.leaf, 0.1));
    g.circle(cx, cy - 14, 17 + rng() * 4).fill(pal.leaf);
  };
  const paintWater: TilePainter = (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(rng() > 0.5 ? pal.water : darken(pal.water, 0.08));
    if (rng() > 0.6) {
      g.ellipse(x + 12 + rng() * (s - 24), y + 12 + rng() * (s - 24), 8, 3).fill({
        color: lighten(pal.water, 0.25),
        alpha: 0.6,
      });
    }
  };
  const paintPath: TilePainter = (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(rng() > 0.5 ? pal.path : darken(pal.path, 0.08));
    if (rng() > 0.65) {
      g.circle(x + 10 + rng() * (s - 20), y + 10 + rng() * (s - 20), 3).fill({
        color: darken(pal.path, 0.3),
        alpha: 0.6,
      });
    }
  };
  const paintFlower: TilePainter = (g, x, y, s, rng) => {
    paintGround(g, x, y, s, rng);
    const fx = x + 16 + rng() * (s - 32);
    const fy = y + 16 + rng() * (s - 32);
    const petal = pal.petals[Math.floor(rng() * pal.petals.length)] ?? pal.accent;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.circle(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4).fill(petal);
    }
    g.circle(fx, fy, 3.5).fill(pal.accent);
  };
  return {
    [TILE.GRASS]: paintGround,
    [TILE.TREE]: paintTree,
    [TILE.WATER]: paintWater,
    [TILE.PATH]: paintPath,
    [TILE.FLOWER]: paintFlower,
  };
}

export interface ZoneDef {
  id: string;
  name: string;
  palette: ZonePalette;
  painters: Record<number, TilePainter>;
}

function zone(id: string, name: string, palette: ZonePalette): ZoneDef {
  return { id, name, palette, painters: makePainters(palette) };
}

/**
 * The three levels, cycled as bosses fall. Layout is shared (collision and
 * spawns stay identical); only the paint changes, so each level reads as a
 * distinct place. Boss kind matches the zone index (Vale→Slime, Frost→
 * Wraith, Ember→Titan).
 */
export const ZONES: ZoneDef[] = [
  zone('vale', 'Green Vale', {
    ground: 0x3d6b3a,
    water: 0x3a6d9c,
    path: 0x9c8556,
    trunk: 0x5c4327,
    leaf: 0x3d6b3a,
    petals: [0xffd166, 0xff9fb2, 0xf2ffe9],
    accent: forestDeep.accent,
    bg: 0x1c2418,
  }),
  zone('frost', 'Frostpeak', {
    ground: 0xbcd6e6,
    water: 0x7fd0e8,
    path: 0x8f9bb0,
    trunk: 0x6b7280,
    leaf: 0x9fc6d6,
    petals: [0xdff6ff, 0xbdf0ff, 0xffffff],
    accent: 0x2f7fa0,
    bg: 0x1a2733,
  }),
  zone('ember', 'Ember Wastes', {
    ground: 0x4a3b34,
    water: 0xd9622b,
    path: 0x5a4a44,
    trunk: 0x241a18,
    leaf: 0x6b3b2b,
    petals: [0xffd166, 0xff7a3b, 0xff5470],
    accent: 0xff7a3b,
    bg: 0x2a1a16,
  }),
];

/** Zone 0 painters — kept as the original export for existing callers. */
export const valePainters: Record<number, TilePainter> = ZONES[0]!.painters;
