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

/** Maze: rock walls + dirt paths, recursive backtracker on an odd lattice.
 *  Every floor cell is reachable from every other. */
export function mazeRows(cols: number, rows: number, rng: Rng = Math.random): string[] {
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
  return toRows(g);
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
  // connect each room to the previous with an L corridor
  for (let i = 1; i < rooms.length; i++) {
    const [ax, ay] = rooms[i - 1]!;
    const [bx, by] = rooms[i]!;
    for (let c = Math.min(ax, bx); c <= Math.max(ax, bx); c++) g[ay]![c] = 'p';
    for (let r = Math.min(ay, by); r <= Math.max(ay, by); r++) g[r]![bx] = 'p';
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
  // keep the very center walkable for spawns
  for (let r = Math.floor(cy) - 1; r <= Math.floor(cy) + 1; r++) {
    for (let c = Math.floor(cx) - 1; c <= Math.floor(cx) + 1; c++) {
      if (g[r]?.[c] === 't') g[r]![c] = 'g';
    }
  }
  return toRows(g);
}

export type GeneratorKind = 'maze' | 'dungeon' | 'island';

export function generateRows(kind: GeneratorKind, cols: number, rows: number, rng: Rng = Math.random): string[] {
  if (kind === 'maze') return mazeRows(cols, rows, rng);
  if (kind === 'dungeon') return dungeonRows(cols, rows, rng);
  return islandRows(cols, rows, rng);
}
