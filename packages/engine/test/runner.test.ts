import { describe, expect, it } from 'vitest';
import {
  BUFFER_SECS,
  DEFAULT_PROJECTION,
  HAZARD_RULES,
  HAZARD_SHAPES,
  JUMP_HEIGHT,
  JUMP_PEAK,
  JUMP_SECS,
  LANE_WIDTH,
  LaneRider,
  RunnerMoves,
  SLIDE_SECS,
  TURN_ARC,
  TrackBuilder,
  bendAt,
  rowGap,
  cornerDone,
  cornerSpace,
  clampLane,
  collides,
  cornerClear,
  densityAt,
  depthOf,
  fairDistance,
  fogAlpha,
  laneX,
  playerBand,
  project,
  speedAt,
  survives,
  survivesBand,
  swipeDir,
  wrapAngle,
  yawFor,
} from '../src/index.js';
import type { CornerFrame, Hazard, HazardKind } from '../src/index.js';

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

describe('corners', () => {
  const at = (ahead: number, dir: number): CornerFrame => ({
    ahead,
    dir,
    yaw: yawFor(ahead, dir),
  });

  it('leaves the road before the corner exactly as it was', () => {
    const f = at(2000, 1);
    const p = cornerSpace(50, 900, f);
    expect(p.x).toBeCloseTo(50);
    expect(p.z).toBeCloseTo(900);
  });

  it('sends the road off sideways past the corner', () => {
    const f = { ahead: 2000, dir: 1, yaw: 0 };
    // 500 beyond the corner, on the centre line: 500 to the right, at the
    // corner's own depth. That is a right angle, seen from behind.
    const p = cornerSpace(0, 2500, f);
    expect(p.x).toBeCloseTo(500);
    expect(p.z).toBeCloseTo(2000);
  });

  it('turns the other way for a left corner', () => {
    const right = cornerSpace(0, 2500, { ahead: 2000, dir: 1, yaw: 0 });
    const left = cornerSpace(0, 2500, { ahead: 2000, dir: -1, yaw: 0 });
    expect(left.x).toBeCloseTo(-right.x);
    expect(left.z).toBeCloseTo(right.z);
  });

  it('holds the camera still until the corner is close', () => {
    expect(yawFor(4000, 1)).toBe(0);
    expect(yawFor(TURN_ARC, 1)).toBe(0);
    expect(Math.abs(yawFor(TURN_ARC * 0.5, 1))).toBeGreaterThan(0.1);
    // Short enough that the ground under the runner barely has time to tilt.
    expect(TURN_ARC).toBeLessThan(600);
  });

  it('comes to exactly a right angle as the corner arrives', () => {
    expect(yawFor(0, 1)).toBeCloseTo(-Math.PI / 2);
    expect(yawFor(0, -1)).toBeCloseTo(Math.PI / 2);
  });

  it('turns smoothly — no jump at either end of the swing', () => {
    let prev = 0;
    let biggestStep = 0;
    for (let ahead = TURN_ARC; ahead >= 0; ahead -= TURN_ARC / 60) {
      const y = yawFor(ahead, 1);
      biggestStep = Math.max(biggestStep, Math.abs(y - prev));
      prev = y;
    }
    // Over sixty frames of swing, no single one may lurch.
    expect(biggestStep).toBeLessThan(0.06);
  });

  /**
   * The one that matters: at the instant the corner arrives, the turned
   * frame and a plain straight one must agree exactly. That identity is what
   * lets the scene drop the corner with nothing on screen moving.
   */
  for (const dir of [1, -1]) {
    it(`hands over to a straight frame with no seam (dir ${dir})`, () => {
      const done = at(0, dir);
      for (const lateral of [-190, 0, 190]) {
        for (const depth of [200, 1500, 3800]) {
          const turned = cornerSpace(lateral, depth, done);
          const straight = cornerSpace(lateral, depth, null);
          expect(turned.x).toBeCloseTo(straight.x, 6);
          expect(turned.z).toBeCloseTo(straight.z, 6);
        }
      }
    });
  }

  it('says when it is finished', () => {
    expect(cornerDone({ ahead: 40, dir: 1, yaw: 0 })).toBe(false);
    expect(cornerDone({ ahead: 0, dir: 1, yaw: 0 })).toBe(true);
    expect(cornerDone({ ahead: -80, dir: 1, yaw: 0 })).toBe(true);
  });

  it('keeps a lane the same width right through the turn', () => {
    for (const ahead of [2400, 1200, 400, 0]) {
      const f = at(ahead, 1);
      // Sample past the corner, where the road is running sideways.
      const l = cornerSpace(-LANE_WIDTH / 2, ahead + 800, f);
      const r = cornerSpace(LANE_WIDTH / 2, ahead + 800, f);
      expect(Math.hypot(r.x - l.x, r.z - l.z)).toBeCloseTo(LANE_WIDTH, 6);
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

  it('opens slowly and takes a real run to get quick', () => {
    // A new player has to get to see the game at a speed they can act on.
    expect(speedAt(0)).toBeLessThan(800);

    // Halfway between the opening speed and the cap must be TENS of thousands
    // of units away, not hundreds. If the ramp is over in the first few
    // seconds then it is not a ramp, it is a starting speed with a preamble.
    const cap = speedAt(1e9);
    const half = (speedAt(0) + cap) / 2;
    let toHalf = 0;
    while (speedAt(toHalf) < half && toHalf < 1e6) toHalf += 500;
    expect(toHalf).toBeGreaterThan(12_000);

    // But it does get there: a long run is properly quick.
    expect(speedAt(60_000)).toBeGreaterThan(speedAt(0) * 3);
  });

  it('ramps toward a cap instead of accelerating forever', () => {
    expect(speedAt(0)).toBeCloseTo(700);
    expect(speedAt(9000)).toBeGreaterThan(speedAt(3000));
    expect(speedAt(1e7)).toBeLessThanOrEqual(2500);
    // A cap is what stops every run ending identically at the speed where
    // reaction time runs out.
    expect(speedAt(1e7)).toBeCloseTo(2500, 0);
  });
});

describe('hazards', () => {
  const running = playerBand(0, 0);
  const sliding = playerBand(0, 1);
  const atPeak = playerBand(JUMP_PEAK, 0);

  it('agrees with the jump module about how high a jump goes', () => {
    // track.ts states the peak itself to avoid a module cycle. This is the
    // one place that agreement can be enforced.
    expect(JUMP_PEAK).toBe(JUMP_HEIGHT);
  });

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

  it('derives the answers from the shapes rather than declaring them', () => {
    for (const kind of Object.keys(HAZARD_SHAPES) as HazardKind[]) {
      expect(HAZARD_RULES[kind].jump).toBe(survivesBand(kind, atPeak));
      expect(HAZARD_RULES[kind].slide).toBe(survivesBand(kind, sliding));
    }
  });

  it('stops a runner who does nothing at all', () => {
    for (const kind of Object.keys(HAZARD_SHAPES) as HazardKind[]) {
      expect(survivesBand(kind, running)).toBe(false);
    }
  });

  /**
   * The bug this model exists to make impossible: the line the player is
   * asked to duck under has to BE the bottom of the obstacle. Since the art
   * is drawn from `shape.low`, that holds as long as a slide fits under it
   * and a run does not.
   */
  it('leaves a real, visible gap under everything you slide beneath', () => {
    for (const kind of ['barrier', 'low'] as HazardKind[]) {
      const shape = HAZARD_SHAPES[kind];
      expect(sliding.high).toBeLessThan(shape.low);
      // …and enough of one that arriving mid-crouch is not a coin flip.
      expect(shape.low - sliding.high).toBeGreaterThan(15);
      // A standing runner must NOT fit, or the slide would be optional.
      expect(running.high).toBeGreaterThan(shape.low);
    }
  });

  it('lets a partly-crouched runner through as soon as they are low enough', () => {
    // Continuous, not a state flag: the geometry decides, so the moment the
    // blob is visibly under the branch it is under the branch.
    expect(survivesBand('barrier', playerBand(0, 0.4))).toBe(false);
    expect(survivesBand('barrier', playerBand(0, 0.9))).toBe(true);
  });

  it('clears a log for most of the jump, not just at the apex', () => {
    let clear = 0;
    const steps = 40;
    for (let i = 1; i < steps; i++) {
      const p = i / steps;
      const h = JUMP_PEAK * 4 * p * (1 - p);
      if (survivesBand('block', playerBand(h, 0))) clear++;
    }
    // A window this wide is what makes a jump feel like a jump rather than
    // a frame-perfect input.
    expect(clear / (steps - 1)).toBeGreaterThan(0.6);
  });

  it('only hits you in your own lane, and only when you are level with it', () => {
    const h: Hazard = { kind: 'block', lane: 1, z: 0 };
    expect(collides(1, h, running)).toBe(true);
    expect(collides(0, h, running)).toBe(false);
    expect(collides(1, { ...h, z: 400 }, running)).toBe(false);
    expect(collides(1, { ...h, z: -400 }, running)).toBe(false);
  });

  it('spaces rows further apart the faster you go', () => {
    expect(rowGap(2500)).toBeGreaterThan(rowGap(700));
  });

  it('still closes the gap in TIME, which is what makes it get harder', () => {
    // The gap grows with speed but by less than speed does, so seconds
    // between obstacles shortens — deliberately, and never to nothing.
    const early = rowGap(700) / 700;
    const late = rowGap(2500) / 2500;
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0.45);
    expect(early).toBeGreaterThan(0.8);
  });

  it('never collapses to zero spacing, whatever it is handed', () => {
    expect(rowGap(0)).toBeGreaterThan(0);
    expect(rowGap(-999)).toBeGreaterThan(0);
  });

  it('scales the fair warning distance with speed', () => {
    expect(fairDistance(2500)).toBeGreaterThan(fairDistance(700));
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
    const speed = 2500;
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

  it('leaves more road between rows at speed than it does at a crawl', () => {
    const slow = new TrackBuilder({ rand: seeded(9), density: 1 });
    const fast = new TrackBuilder({ rand: seeded(9), density: 1 });
    const rows = (b: TrackBuilder, speed: number): number =>
      new Set(b.build(0, 60_000, speed).hazards.map((h) => h.z)).size;
    expect(rows(fast, 2500)).toBeLessThan(rows(slow, 700));
  });

  it('makes the one unrecoverable hazard the rarest', () => {
    const t = new TrackBuilder({ rand: seeded(21), density: 1 });
    const { hazards } = t.build(0, 400_000, 900);
    const kinds = [...new Map(hazards.map((h) => [h.z, h.kind])).values()];
    const share = (k: HazardKind): number => kinds.filter((x) => x === k).length / kinds.length;
    // Every other hazard is a stumble you run out of; a pit ends the run.
    // At an even split a quarter of all rows carried the only mistake with
    // no recovery, and runs were over before they had been anywhere.
    expect(share('pit')).toBeLessThan(0.18);
    for (const k of ['block', 'barrier', 'low'] as HazardKind[]) {
      expect(share(k)).toBeGreaterThan(share('pit'));
    }
    // Still common enough to be a real part of the vocabulary.
    expect(share('pit')).toBeGreaterThan(0.04);
  });

  it('keeps building forward and never backward', () => {
    const t = new TrackBuilder({ rand: seeded(2) });
    t.build(0, 10_000, 620);
    const first = t.frontier;
    t.build(0, 20_000, 620);
    expect(t.frontier).toBeGreaterThan(first);
  });
});

describe('the opening', () => {
  it('ramps from the sparse density to the full one, and never back', () => {
    expect(densityAt(0, 1, 0.28, 12_000)).toBeCloseTo(0.28);
    expect(densityAt(12_000, 1, 0.28, 12_000)).toBeCloseTo(1);
    // Past the warm-up it stops climbing rather than overshooting.
    expect(densityAt(50_000, 1, 0.28, 12_000)).toBeCloseTo(1);
    let prev = -1;
    for (let z = 0; z <= 14_000; z += 250) {
      const d = densityAt(z, 1, 0.28, 12_000);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('holds the sparse density for the first few rows rather than filling at once', () => {
    // The point of smoothstepping the ramp: a tenth of the way in should
    // still be near the opening, not already a third of the way to full.
    const tenth = densityAt(1_200, 1, 0.28, 12_000);
    expect(tenth - 0.28).toBeLessThan((1 - 0.28) * 0.1);
  });

  it('puts less on the road at the start of a run than in the middle of one', () => {
    const t = new TrackBuilder({ rand: seeded(13), density: 1, warmup: 12_000 });
    const { hazards } = t.build(0, 72_000, 700);
    const rows = [...new Set(hazards.map((h) => h.z))];
    const between = (lo: number, hi: number): number =>
      rows.filter((z) => z >= lo && z < hi).length;
    // Same width of road, warmed up versus not.
    expect(between(0, 12_000)).toBeLessThan(between(36_000, 48_000));
  });

  it('is sparse, not bare — a road with nothing on it teaches that nothing is coming', () => {
    const t = new TrackBuilder({ rand: seeded(31), density: 0.68, warmup: 12_000 });
    const { hazards } = t.build(0, 12_000, 700);
    expect(new Set(hazards.map((h) => h.z)).size).toBeGreaterThan(0);
  });
});

describe('keep-clear spans', () => {
  it('leaves the road around a corner empty', () => {
    const speed = 900;
    const cornerZ = 30_000;
    const span = cornerClear(cornerZ, speed);
    const t = new TrackBuilder({ rand: seeded(17), density: 1, warmup: 0 });
    t.clear = [span];
    const { hazards, pickups } = t.build(0, 60_000, speed);

    for (const h of hazards) {
      expect(h.z >= span.from && h.z <= span.to).toBe(false);
    }
    // …and the span was actually crossed, so this is not passing on a build
    // that never reached it.
    expect(hazards.some((h) => h.z < span.from)).toBe(true);
    expect(hazards.some((h) => h.z > span.to)).toBe(true);
    // Coins still run through it. An empty road reads as the generator
    // giving up; a coin trail reads as somewhere to look up.
    expect(pickups.some((p) => p.z >= span.from && p.z <= span.to)).toBe(true);
  });

  it('gives a corner more road at speed, and more of it on the way in', () => {
    const slow = cornerClear(40_000, 700);
    const fast = cornerClear(40_000, 2500);
    expect(fast.to - fast.from).toBeGreaterThan(slow.to - slow.from);
    // The run-up is the longer half: reading the shape of a turn is the
    // harder of the two jobs, and it happens before the turn.
    expect(40_000 - fast.from).toBeGreaterThan(fast.to - 40_000);
  });

  it('does not clear road it was not asked to', () => {
    const t = new TrackBuilder({ rand: seeded(19), density: 1, warmup: 0 });
    t.clear = [cornerClear(30_000, 900)];
    const { hazards } = t.build(0, 60_000, 900);
    // Everything outside one span is still a normal track.
    expect(new Set(hazards.map((h) => h.z)).size).toBeGreaterThan(20);
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
