import { describe, expect, it } from 'vitest';
import {
  CHASE_RANGE_TILES, UNREACHABLE, flowField, lineOfSight, nextStep, withinChaseRange,
} from '../src/pathing.js';
import type { PathGrid } from '../src/pathing.js';

/** Build a grid from ASCII art: '#' is wall, anything else is floor. */
const gridOf = (art: string[]): PathGrid => ({
  cols: art[0]!.length,
  rows: art.length,
  solid: (c, r) => (art[r]?.[c] ?? '#') === '#',
});

const at = (g: PathGrid, f: Int32Array, c: number, r: number): number => f[r * g.cols + c]!;

describe('the flow field', () => {
  const open = gridOf(['.....', '.....', '.....']);

  it('is zero at the goal and grows outward', () => {
    const f = flowField(open, 0, 0);
    expect(at(open, f, 0, 0)).toBe(0);
    expect(at(open, f, 1, 0)).toBe(1);
    expect(at(open, f, 4, 2)).toBe(6); // four-way distance, not straight line
  });

  /** Four-way on purpose: an eight-way sweep cuts diagonals between wall
   *  corners that nothing can fit through. */
  it('measures in steps you can actually take', () => {
    const f = flowField(open, 0, 0);
    expect(at(open, f, 1, 1)).toBe(2);
  });

  it('routes around a wall rather than through it', () => {
    // A wall down the middle with the only gap along the bottom row.
    const g = gridOf(['..#..', '..#..', '.....']);
    const f = flowField(g, 0, 0);
    // Straight across would be 4; going down, around and back up is 8.
    expect(at(g, f, 4, 0)).toBe(8);
  });

  it('marks what it cannot reach', () => {
    const g = gridOf(['..#..', '..#..', '..#..']);
    const f = flowField(g, 0, 0);
    expect(at(g, f, 4, 0)).toBe(UNREACHABLE);
    expect(at(g, f, 2, 0)).toBe(UNREACHABLE); // the wall itself
  });

  it('gives up gracefully on a goal inside a wall or off the map', () => {
    const g = gridOf(['..#..']);
    expect([...flowField(g, 2, 0)].every((v) => v === UNREACHABLE)).toBe(true);
    expect([...flowField(g, -1, 0)].every((v) => v === UNREACHABLE)).toBe(true);
    expect([...flowField(g, 99, 0)].every((v) => v === UNREACHABLE)).toBe(true);
  });
});

describe('walking downhill', () => {
  it('picks a neighbour closer to the goal', () => {
    const g = gridOf(['.....']);
    const f = flowField(g, 0, 0);
    expect(nextStep(g, f, 3, 0)).toEqual({ col: 2, row: 0 });
  });

  it('stops when it has arrived', () => {
    const g = gridOf(['.....']);
    expect(nextStep(g, flowField(g, 0, 0), 0, 0)).toBeNull();
  });

  /** Inside a wall, or walled off — the caller falls back to direct chase
   *  rather than freezing. */
  it('says nothing when there is no route', () => {
    const g = gridOf(['..#..']);
    const f = flowField(g, 0, 0);
    expect(nextStep(g, f, 4, 0)).toBeNull();
    expect(nextStep(g, f, 2, 0)).toBeNull();
    expect(nextStep(g, f, -5, 0)).toBeNull();
  });

  /** Squeezing through the corner where two walls meet is the classic way a
   *  grid-follower gets wedged. */
  it('refuses a diagonal between two wall corners', () => {
    const g = gridOf(['..#', '.#.', '...']);
    const f = flowField(g, 2, 0);
    const step = nextStep(g, f, 1, 1);
    // (2,0) is diagonally adjacent but both orthogonal neighbours are wall.
    expect(step).not.toEqual({ col: 2, row: 0 });
  });

  it('takes an open diagonal', () => {
    const g = gridOf(['...', '...', '...']);
    const f = flowField(g, 0, 0);
    expect(nextStep(g, f, 1, 1)).toEqual({ col: 0, row: 0 });
  });

  /** The real job: from anywhere reachable, repeated steps arrive. */
  it('always gets there in the end', () => {
    const g = gridOf([
      '..........',
      '.########.',
      '.#......#.',
      '.#.####.#.',
      '.#.#..#.#.',
      '.....#....',
    ]);
    const f = flowField(g, 4, 4);
    let c = 0;
    let r = 0;
    for (let i = 0; i < 200; i++) {
      const s = nextStep(g, f, c, r);
      if (!s) break;
      c = s.col;
      r = s.row;
    }
    expect([c, r]).toEqual([4, 4]);
  });
});

describe('line of sight', () => {
  it('sees straight down an open row', () => {
    const g = gridOf(['.....']);
    expect(lineOfSight(g, 0, 0, 4, 0)).toBe(true);
  });

  it('does not see through a wall', () => {
    const g = gridOf(['..#..']);
    expect(lineOfSight(g, 0, 0, 4, 0)).toBe(false);
  });

  it('sees itself', () => {
    expect(lineOfSight(gridOf(['.']), 0, 0, 0, 0)).toBe(true);
  });

  /** "I can see it" and "I can walk it" have to agree, or the enemy flips
   *  between steering into a wall and pathing around it every frame. */
  it('counts a wall the line only clips', () => {
    const g = gridOf(['...', '.#.', '...']);
    expect(lineOfSight(g, 0, 0, 2, 2)).toBe(false);
  });

  it('never sees out of the map', () => {
    const g = gridOf(['...']);
    expect(lineOfSight(g, 0, 0, 9, 9)).toBe(false);
  });
});

describe('how far an enemy cares', () => {
  it('chases what is close', () => {
    const g = gridOf(['.....']);
    const f = flowField(g, 0, 0);
    expect(withinChaseRange(f, g, 3, 0)).toBe(true);
  });

  /** One unreachable player must not drag every enemy on the map into a
   *  wall on the far side of it. */
  it('ignores what it cannot reach', () => {
    const g = gridOf(['..#..']);
    const f = flowField(g, 0, 0);
    expect(withinChaseRange(f, g, 4, 0)).toBe(false);
  });

  it('ignores what is simply too far', () => {
    const art = ['.'.repeat(CHASE_RANGE_TILES + 5)];
    const g = gridOf(art);
    const f = flowField(g, 0, 0);
    expect(withinChaseRange(f, g, CHASE_RANGE_TILES + 4, 0)).toBe(false);
  });
});
