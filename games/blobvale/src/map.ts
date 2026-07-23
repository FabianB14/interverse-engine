import { darken, forestDeep, lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 64;

export const TILE = { GRASS: 1, TREE: 2, WATER: 3, PATH: 4, FLOWER: 5 } as const;

/** Shared legend for every zone (layout differs, tile meanings don't). */
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

// ------------------------------------------------------- level generator
//
// Each level is a long, winding trek from a spawn at the south edge up to a
// boss lair at the north, with mob camps strung along the road. Layouts are
// generated deterministically from a per-zone seed so the HOST and every
// CLIENT build byte-identical collision — nobody can walk through a wall the
// others see. Cosmetics (tile shading) are handled separately by painters.

/** Tiny deterministic PRNG (no Math.random — hosts/clients must agree). */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface LevelOpts {
  seed: number;
  /** Tiles across / down. Taller = a longer adventure. */
  w: number;
  h: number;
  /** How many mob camps to string along the road. */
  camps: number;
  ponds: number;
  treeClusters: number;
  flowers: number;
}

const CH: Record<number, string> = {
  [TILE.GRASS]: '.',
  [TILE.TREE]: '#',
  [TILE.WATER]: 'w',
  [TILE.PATH]: 'p',
  [TILE.FLOWER]: 'f',
};

/** Build one level's ASCII rows from a seed (deterministic across peers). */
export function generateLevel(o: LevelOpts): string[] {
  const rng = lcg(o.seed);
  const W = o.w;
  const H = o.h;
  const grid: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(TILE.GRASS));
  const set = (x: number, y: number, t: number): void => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[y]![x] = t;
  };

  // Solid tree border.
  for (let x = 0; x < W; x++) {
    grid[0]![x] = TILE.TREE;
    grid[H - 1]![x] = TILE.TREE;
  }
  for (let y = 0; y < H; y++) {
    grid[y]![0] = TILE.TREE;
    grid[y]![W - 1] = TILE.TREE;
  }

  // Winding road (width 3) from the south edge up to the north lair. Record
  // each row's centre so we can hang camps/spawn/boss off it.
  const center: number[] = Array<number>(H).fill(Math.floor(W / 2));
  let px = Math.floor(W / 2);
  for (let y = H - 2; y >= 1; y--) {
    const wob = rng();
    if (wob < 0.3) px -= 1;
    else if (wob > 0.7) px += 1;
    px = Math.max(3, Math.min(W - 4, px));
    center[y] = px;
    for (let dx = -1; dx <= 1; dx++) set(px + dx, y, TILE.PATH);
  }

  // Clearance: no solids within 2 tiles of the road (keeps it walkable).
  const clear = new Set<string>();
  for (let y = 1; y < H - 1; y++) {
    const c = center[y]!;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) clear.add(`${c + dx},${y + dy}`);
    }
  }
  const near = (x: number, y: number): boolean => clear.has(`${x},${y}`);

  // Ponds (solid water) tucked away from the road.
  for (let i = 0; i < o.ponds; i++) {
    const cx = 2 + Math.floor(rng() * (W - 4));
    const cy = 3 + Math.floor(rng() * (H - 6));
    const r = 2 + Math.floor(rng() * 2);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (near(x, y)) continue;
        if (Math.hypot(x - cx, y - cy) <= r) set(x, y, TILE.WATER);
      }
    }
  }

  // Tree thickets fencing the meadows in.
  for (let i = 0; i < o.treeClusters; i++) {
    const cx = 2 + Math.floor(rng() * (W - 4));
    const cy = 3 + Math.floor(rng() * (H - 6));
    const r = 1 + Math.floor(rng() * 2);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (near(x, y) || grid[y]?.[x] === TILE.WATER) continue;
        if (Math.hypot(x - cx, y - cy) <= r && rng() > 0.25) set(x, y, TILE.TREE);
      }
    }
  }

  // Wildflowers on open grass.
  for (let i = 0; i < o.flowers; i++) {
    const x = 1 + Math.floor(rng() * (W - 2));
    const y = 1 + Math.floor(rng() * (H - 2));
    if (grid[y]?.[x] === TILE.GRASS) set(x, y, TILE.FLOWER);
  }

  // To chars, then stamp the markers so they always win.
  const rows = grid.map((row) => row.map((t) => CH[t] ?? '.').join(''));
  const stamp = (x: number, y: number, ch: string): void => {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return;
    const r = rows[y]!;
    rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
  };

  // Spawn at the foot of the road, boss lair at its head.
  const spawnY = H - 2;
  const bossY = 2;
  stamp(center[spawnY]!, spawnY, '@');
  stamp(center[bossY]!, bossY, 'B');

  // Camps evenly spaced up the road, set just off to one side on open ground.
  for (let k = 0; k < o.camps; k++) {
    const y = Math.round(H - 6 - ((H - 12) * k) / Math.max(1, o.camps - 1));
    if (y <= bossY + 2 || y >= spawnY - 1) continue;
    const c = center[y]!;
    const side = c < W / 2 ? 3 : -3;
    let cx = c + side;
    if (cx <= 1 || cx >= W - 2) cx = c;
    stamp(cx, y, 'm');
  }

  return rows;
}

/**
 * A zone's ground palette. Painters shade the tiles; the layout is separate.
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
  /** This level's own ASCII layout (collision + spawn/camps/boss objects). */
  rows: string[];
}

interface ZoneSpec {
  id: string;
  name: string;
  palette: ZonePalette;
  level: LevelOpts;
}

function zone(spec: ZoneSpec): ZoneDef {
  return {
    id: spec.id,
    name: spec.name,
    palette: spec.palette,
    painters: makePainters(spec.palette),
    rows: generateLevel(spec.level),
  };
}

/**
 * Eight hand-tuned biomes, each its own long trek and boss (boss index tracks
 * the zone index). They grow taller and pile on more camps as you climb, so
 * every level plays longer than the last. The party cycles back to the Vale
 * once the Void Monarch falls.
 */
export const ZONES: ZoneDef[] = [
  zone({
    id: 'vale',
    name: 'Green Vale',
    palette: {
      ground: 0x3d6b3a,
      water: 0x3a6d9c,
      path: 0x9c8556,
      trunk: 0x5c4327,
      leaf: 0x3d6b3a,
      petals: [0xffd166, 0xff9fb2, 0xf2ffe9],
      accent: forestDeep.accent,
      bg: 0x1c2418,
    },
    level: { seed: 1207, w: 28, h: 44, camps: 4, ponds: 3, treeClusters: 10, flowers: 26 },
  }),
  zone({
    id: 'frost',
    name: 'Frostpeak',
    palette: {
      ground: 0xbcd6e6,
      water: 0x7fd0e8,
      path: 0x8f9bb0,
      trunk: 0x6b7280,
      leaf: 0x9fc6d6,
      petals: [0xdff6ff, 0xbdf0ff, 0xffffff],
      accent: 0x2f7fa0,
      bg: 0x1a2733,
    },
    level: { seed: 2311, w: 28, h: 48, camps: 5, ponds: 4, treeClusters: 9, flowers: 18 },
  }),
  zone({
    id: 'ember',
    name: 'Ember Wastes',
    palette: {
      ground: 0x4a3b34,
      water: 0xd9622b,
      path: 0x5a4a44,
      trunk: 0x241a18,
      leaf: 0x6b3b2b,
      petals: [0xffd166, 0xff7a3b, 0xff5470],
      accent: 0xff7a3b,
      bg: 0x2a1a16,
    },
    level: { seed: 3517, w: 28, h: 50, camps: 5, ponds: 2, treeClusters: 12, flowers: 12 },
  }),
  zone({
    id: 'marsh',
    name: 'Mire Hollows',
    palette: {
      ground: 0x3f5138,
      water: 0x5a7a3e,
      path: 0x6b6540,
      trunk: 0x3a2e22,
      leaf: 0x4d6b34,
      petals: [0xb6f28a, 0x8fd94f, 0xd7ff9e],
      accent: 0x8fd94f,
      bg: 0x1a2216,
    },
    level: { seed: 4703, w: 30, h: 54, camps: 6, ponds: 7, treeClusters: 11, flowers: 22 },
  }),
  zone({
    id: 'tide',
    name: 'Sunken Tideheart',
    palette: {
      ground: 0x2f5563,
      water: 0x2f9fb8,
      path: 0x6f8a92,
      trunk: 0x244049,
      leaf: 0x3c7d84,
      petals: [0xdff6ff, 0x8fe6f0, 0xbdf0ff],
      accent: 0x35c6e0,
      bg: 0x122630,
    },
    level: { seed: 5821, w: 30, h: 56, camps: 6, ponds: 9, treeClusters: 8, flowers: 16 },
  }),
  zone({
    id: 'gloom',
    name: 'Gloomfen Crypt',
    palette: {
      ground: 0x322a3f,
      water: 0x4a3a6b,
      path: 0x4a4258,
      trunk: 0x201a2b,
      leaf: 0x3d3352,
      petals: [0xc77dff, 0x9d6bff, 0xe0c3ff],
      accent: 0xc77dff,
      bg: 0x120e1c,
    },
    level: { seed: 6959, w: 30, h: 58, camps: 7, ponds: 3, treeClusters: 14, flowers: 12 },
  }),
  zone({
    id: 'dunes',
    name: 'Sunscorch Dunes',
    palette: {
      ground: 0xc9a86a,
      water: 0x4fc3d9,
      path: 0xa88a52,
      trunk: 0x8a6a3b,
      leaf: 0x9bbf5a,
      petals: [0xffd166, 0xffe29a, 0xff9f6b],
      accent: 0xffb03b,
      bg: 0x3a2c18,
    },
    level: { seed: 7013, w: 30, h: 60, camps: 7, ponds: 2, treeClusters: 8, flowers: 14 },
  }),
  zone({
    id: 'void',
    name: 'The Voidspire',
    palette: {
      ground: 0x241d3a,
      water: 0x5b3fb0,
      path: 0x3a3260,
      trunk: 0x15112a,
      leaf: 0x352a5e,
      petals: [0xff5470, 0x8f5bff, 0x5be0ff],
      accent: 0x8f5bff,
      bg: 0x0c0a18,
    },
    level: { seed: 8237, w: 32, h: 64, camps: 8, ponds: 4, treeClusters: 12, flowers: 10 },
  }),
];

/** Zone 0's layout — kept as an export for existing callers/tests. */
export const valeRows: readonly string[] = ZONES[0]!.rows;

/** Zone 0 painters — kept as the original export for existing callers. */
export const valePainters: Record<number, TilePainter> = ZONES[0]!.painters;
