import { describe, expect, it } from 'vitest';
import {
  BUFFER_SECS,
  DEFAULT_PROJECTION,
  JUMP_SECS,
  LANE_WIDTH,
  LaneRider,
  RunnerMoves,
  SLIDE_SECS,
  TrackBuilder,
  bendAt,
  clampLane,
  collides,
  depthOf,
  fairDistance,
  fogAlpha,
  laneX,
  project,
  speedAt,
  survives,
  swipeDir,
  wrapAngle,
} from '../src/index.js';
import type { Hazard } from '../src/index.js';

/** Deterministic "random" so a generator test cannot flake. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('perspective', () => {
  it('puts the camera plane at full size and the horizon at nothing', () => {
    expect(depthOf(0)).toBe(1);
    expect(depthOf(1e9)).toBeCloseTo(0, 5);
  });

  it('shrinks monotonically with distance', () => {
    let prev = Infinity;
    for (let z = 0; z < 5000; z += 250) {
      const s = depthOf(z);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });

  it('lands z=0 on the ground line and far things near the horizon', () => {
    const near = project(0, 0);
    expect(near.y).toBe(DEFAULT_PROJECTION.groundY);
    // Approaches the horizon without ever reaching it — that is what makes
    // it a horizon.
    expect(project(0, 500_000).y).toBeCloseTo(DEFAULT_PROJECTION.horizonY, -1);
    expect(project(0, 1e9).y).toBeCloseTo(DEFAULT_PROJECTION.horizonY, 3);
    expect(project(0, 1e9).y).toBeGreaterThan(DEFAULT_PROJECTION.horizonY);
  });

  it('narrows the road toward the vanishing point', () => {
    const nearEdge = project(LANE_WIDTH, 0).x;
    const farEdge = project(LANE_WIDTH, 3000).x;
    expect(nearEdge).toBeGreaterThan(farEdge);
    expect(farEdge).toBeGreaterThan(DEFAULT_PROJECTION.cx);
  });

  it('shrinks a jump with distance, so height reads as height', () => {
    const near = project(0, 0, 100);
    const far = project(0, 2000, 100);
    const nearLift = DEFAULT_PROJECTION.groundY - near.y;
    const farLift = project(0, 2000).y - far.y;
    expect(nearLift).toBeGreaterThan(farLift);
  });

  it('fades things in out of the haze rather than blinking them on', () => {
    expect(fogAlpha(0)).toBe(1);
    expect(fogAlpha(4200)).toBe(0);
    expect(fogAlpha(3800)).toBeGreaterThan(0);
    expect(fogAlpha(3800)).toBeLessThan(1);
  });
});

describe('the bend', () => {
  it('leaves the player alone and swings the far end', () => {
    // The player stands at z = 0, so a curve must never move them.
    expect(bendAt(0, 200)).toBe(0);
    expect(bendAt(1000, 200)).toBe(200);
    // Quadratic: three times the depth is nine times the drift, which is
    // what looking down a constant-radius curve actually looks like.
    expect(bendAt(3000, 200)).toBe(1800);
  });

  it('is dead straight when nobody asked for a curve', () => {
    for (const z of [0, 500, 4000]) expect(bendAt(z, 0)).toBe(0);
    expect(bendAt(2000)).toBe(0);
  });

  it('bends both ways', () => {
    expect(bendAt(2000, -150)).toBe(-bendAt(2000, 150));
  });

  it('moves the road on screen without moving the runner', () => {
    const straight = { ...DEFAULT_PROJECTION, bend: 0 };
    const curved = { ...DEFAULT_PROJECTION, bend: 200 };
    // Underfoot: identical.
    expect(project(0, 0, 0, curved).x).toBe(project(0, 0, 0, straight).x);
    // Ahead: visibly swung.
    expect(project(0, 2500, 0, curved).x).toBeGreaterThan(project(0, 2500, 0, straight).x + 40);
  });

  it('keeps a lane the same width all the way round the curve', () => {
    const curved = { ...DEFAULT_PROJECTION, bend: 200 };
    for (const z of [0, 900, 2400]) {
      const l = project(-LANE_WIDTH / 2, z, 0, curved).x;
      const r = project(LANE_WIDTH / 2, z, 0, curved).x;
      const straightWidth =
        project(LANE_WIDTH / 2, z, 0, DEFAULT_PROJECTION).x -
        project(-LANE_WIDTH / 2, z, 0, DEFAULT_PROJECTION).x;
      // The road swings, it does not stretch — a bend that widened lanes
      // would make the hitboxes lie.
      expect(r - l).toBeCloseTo(straightWidth, 6);
    }
  });
});

describe('lanes', () => {
  it('centres the middle lane on the road', () => {
    expect(laneX(1)).toBe(0);
    expect(laneX(0)).toBe(-LANE_WIDTH);
    expect(laneX(2)).toBe(LANE_WIDTH);
  });

  it('refuses to walk off the road', () => {
    expect(clampLane(-3)).toBe(0);
    expect(clampLane(9)).toBe(2);
  });

  it('takes real time to change lane', () => {
    const r = new LaneRider(1);
    expect(r.step(1)).toBe(true);
    expect(r.moving).toBe(true);
    r.update(1 / 60);
    // Moved, but nowhere near arrived — a teleport would fail this.
    expect(r.x).toBeGreaterThan(0);
    expect(r.x).toBeLessThan(LANE_WIDTH);
  });

  it('actually arrives, exactly', () => {
    const r = new LaneRider(1);
    r.step(1);
    for (let i = 0; i < 60; i++) r.update(1 / 60);
    expect(r.x).toBe(LANE_WIDTH);
    expect(r.moving).toBe(false);
  });

  it('reports an illegal step so the game can bump instead of swish', () => {
    const r = new LaneRider(0);
    expect(r.step(-1)).toBe(false);
    expect(r.lane).toBe(0);
  });
});

describe('moves', () => {
  it('goes up and comes back down', () => {
    const m = new RunnerMoves();
    m.jump();
    expect(m.airborne).toBe(true);
    let peak = 0;
    for (let t = 0; t < JUMP_SECS; t += 1 / 60) {
      m.update(1 / 60);
      peak = Math.max(peak, m.height);
    }
    expect(peak).toBeGreaterThan(100);
    m.update(1 / 60);
    expect(m.state).toBe('run');
    expect(m.height).toBe(0);
  });

  it('lets you jump out of a slide — being stuck in an animation is a bug', () => {
    const m = new RunnerMoves();
    m.slide();
    m.update(0.1);
    m.jump();
    expect(m.airborne).toBe(true);
    expect(m.sliding).toBe(false);
  });

  it('buffers a swipe that lands just before touchdown', () => {
    const m = new RunnerMoves();
    m.jump();
    // Most of the way through the jump, ask to slide.
    for (let t = 0; t < JUMP_SECS - 0.1; t += 1 / 60) m.update(1 / 60);
    m.slide();
    // Watch for it to happen at all rather than sampling at one moment —
    // both durations are tuning knobs, and the rule under test is not.
    let slidAfterLanding = false;
    for (let i = 0; i < 40; i++) {
      m.update(1 / 60);
      if (!m.airborne && m.sliding) slidAfterLanding = true;
    }
    // The early input was honoured rather than dropped on the floor.
    expect(slidAfterLanding).toBe(true);
  });

  it('forgets a buffered input older than the buffer', () => {
    const m = new RunnerMoves();
    m.jump();
    // A second jump right at take-off. Unlike a down-swipe this does not
    // fast-fall, so touchdown is a whole JUMP_SECS away — far longer than
    // the buffer, and by then it is not what the player meant any more.
    m.jump();
    expect(BUFFER_SECS).toBeLessThan(JUMP_SECS);
    let landed = false;
    for (let i = 0; i < 40; i++) {
      m.update(1 / 60);
      if (!m.airborne) landed = true;
      if (landed) break;
    }
    expect(landed).toBe(true);
    // Did not immediately launch again off a stale intent.
    expect(m.airborne).toBe(false);
  });

  it('turns a mid-air down-swipe into a fast fall', () => {
    const slow = new RunnerMoves();
    const fast = new RunnerMoves();
    slow.jump();
    fast.jump();
    fast.update(1 / 60);
    fast.slide();
    for (let i = 0; i < 12; i++) {
      slow.update(1 / 60);
      fast.update(1 / 60);
    }
    expect(fast.height).toBeLessThan(slow.height);
  });

  it('recovers from a slide on its own', () => {
    const m = new RunnerMoves();
    m.slide();
    for (let t = 0; t <= SLIDE_SECS + 0.05; t += 1 / 60) m.update(1 / 60);
    expect(m.state).toBe('run');
  });

  it('ramps toward a cap instead of accelerating forever', () => {
    expect(speedAt(0)).toBeCloseTo(1020);
    expect(speedAt(9000)).toBeGreaterThan(speedAt(3000));
    expect(speedAt(1e7)).toBeLessThanOrEqual(2600);
    // A cap is what stops every run ending identically at the speed where
    // reaction time runs out.
    expect(speedAt(1e7)).toBeCloseTo(2600, 0);
  });
});

describe('hazards', () => {
  it('has exactly one answer to each kind', () => {
    expect(survives('block', true, false)).toBe(true);
    expect(survives('block', false, true)).toBe(false);
    expect(survives('barrier', false, true)).toBe(true);
    expect(survives('barrier', true, false)).toBe(false);
    expect(survives('pit', true, false)).toBe(true);
    // Jumping into an overhang is the mistake `low` exists to punish.
    expect(survives('low', true, false)).toBe(false);
    expect(survives('low', false, true)).toBe(true);
  });

  it('only hits you in your own lane, and only when you are level with it', () => {
    const h: Hazard = { kind: 'block', lane: 1, z: 0 };
    expect(collides(1, h, false, false)).toBe(true);
    expect(collides(0, h, false, false)).toBe(false);
    expect(collides(1, { ...h, z: 400 }, false, false)).toBe(false);
    expect(collides(1, { ...h, z: -400 }, false, false)).toBe(false);
  });

  it('scales the fair warning distance with speed', () => {
    expect(fairDistance(2600)).toBeGreaterThan(fairDistance(1020));
  });
});

describe('track generation', () => {
  it('always leaves a lane open', () => {
    const t = new TrackBuilder({ rand: seeded(7), density: 1 });
    const { hazards } = t.build(0, 60_000, 620);
    expect(hazards.length).toBeGreaterThan(20);
    const byZ = new Map<number, Set<number>>();
    for (const h of hazards) {
      if (!byZ.has(h.z)) byZ.set(h.z, new Set());
      byZ.get(h.z)!.add(h.lane);
    }
    for (const [, lanes] of byZ) expect(lanes.size).toBeLessThan(3);
  });

  it('never spawns something closer than the player can react to', () => {
    const speed = 2600;
    const t = new TrackBuilder({ rand: seeded(3) });
    const { hazards } = t.build(0, 40_000, speed);
    for (const h of hazards) expect(h.z).toBeGreaterThanOrEqual(fairDistance(speed));
  });

  it('does not repeat the same hazard three rows running', () => {
    const t = new TrackBuilder({ rand: seeded(11), density: 1 });
    const { hazards } = t.build(0, 80_000, 620);
    const rows = [...new Map(hazards.map((h) => [h.z, h.kind])).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, k]) => k);
    for (let i = 2; i < rows.length; i++) {
      expect(rows[i] === rows[i - 1] && rows[i - 1] === rows[i - 2]).toBe(false);
    }
  });

  it('puts coins in a lane you can actually take', () => {
    const t = new TrackBuilder({ rand: seeded(5), density: 1 });
    const { hazards, pickups } = t.build(0, 40_000, 620);
    const blocked = new Map<number, Set<number>>();
    for (const h of hazards) {
      if (!blocked.has(h.z)) blocked.set(h.z, new Set());
      blocked.get(h.z)!.add(h.lane);
    }
    for (const p of pickups) {
      const at = blocked.get(p.z);
      if (at) expect(at.has(p.lane)).toBe(false);
    }
  });

  it('keeps building forward and never backward', () => {
    const t = new TrackBuilder({ rand: seeded(2) });
    t.build(0, 10_000, 620);
    const first = t.frontier;
    t.build(0, 20_000, 620);
    expect(t.frontier).toBeGreaterThan(first);
  });
});

describe('swipes', () => {
  it('ignores a drag that has not committed yet', () => {
    expect(swipeDir(5, 3)).toBeNull();
  });

  it('lets the dominant axis win, because nobody swipes straight', () => {
    expect(swipeDir(80, 30)).toBe('right');
    expect(swipeDir(30, 80)).toBe('down');
    expect(swipeDir(-80, -30)).toBe('left');
    expect(swipeDir(-30, -80)).toBe('up');
  });
});

describe('rolling', () => {
  it('keeps the angle small so a long run cannot go jittery', () => {
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-0.5)).toBeCloseTo(Math.PI * 2 - 0.5);
    expect(wrapAngle(1e7)).toBeLessThan(Math.PI * 2);
    expect(wrapAngle(1e7)).toBeGreaterThanOrEqual(0);
  });
});
