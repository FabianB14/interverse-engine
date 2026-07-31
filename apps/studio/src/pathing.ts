/**
 * 🧭 Getting an enemy to the player when there is a wall in the way.
 *
 * Chasers used to steer straight at the player, which was invisible while
 * they could also walk through terrain. Now that they collide, a straight
 * line means pressing face-first into a wall for the rest of the level —
 * the fix for one bug exposed the next.
 *
 * The approach is a **flow field**, not a path per enemy. One breadth-first
 * sweep outward from the player labels every reachable tile with its
 * distance, and then every chaser in the level just walks downhill. A dozen
 * enemies cost the same as one, which is what makes it affordable on a phone
 * at 60fps — A* per enemy per frame is not.
 *
 * Enemies with a clear line to the player ignore the field and steer
 * directly. Following a grid when you can see your target looks like a robot
 * on rails; the field is only interesting when something is in the way.
 */

export interface PathGrid {
  cols: number;
  rows: number;
  /** True where nobody may walk. */
  solid: (col: number, row: number) => boolean;
}

/** Unreachable, or never visited. */
export const UNREACHABLE = -1;

/**
 * Distance in tiles from `goal` to every reachable tile, by BFS.
 *
 * Four-way on purpose: an eight-way sweep will happily cut a diagonal
 * between two wall corners that nothing can actually fit through, and the
 * enemy then jams on the corner forever. Diagonal MOVEMENT is still allowed
 * later, but only where both orthogonal neighbours are open.
 */
export function flowField(grid: PathGrid, goalCol: number, goalRow: number): Int32Array {
  const { cols, rows } = grid;
  const field = new Int32Array(cols * rows).fill(UNREACHABLE);
  if (goalCol < 0 || goalRow < 0 || goalCol >= cols || goalRow >= rows) return field;
  if (grid.solid(goalCol, goalRow)) return field;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  const start = goalRow * cols + goalCol;
  field[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const at = queue[head++]!;
    const c = at % cols;
    const r = (at - c) / cols;
    const next = field[at]! + 1;
    for (const [dc, dr] of STEPS4) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (field[ni] !== UNREACHABLE || grid.solid(nc, nr)) continue;
      field[ni] = next;
      queue[tail++] = ni;
    }
  }
  return field;
}

const STEPS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const STEPS8: readonly (readonly [number, number])[] = [
  ...STEPS4,
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * The neighbouring tile to move into: the one closest to the goal.
 *
 * Diagonals are allowed, but only when both orthogonal neighbours are open —
 * otherwise an enemy tries to squeeze through the corner where two walls
 * meet, which it cannot fit through and which reads as being stuck.
 */
export function nextStep(
  grid: PathGrid,
  field: Int32Array,
  col: number,
  row: number,
): { col: number; row: number } | null {
  const { cols, rows } = grid;
  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  const here = field[row * cols + col];
  // Standing on the goal, or somewhere the sweep never reached (inside a
  // wall, or walled off entirely) — the caller falls back to direct chase.
  if (here === undefined || here === UNREACHABLE || here === 0) return null;
  let best: { col: number; row: number } | null = null;
  let bestD = here;
  for (const [dc, dr] of STEPS8) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    if (dc !== 0 && dr !== 0 && (grid.solid(col + dc, row) || grid.solid(col, row + dr))) continue;
    const d = field[nr * cols + nc];
    if (d === undefined || d === UNREACHABLE || d >= bestD) continue;
    bestD = d;
    best = { col: nc, row: nr };
  }
  return best;
}

/**
 * Can these two tiles see each other? Supercover Bresenham: it counts a wall
 * that a line only clips the corner of, because "I could see it" and "I could
 * walk it" have to agree or the enemy alternates between steering directly
 * into a wall and pathing around it, once per frame.
 */
export function lineOfSight(
  grid: PathGrid,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): boolean {
  let c = c0;
  let r = r0;
  const dc = Math.abs(c1 - c0);
  const dr = Math.abs(r1 - r0);
  const sc = c0 < c1 ? 1 : -1;
  const sr = r0 < r1 ? 1 : -1;
  let err = dc - dr;
  // A generous bound: a straight walk can never take more steps than the
  // bounding box has tiles, and this must terminate on any input.
  for (let guard = 0; guard <= dc + dr + 2; guard++) {
    if (grid.solid(c, r)) return false;
    if (c === c1 && r === r1) return true;
    const e2 = 2 * err;
    if (e2 > -dr) {
      err -= dr;
      c += sc;
    }
    if (e2 < dc) {
      err += dc;
      r += sr;
    }
  }
  return false;
}

/** How often the field is rebuilt, in seconds. The player has to move a whole
 *  tile for it to change meaningfully, and rebuilding is cheap but not free. */
export const FIELD_REFRESH_SECS = 0.25;

/**
 * A safety valve, not an aggro radius.
 *
 * Chasing has never had a range limit and adding one here would quietly
 * change how every existing game plays, so this is set well beyond any
 * route a real level contains — long levels are four screens, and a
 * there-and-back detour around a wall costs far more tiles than the
 * straight-line distance suggests. What actually stops an enemy pathing is
 * the field saying UNREACHABLE; this only bounds the pathological case.
 */
export const CHASE_RANGE_TILES = 120;

export function withinChaseRange(field: Int32Array, grid: PathGrid, col: number, row: number): boolean {
  const d = field[row * grid.cols + col];
  return d !== undefined && d !== UNREACHABLE && d <= CHASE_RANGE_TILES;
}
