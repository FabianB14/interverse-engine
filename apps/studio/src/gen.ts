/**
 * Procedural level generation — pure functions that return painted tile
 * rows (same chars as the paintbox), so generated levels are ordinary
 * maps: autotiled, collidable, editable afterwards by hand. Deterministic
 * under a seed (tests, daily dungeons, multiplayer-shared worlds).
 */

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grid = (cols: number, rows: number, ch: string): string[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => ch));

const toRows = (g: string[][]): string[] => g.map((r) => r.join(''));

/**
 * The narrowest gap a generated level may leave, in tiles.
 *
 * Tiles are 40 design units and a character is drawn about 68 across, so a
 * one-tile corridor is narrower than the person walking down it: the art
 * visibly overlaps both walls and every corner snags. Two tiles is the
 * smallest gap that a character fits through and looks like it fits through.
 */
export const MIN_GAP_TILES = 2;

/** Blow a grid up by `n`, so every feature is at least `n` tiles across.
 *  Scaling the whole map is the one widening that cannot break it: a maze
 *  stays exactly as connected as it was, corridors and walls together. */
function upscale(g: string[][], n: number, cols: number, rows: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => g[Math.floor(r / n)]?.[Math.floor(c / n)] ?? g[0]![0]!),
  );
}

/** Maze: rock walls + dirt paths, recursive backtracker on an odd lattice.
 *  Every floor cell is reachable from every other. */
export function mazeRows(cols: number, rows: number, rng: Rng = Math.random): string[] {
  // Carve at half size and blow it up, so corridors come out MIN_GAP_TILES
  // wide instead of one. Widening a finished maze by knocking walls out
  // would open shortcuts and could join two corridors into a room; scaling
  // cannot, because it scales the walls too.
  const cw = Math.max(3, Math.ceil(cols / MIN_GAP_TILES));
  const rw = Math.max(3, Math.ceil(rows / MIN_GAP_TILES));
  return toRows(upscale(carveMaze(cw, rw, rng), MIN_GAP_TILES, cols, rows));
}

function carveMaze(cols: number, rows: number, rng: Rng): string[][] {
  const g = grid(cols, rows, 'k');
  // carve on odd coordinates so walls stay 1 tile thick
  const cw = Math.max(1, Math.floor((cols - 1) / 2));
  const ch = Math.max(1, Math.floor((rows - 1) / 2));
  const visited = grid(cw, ch, '0');
  const stack: [number, number][] = [[0, 0]];
  visited[0]![0] = '1';
  g[1]![1] = 'd';
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1]!;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].filter(([dx, dy]) => {
      const nx = cx + dx!;
      const ny = cy + dy!;
      return nx >= 0 && ny >= 0 && nx < cw && ny < ch && visited[ny]![nx] === '0';
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = dirs[Math.floor(rng() * dirs.length)]!;
    const nx = cx + dx!;
    const ny = cy + dy!;
    visited[ny]![nx] = '1';
    g[1 + ny * 2]![1 + nx * 2] = 'd';
    g[1 + cy * 2 + dy!]![1 + cx * 2 + dx!] = 'd';
    stack.push([nx, ny]);
  }
  return g;
}

/** Dungeon: brick walls, stone-floor rooms joined by L-corridors. */
export function dungeonRows(cols: number, rows: number, rng: Rng = Math.random): string[] {
  const g = grid(cols, rows, 'b');
  const rooms: [number, number][] = [];
  const roomCount = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < roomCount; i++) {
    const w = 3 + Math.floor(rng() * Math.max(2, cols / 4));
    const h = 3 + Math.floor(rng() * Math.max(2, rows / 5));
    const x = 1 + Math.floor(rng() * Math.max(1, cols - w - 2));
    const y = 1 + Math.floor(rng() * Math.max(1, rows - h - 2));
    for (let r = y; r < Math.min(rows - 1, y + h); r++) {
      for (let c = x; c < Math.min(cols - 1, x + w); c++) g[r]![c] = 'p';
    }
    rooms.push([Math.min(cols - 2, x + Math.floor(w / 2)), Math.min(rows - 2, y + Math.floor(h / 2))]);
  }
  // Connect each room to the previous with an L corridor, MIN_GAP_TILES
  // thick — the rooms were always wide enough, so the corridors between
  // them were the only place a player could get wedged.
  const floor = (c: number, r: number): void => {
    if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) g[r]![c] = 'p';
  };
  for (let i = 1; i < rooms.length; i++) {
    const [ax, ay] = rooms[i - 1]!;
    const [bx, by] = rooms[i]!;
    for (let c = Math.min(ax, bx); c <= Math.max(ax, bx); c++) {
      for (let t = 0; t < MIN_GAP_TILES; t++) floor(c, ay + t);
    }
    for (let r = Math.min(ay, by); r <= Math.max(ay, by) + MIN_GAP_TILES - 1; r++) {
      for (let t = 0; t < MIN_GAP_TILES; t++) floor(bx + t, r);
    }
  }
  return toRows(g);
}

/** Island: grass heart, sandy shore, water all around, scattered trees. */
export function islandRows(cols: number, rows: number, rng: Rng = Math.random): string[] {
  const g = grid(cols, rows, 'w');
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = (c - cx) / cx;
      const dy = (r - cy) / cy;
      const d = Math.hypot(dx, dy) + (rng() - 0.5) * 0.22;
      if (d < 0.55) g[r]![c] = rng() > 0.85 ? 'f' : 'g';
      else if (d < 0.75) g[r]![c] = 's';
    }
  }
  // trees take root on inner grass
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      if (g[r]![c] === 'g' && rng() > 0.93) g[r]![c] = 't';
    }
  }
  // A gap a character cannot fit through is a wall that does not look like
  // one, so the coastline gets tidied before anyone has to walk it.
  fixPinches(g, cols, rows, 's', 'w');
  // keep the very center walkable for spawns
  for (let r = Math.floor(cy) - 1; r <= Math.floor(cy) + 1; r++) {
    for (let c = Math.floor(cx) - 1; c <= Math.floor(cx) + 1; c++) {
      if (g[r]?.[c] === 't') g[r]![c] = 'g';
    }
  }
  return toRows(g);
}

/**
 * Fix gaps narrower than MIN_GAP_TILES on an organic map.
 *
 * Only used where the layout came from noise (the island's coastline) — on
 * a maze this would cut shortcuts, so mazes are widened by scaling instead.
 *
 * Two different problems wear the same disguise. A squeeze between two
 * landmasses should be opened up; a one-tile spit of sand poking into the
 * ocean cannot be opened up at all, and is better returned to the sea than
 * left as a tile you can see but not stand on. So: widen what can be
 * widened, and drown whatever is still too narrow afterwards.
 */
function fixPinches(g: string[][], cols: number, rows: number, fill: string, water: string): void {
  const solid = (c: number, r: number): boolean => {
    const ch = g[r]?.[c];
    return ch === undefined || ch === 'w' || ch === 'k' || ch === 't' || ch === 'b';
  };
  /** Walkable tiles sitting in a run narrower than MIN_GAP_TILES. */
  const narrow = (): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (solid(c, r)) continue;
        if ((solid(c - 1, r) && solid(c + 1, r)) || (solid(c, r - 1) && solid(c, r + 1))) {
          out.push([c, r]);
        }
      }
    }
    return out;
  };
  // Both fixes create new neighbours to check, so this re-scans until the
  // coastline settles rather than assuming one pass is enough. Bounded, so
  // a pathological map cannot spin here.
  for (let pass = 0; pass < 8; pass++) {
    const found = narrow();
    if (!found.length) return;
    for (const [c, r] of found) {
      if (solid(c, r)) continue; // already drowned this round
      let widened = false;
      for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        // Never open the outer ring — the island needs a coast.
        if (nc <= 0 || nr <= 0 || nc >= cols - 1 || nr >= rows - 1) continue;
        if (solid(nc, nr)) {
          g[nr]![nc] = fill;
          widened = true;
          break;
        }
      }
      // Nothing to open into: this is a one-tile spit, not a corridor.
      if (!widened) g[r]![c] = water;
    }
  }
}

export type GeneratorKind = 'maze' | 'dungeon' | 'island';

export function generateRows(kind: GeneratorKind, cols: number, rows: number, rng: Rng = Math.random): string[] {
  if (kind === 'maze') return mazeRows(cols, rows, rng);
  if (kind === 'dungeon') return dungeonRows(cols, rows, rng);
  return islandRows(cols, rows, rng);
}
