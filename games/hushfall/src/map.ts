import { lighten } from '@interverse/engine';
import type { TileLegendEntry, TilePainter } from '@interverse/engine';
import { NIGHT } from './theme.js';

export const TILE_SIZE = 64;

export const TILE = { FLOOR: 1, WALL: 2, CRATE: 3, CARPET: 4 } as const;

export const legend: Record<string, TileLegendEntry> = {
  '#': { tile: TILE.WALL, solid: true },
  '.': { tile: TILE.FLOOR },
  ',': { tile: TILE.CARPET },
  c: { tile: TILE.CRATE, solid: true },
  h: { tile: TILE.CARPET, object: 'hide' },
  L: { tile: TILE.CARPET, object: 'lantern' },
  G: { tile: TILE.FLOOR, object: 'gate' },
  '@': { tile: TILE.CARPET, object: 'spawn' },
  S: { tile: TILE.FLOOR, object: 'seekerspawn' },
  T: { tile: TILE.CARPET, object: 'teleport' },
  X: { tile: TILE.FLOOR, object: 'hatch' },
};

const CH: Record<number, string> = {
  [TILE.FLOOR]: '.',
  [TILE.WALL]: '#',
  [TILE.CRATE]: 'c',
  [TILE.CARPET]: ',',
};

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A playable manor. Each level is a differently-sized, differently-seeded
 *  building with its own lantern count, so hunts feel distinct. */
export interface LevelDef {
  name: string;
  blurb: string;
  seed: number;
  w: number;
  h: number;
  /** smallest room-region side (rooms vary from this up to very large). */
  min: number;
  lanterns: number;
  /** linked teleporter pads (bigger manors carry more; still ONE shared CD). */
  teleporters: number;
}

export const LEVELS: LevelDef[] = [
  {
    name: 'Hollow Manor',
    blurb: 'A cramped, boarded-up house.',
    seed: 91027,
    w: 54,
    h: 46,
    min: 9,
    lanterns: 6,
    teleporters: 2,
  },
  {
    name: 'Ashen Asylum',
    blurb: 'Long wards and cold cells.',
    seed: 40213,
    w: 64,
    h: 50,
    min: 8,
    lanterns: 7,
    teleporters: 3,
  },
  {
    name: 'The Cellars',
    blurb: 'Twisting stone vaults below.',
    seed: 13001,
    w: 56,
    h: 60,
    min: 6,
    lanterns: 7,
    teleporters: 3,
  },
  {
    name: 'Grand Estate',
    blurb: 'A sprawling manor of wings.',
    seed: 52020,
    w: 72,
    h: 56,
    min: 6,
    lanterns: 8,
    teleporters: 3,
  },
  {
    name: 'Blackwood Keep',
    blurb: 'A fortress of endless halls.',
    seed: 77345,
    w: 84,
    h: 66,
    min: 7,
    lanterns: 10,
    teleporters: 4,
  },
];

/** `salt` re-rolls the LANTERN scatter for a fresh hunt (0 = the fixed
 *  classic layout). Walls, hide spots, pads and the hatch stay put — only
 *  where the lanterns hang changes match to match. */
export function levelRows(i: number, salt = 0): string[] {
  const idx = Math.max(0, Math.min(LEVELS.length - 1, i | 0));
  return generateBuilding(LEVELS[idx]!, salt);
}

/**
 * A haunted manor: BSP-partitioned rooms of wildly varying size (some huge),
 * joined by doorways/corridors, cluttered with furniture and dotted with
 * hiding spots. Generated deterministically so every peer builds the same
 * collision. Fixed anchors (hider spawn, Seeker spawn, escape gate, five
 * lanterns) live in different rooms.
 */
export function generateBuilding(level: LevelDef = LEVELS[0]!, salt = 0): string[] {
  const { seed, w: W, h: H, min: MIN } = level;
  const rng = lcg(seed);
  const grid: number[][] = Array.from({ length: H }, () => Array<number>(W).fill(TILE.WALL));
  const corridor = new Set<string>();
  const set = (x: number, y: number, t: number): void => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) grid[y]![x] = t;
  };
  const carve = (x: number, y: number): void => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      grid[y]![x] = TILE.FLOOR;
      corridor.add(`${x},${y}`);
    }
  };
  const center = (r: Rect): [number, number] => [
    r.x + Math.floor(r.w / 2),
    r.y + Math.floor(r.h / 2),
  ];

  // Carve a 2-wide L-shaped corridor (tracked so we never block it).
  const link = (a: Rect, b: Rect): void => {
    const [ax, ay] = center(a);
    const [bx, by] = center(b);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      carve(x, ay);
      carve(x, ay + 1);
    }
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      carve(bx, y);
      carve(bx + 1, y);
    }
  };

  // BSP split; returns the subtree's representative room for linking.
  const rooms: Rect[] = [];
  const split = (region: Rect, depth: number): Rect => {
    const canV = region.w >= MIN * 2;
    const canH = region.h >= MIN * 2;
    const stop = depth >= 5 || (!canV && !canH) || (depth >= 2 && rng() < 0.32);
    if (stop) {
      // Inset for walls; leave a floor room (min 5x5).
      const pad = 1;
      const room: Rect = {
        x: region.x + pad,
        y: region.y + pad,
        w: Math.max(5, region.w - pad * 2),
        h: Math.max(5, region.h - pad * 2),
      };
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) set(x, y, TILE.CARPET);
      }
      rooms.push(room);
      return room;
    }
    const vertical = canV && (!canH || rng() < 0.5);
    if (vertical) {
      const cut = MIN + Math.floor(rng() * (region.w - MIN * 2));
      const l = split({ x: region.x, y: region.y, w: cut, h: region.h }, depth + 1);
      const r = split(
        { x: region.x + cut, y: region.y, w: region.w - cut, h: region.h },
        depth + 1,
      );
      link(l, r);
      return rng() < 0.5 ? l : r;
    }
    const cut = MIN + Math.floor(rng() * (region.h - MIN * 2));
    const t = split({ x: region.x, y: region.y, w: region.w, h: cut }, depth + 1);
    const b = split({ x: region.x, y: region.y + cut, w: region.w, h: region.h - cut }, depth + 1);
    link(t, b);
    return rng() < 0.5 ? t : b;
  };
  split({ x: 1, y: 1, w: W - 2, h: H - 2 }, 0);

  const near = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (corridor.has(`${x + dx},${y + dy}`)) return true;
    return false;
  };
  const free = (x: number, y: number): boolean =>
    grid[y]?.[x] === TILE.CARPET && !near(x, y) && !corridor.has(`${x},${y}`);

  // Furniture: solid crates cluttering the rooms (never blocking a corridor).
  for (const room of rooms) {
    const area = room.w * room.h;
    const crates = Math.min(7, Math.max(1, Math.floor(area / 26)));
    for (let i = 0; i < crates; i++) {
      const x = room.x + 1 + Math.floor(rng() * (room.w - 2));
      const y = room.y + 1 + Math.floor(rng() * (room.h - 2));
      if (free(x, y)) set(x, y, TILE.CRATE);
    }
  }

  // Convert to chars, then stamp object markers so they always win.
  const rows = grid.map((row) => row.map((t) => CH[t] ?? '#').join(''));
  const stamp = (x: number, y: number, ch: string): void => {
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return;
    const r = rows[y]!;
    rows[y] = r.slice(0, x) + ch + r.slice(x + 1);
  };
  const isCarpetChar = (x: number, y: number): boolean => rows[y]?.[x] === ',';
  const stampFree = (x: number, y: number, ch: string): boolean => {
    if (isCarpetChar(x, y) && !near(x, y)) {
      stamp(x, y, ch);
      return true;
    }
    return false;
  };

  // Hiding spots — larger and plentiful: 1–2 per room, tucked by a wall.
  // Keep them at least 3 tiles apart so two props never sit shoulder to
  // shoulder (looked like a duplicated door).
  const hidesPlaced: [number, number][] = [];
  const farFromHides = (x: number, y: number): boolean =>
    hidesPlaced.every(([hx, hy]) => Math.max(Math.abs(hx - x), Math.abs(hy - y)) >= 3);
  for (const room of rooms) {
    const area = room.w * room.h;
    const want = area > 300 ? 3 : area > 120 ? 2 : 1;
    let placed = 0;
    for (let tries = 0; tries < 40 && placed < want; tries++) {
      const edge = Math.floor(rng() * 4);
      const x =
        edge === 0
          ? room.x + 1
          : edge === 1
            ? room.x + room.w - 2
            : room.x + 1 + Math.floor(rng() * (room.w - 2));
      const y =
        edge === 2
          ? room.y + 1
          : edge === 3
            ? room.y + room.h - 2
            : room.y + 1 + Math.floor(rng() * (room.h - 2));
      if (farFromHides(x, y) && stampFree(x, y, 'h')) {
        hidesPlaced.push([x, y]);
        placed++;
      }
    }
  }

  // Anchor rooms: spawn (bottom-most), gate (top-most), seeker (most central),
  // five lanterns spread across the rest.
  const sorted = [...rooms];
  const cx = W / 2;
  const cy = H / 2;
  const byY = [...sorted].sort((a, b) => center(a)[1] - center(b)[1]);
  const gateRoom = byY[0]!;
  const spawnRoom = byY[byY.length - 1]!;
  const seekerRoom = [...sorted].sort(
    (a, b) =>
      Math.hypot(center(a)[0] - cx, center(a)[1] - cy) -
      Math.hypot(center(b)[0] - cx, center(b)[1] - cy),
  )[0]!;
  const stampCenter = (room: Rect, ch: string): void => {
    const [x, y] = center(room);
    stamp(x, y, ch);
  };
  stampCenter(spawnRoom, '@');
  stampCenter(seekerRoom, 'S');
  stampCenter(gateRoom, 'G');
  const used = new Set([spawnRoom, seekerRoom, gateRoom]);
  const rest = sorted.filter((r) => !used.has(r));
  const want = level.lanterns;
  // Lanterns: a fresh SCATTER every hunt. The building is fixed per level,
  // but WHERE the lamps hang re-rolls with the match salt: a random first
  // room, then each next lamp as far from the ones already hung as the
  // manor allows — spread wide, never twice the same.
  const lrng = lcg((seed ^ Math.imul(salt, 2654435761)) >>> 0 || 7);
  const roomDist = (a: Rect, b: Rect): number => {
    const [ax, ay] = center(a);
    const [bx, by] = center(b);
    return Math.hypot(ax - bx, ay - by);
  };
  const lanternRooms: Rect[] = [];
  if (rest.length) {
    lanternRooms.push(rest[Math.floor(lrng() * rest.length)]!);
    while (lanternRooms.length < Math.min(want, rest.length)) {
      let bestRoom: Rect | null = null;
      let bestScore = -1;
      for (const room of rest) {
        if (lanternRooms.includes(room)) continue;
        const score = Math.min(...lanternRooms.map((c) => roomDist(room, c)));
        if (score > bestScore) {
          bestScore = score;
          bestRoom = room;
        }
      }
      if (!bestRoom) break;
      lanternRooms.push(bestRoom);
    }
  }
  for (const room of lanternRooms) {
    // Hang each lamp at a salt-random free tile of its room (center backup).
    let placed = false;
    for (let tries = 0; tries < 14 && !placed; tries++) {
      const x = room.x + 1 + Math.floor(lrng() * (room.w - 2));
      const y = room.y + 1 + Math.floor(lrng() * (room.h - 2));
      placed = stampFree(x, y, 'L');
    }
    if (!placed) stampCenter(room, 'L');
  }
  // If there were too few rooms, drop extra lanterns into big rooms'
  // corners — try every corner, so a huge hall can hold two lamps.
  let lanterns = lanternRooms.length;
  const byArea = rest.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  for (const room of byArea) {
    if (lanterns >= want) break;
    const corners: [number, number][] = [
      [room.x + 2, room.y + 2],
      [room.x + room.w - 3, room.y + 2],
      [room.x + 2, room.y + room.h - 3],
      [room.x + room.w - 3, room.y + room.h - 3],
    ];
    for (const [cx2, cy2] of corners) {
      if (lanterns >= want) break;
      if (stampFree(cx2, cy2, 'L')) lanterns++;
    }
  }

  // LINKED teleporter pads — bigger manors carry more (a hider rides pad i
  // to pad i+1 in the ring; ONE cooldown shared by all of them, see
  // MatchScene). Placed greedily so each new pad lands as far as possible
  // from the ones already down. Never in the spawn/seeker/gate rooms: a pad
  // under a spawn point would yank players the moment they appear.
  const tpWant = Math.max(2, level.teleporters);
  const tpPool = rest.length >= tpWant ? rest : sorted;
  const chosen: Rect[] = [[...tpPool].sort((a, b) => center(a)[0] - center(b)[0])[0]!];
  while (chosen.length < Math.min(tpWant, tpPool.length)) {
    let bestRoom: Rect | null = null;
    let bestScore = -1;
    for (const room of tpPool) {
      if (chosen.includes(room)) continue;
      const [x, y] = center(room);
      const score = Math.min(
        ...chosen.map((c) => {
          const [cx2, cy2] = center(c);
          return Math.hypot(x - cx2, y - cy2);
        }),
      );
      if (score > bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }
    if (!bestRoom) break;
    chosen.push(bestRoom);
  }
  for (const room of chosen) {
    const [tx, ty] = center(room);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [0, 2],
    ] as const) {
      const ch = rows[ty + dy]?.[tx + dx];
      if (ch === ',' || ch === '.') {
        stamp(tx + dx, ty + dy, 'T');
        break;
      }
    }
  }

  // The DAWN HATCH: a second exit as far from the main gate as possible.
  // When dawn breaks it creaks open (the gate does NOT) — the Seeker can't
  // camp one door through the endgame.
  const [gx0, gy0] = center(gateRoom);
  const hatchRoom = [...(rest.length ? rest : sorted)].sort(
    (a, b) =>
      Math.hypot(center(b)[0] - gx0, center(b)[1] - gy0) -
      Math.hypot(center(a)[0] - gx0, center(a)[1] - gy0),
  )[0]!;
  const [hx, hy] = center(hatchRoom);
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 0],
    [0, 2],
    [-2, 0],
  ] as const) {
    const ch = rows[hy + dy]?.[hx + dx];
    if (ch === ',' || ch === '.') {
      stamp(hx + dx, hy + dy, 'X');
      break;
    }
  }

  return rows;
}

export const arenaRows: readonly string[] = generateBuilding();

/** Tile painters — a dim, boarded-up manor. */
export const painters: Record<number, TilePainter> = {
  [TILE.FLOOR]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(rng() > 0.5 ? NIGHT.ground : NIGHT.groundAlt);
    if (rng() > 0.8)
      g.rect(x + 6, y + 6, s - 12, s - 12).stroke({ color: 0x000000, alpha: 0.2, width: 1 });
  },
  [TILE.CARPET]: (g, x, y, s, rng) => {
    const base = rng() > 0.5 ? 0x241f30 : 0x201b2a;
    g.rect(x, y, s, s).fill(base);
    g.rect(x + 4, y + 4, s - 8, s - 8).stroke({ color: lighten(base, 0.06), alpha: 0.5, width: 2 });
    if (rng() > 0.88) g.circle(x + s / 2, y + s / 2, 3).fill({ color: NIGHT.violet, alpha: 0.2 });
  },
  [TILE.WALL]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(NIGHT.wall);
    // brick courses
    g.rect(x, y + s / 2 - 1, s, 2).fill({ color: 0x05040c, alpha: 0.9 });
    g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y, 2, s / 2).fill({ color: 0x05040c, alpha: 0.9 });
    g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y + s / 2, 2, s / 2).fill({
      color: 0x05040c,
      alpha: 0.9,
    });
    g.rect(x + 2, y + 2, s - 4, s / 2 - 3).fill({ color: 0x14121f, alpha: 0.5 });
  },
  [TILE.CRATE]: (g, x, y, s, rng) => {
    g.rect(x, y, s, s).fill(NIGHT.groundAlt);
    const m = 8;
    const woodTop = rng() > 0.5 ? 0x4a3826 : 0x433322;
    g.roundRect(x + m, y + m, s - m * 2, s - m * 2, 4).fill(woodTop);
    g.roundRect(x + m, y + m, s - m * 2, s - m * 2, 4).stroke({ color: 0x241a10, width: 3 });
    g.moveTo(x + m, y + m)
      .lineTo(x + s - m, y + s - m)
      .moveTo(x + s - m, y + m)
      .lineTo(x + m, y + s - m)
      .stroke({ color: 0x241a10, width: 2, alpha: 0.7 });
  },
};
