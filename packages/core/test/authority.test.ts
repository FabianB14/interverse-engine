import { describe, expect, it } from 'vitest';
import {
  LOST_AFTER_MS, RECONNECT_DELAYS_MS, SLOW_AFTER_MS, SNAP_DISTANCE, encodeWorld, goneFrom,
  BUFFER_STALE_MS, INTERP_DELAY_MS, SnapshotBuffer,
  isFresh, linkState, reconnectDelay, roleOf, shouldSnap, simulates, smoothTo,
} from '../src/index.js';

describe('who simulates', () => {
  it('reads the role off the session', () => {
    expect(roleOf(null)).toBe('solo');
    expect(roleOf({ isHost: true })).toBe('host');
    expect(roleOf({ isHost: false })).toBe('joiner');
  });

  /** The whole point: two machines rolling their own dice for enemy AI
   *  diverge immediately, so exactly one of them may run the world. */
  it('lets the host and a solo game run the world, and nobody else', () => {
    expect(simulates('solo')).toBe(true);
    expect(simulates('host')).toBe(true);
    expect(simulates('joiner')).toBe(false);
  });
});

describe('what goes on the wire', () => {
  const mobs = [{ name: 'Slime', x: 10.4, y: 20.6, hp: 3.2 }];

  it('carries a mob by name, position and health', () => {
    const s = encodeWorld(1234.7, mobs, []);
    expect(s.mobs[0]).toEqual({ n: 'Slime', x: 10, y: 21, hp: 3 });
    expect(s.t).toBe(1235);
  });

  /** A hundredth of a pixel is invisible and costs bytes ten times a
   *  second, forever. */
  it('rounds to whole pixels', () => {
    const s = encodeWorld(0, [], [{ x: 1.999, y: -0.4 }]);
    expect(s.shots[0]).toEqual({ x: 2, y: 0 });
  });

  it('is happy with an empty world', () => {
    expect(encodeWorld(0, [], [])).toEqual({ t: 0, mobs: [], shots: [] });
  });
});

describe('accepting a snapshot', () => {
  it('takes the first one', () => {
    expect(isFresh({ t: 5, mobs: [], shots: [] }, 0)).toBe(true);
  });

  /** A reordered packet would drag the world backwards — visibly, as a
   *  stutter that only happens on bad connections. */
  it('refuses one older than what it already has', () => {
    expect(isFresh({ t: 5, mobs: [], shots: [] }, 9)).toBe(false);
    expect(isFresh({ t: 5, mobs: [], shots: [] }, 5)).toBe(false);
  });

  it('refuses nonsense rather than trusting it', () => {
    expect(isFresh(null as never, 0)).toBe(false);
    expect(isFresh({ t: 'soon' } as never, 0)).toBe(false);
  });
});

describe('smoothing between snapshots', () => {
  it('moves toward the target', () => {
    const out = smoothTo(0, 100, 1 / 60);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(100);
  });

  /** The naive lerp overshoots once rate*dt passes 1, which shows up as
   *  jitter that only appears on slow phones. */
  it('never overshoots, however bad the frame rate', () => {
    for (const dt of [1 / 60, 0.1, 0.5, 2]) {
      const out = smoothTo(0, 100, dt);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(100);
    }
  });

  it('converges rather than stalling', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) v = smoothTo(v, 100, 1 / 60);
    expect(v).toBeCloseTo(100, 1);
  });

  it('stays put when there is nothing to move toward', () => {
    expect(smoothTo(5, NaN, 0.016)).toBe(5);
  });

  it('snaps rather than sliding across the map', () => {
    expect(shouldSnap(SNAP_DISTANCE + 1, 0)).toBe(true);
    expect(shouldSnap(10, 10)).toBe(false);
  });
});

describe('what the host stopped sending', () => {
  /** Only the host decides an enemy is gone; a joiner deleting one on its
   *  own is exactly the desync this design removes. */
  it('is what a joiner should remove', () => {
    const snap = { t: 1, mobs: [{ n: 'A', x: 0, y: 0, hp: 1 }], shots: [] };
    expect(goneFrom(['A', 'B'], snap)).toEqual(['B']);
  });

  it('keeps everything when the host still sends everything', () => {
    const snap = { t: 1, mobs: [{ n: 'A', x: 0, y: 0, hp: 1 }], shots: [] };
    expect(goneFrom(['A'], snap)).toEqual([]);
  });
});

describe('telling the player about the connection', () => {
  it('is live while snapshots keep coming', () => {
    expect(linkState(0)).toBe('live');
    expect(linkState(SLOW_AFTER_MS - 1)).toBe('live');
  });

  /** A game that silently freezes is worse than one that says so: the
   *  player can decide whether to wait. */
  it('admits when it is struggling, then when it is gone', () => {
    expect(linkState(SLOW_AFTER_MS)).toBe('slow');
    expect(linkState(LOST_AFTER_MS)).toBe('lost');
  });
});

describe('reconnecting', () => {
  it('backs off instead of hammering the relay', () => {
    const d = RECONNECT_DELAYS_MS;
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
  });

  it('gives up rather than retrying forever', () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelay(RECONNECT_DELAYS_MS.length)).toBeNull();
  });
});

describe('⏱ interpolating between snapshots', () => {
  const snap = (t, x) => ({ t, mobs: [{ n: 'A', x, y: 0, hp: 3 }], shots: [] });

  it('holds the only thing it has', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 100), 1000);
    expect(buf.sample(1000).get('A')).toEqual({ x: 100, y: 0 });
  });

  /** The point of the delay: between two real snapshots there is always
   *  something to interpolate, so motion is constant rather than lurching. */
  it('renders the halfway point halfway between two snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 0), 1000);
    buf.push(snap(2, 100), 1100);
    // Ask for 1050 (delay 120 from now=1170) — halfway between the pair.
    expect(buf.sample(1170, 120).get('A')!.x).toBeCloseTo(50, 5);
  });

  it('never runs ahead of what it was told', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 0), 1000);
    buf.push(snap(2, 100), 1100);
    for (let now = 1100; now < 1400; now += 10) {
      const x = buf.sample(now, INTERP_DELAY_MS).get('A')!.x;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }
  });

  /** A dropped connection must not send a monster sailing off the map. */
  it('holds the last pose when nothing arrives', () => {
    const buf = new SnapshotBuffer();
    buf.push(snap(1, 0), 1000);
    buf.push(snap(2, 100), 1100);
    expect(buf.sample(1100 + BUFFER_STALE_MS + 500).get('A')).toEqual({ x: 100, y: 0 });
  });

  it('refuses a packet that arrives out of order', () => {
    const buf = new SnapshotBuffer();
    expect(buf.push(snap(5, 0), 1000)).toBe(true);
    expect(buf.push(snap(3, 999), 1010)).toBe(false);
    expect(buf.latest().t).toBe(5);
  });

  /** Unbounded history would be a leak in a game that runs for an hour. */
  it('keeps only enough history to cover a hiccup', () => {
    const buf = new SnapshotBuffer();
    for (let i = 1; i <= 40; i++) buf.push(snap(i, i), 1000 + i * 100);
    expect(buf.size).toBeLessThanOrEqual(8);
    expect(buf.latest().t).toBe(40);
  });

  it('shows something that only just appeared, rather than hiding it', () => {
    const buf = new SnapshotBuffer();
    buf.push({ t: 1, mobs: [], shots: [] }, 1000);
    buf.push(snap(2, 70), 1100);
    expect(buf.sample(1170, 120).get('A')).toEqual({ x: 70, y: 0 });
  });

  it('starts empty and can be emptied again', () => {
    const buf = new SnapshotBuffer();
    expect(buf.sample(0).size).toBe(0);
    buf.push(snap(1, 0), 10);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.latest()).toBeNull();
  });
});
