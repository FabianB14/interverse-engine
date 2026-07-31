/**
 * 🛰 Who is allowed to decide what, in a multiplayer game.
 *
 * Shared state was already host-authoritative, but the WORLD was not: every
 * peer ran its own copy of the enemy AI. Two machines rolling their own dice
 * for wander direction, their own timers for attacks and their own hit
 * detection do not converge — they diverge immediately, so players saw
 * different monsters in different places and killed things that were still
 * alive next door. There is no amount of smoothing that fixes that; only one
 * machine can be right.
 *
 * So: the host simulates, everyone else renders. A joiner never moves a mob,
 * never fires a mob's shot and never decides that a mob died. What a joiner
 * DOES do is ask — "I hit Slime A for 2" — and the host answers by changing
 * the world everyone can see.
 *
 * Snapshots arrive ten times a second, which is nowhere near a frame rate,
 * so the rendering side interpolates toward the last thing it was told. That
 * is the difference between "a monster" and "a monster teleporting".
 */

/** One enemy, as small as it can be on the wire. */
export interface MobSnap {
  /** The actor's name — already unique within a level, and stable. */
  n: string;
  x: number;
  y: number;
  hp: number;
}

export interface ShotSnap {
  x: number;
  y: number;
}

export interface WorldSnap {
  /** Sender's clock in ms, so a joiner can spot a stale or reordered one. */
  t: number;
  mobs: MobSnap[];
  shots: ShotSnap[];
}

/** A joiner asking the host to apply damage it believes it dealt. */
export interface HitRequest {
  /** Mob name. */
  n: string;
  dmg: number;
}

export type NetRole = 'solo' | 'host' | 'joiner';

export function roleOf(net: { isHost: boolean } | null): NetRole {
  if (!net) return 'solo';
  return net.isHost ? 'host' : 'joiner';
}

/**
 * May this machine run the world? Solo and host yes, joiner no. Everything
 * that moves an enemy, starts an enemy's attack or decides an enemy died
 * asks this one question, so there is exactly one place the rule lives.
 */
export function simulates(role: NetRole): boolean {
  return role !== 'joiner';
}

/** Whole pixels, and never `-0` — which is what Math.round gives for any
 *  small negative and which compares unequal to 0 in a strict test. */
function px(v: number): number {
  return Math.round(v) || 0;
}

/** Positions are whole pixels on the wire: a hundredth of a pixel is not
 *  visible and costs bytes ten times a second, forever. */
export function encodeWorld(
  now: number,
  mobs: readonly { name: string; x: number; y: number; hp: number }[],
  shots: readonly { x: number; y: number }[],
): WorldSnap {
  return {
    t: px(now),
    mobs: mobs.map((m) => ({ n: m.name, x: px(m.x), y: px(m.y), hp: px(m.hp) })),
    shots: shots.map((s) => ({ x: px(s.x), y: px(s.y) })),
  };
}

/**
 * Should this snapshot be applied? Anything older than what we already have
 * is a reordered packet, and applying it would drag the world backwards.
 * The first snapshot always applies (`last` of 0).
 */
export function isFresh(snap: WorldSnap, lastT: number): boolean {
  return !!snap && typeof snap.t === 'number' && snap.t > lastT;
}

/**
 * Frame-rate-independent smoothing toward a target. The naive
 * `cur + (target - cur) * rate * dt` is wrong at low frame rates — it
 * overshoots when `rate * dt` passes 1, which shows up as a jitter that only
 * appears on slow phones. The exponential form cannot.
 */
export function smoothTo(cur: number, target: number, dt: number, rate = 12): number {
  if (!Number.isFinite(target)) return cur;
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  return cur + (target - cur) * k;
}

/** Far enough that easing would look like sliding through a wall — snap. */
export const SNAP_DISTANCE = 320;

export function shouldSnap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > SNAP_DISTANCE;
}

/** Which mobs a joiner should delete: anything the host stopped sending.
 *  The host is the only thing that decides an enemy is gone. */
export function goneFrom(known: readonly string[], snap: WorldSnap): string[] {
  const alive = new Set(snap.mobs.map((m) => m.n));
  return known.filter((n) => !alive.has(n));
}

/**
 * Connection health as the player experiences it. A game that silently
 * freezes is worse than one that says "reconnecting" — the player can decide
 * whether to wait.
 */
export type LinkState = 'live' | 'slow' | 'lost';

export const SLOW_AFTER_MS = 2000;
export const LOST_AFTER_MS = 8000;

export function linkState(msSinceSnapshot: number): LinkState {
  if (msSinceSnapshot >= LOST_AFTER_MS) return 'lost';
  if (msSinceSnapshot >= SLOW_AFTER_MS) return 'slow';
  return 'live';
}

/** Back off between reconnect attempts instead of hammering the relay, and
 *  stop pretending after enough tries. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];

export function reconnectDelay(attempt: number): number | null {
  return RECONNECT_DELAYS_MS[attempt] ?? null;
}

// ------------------------------------------------------ ⏱ lag compensation

/**
 * How far behind live the renderer runs, in ms.
 *
 * Easing toward the newest snapshot is smooth but always guessing: between
 * packets there is nothing to ease toward, so motion stalls and then lurches
 * when the next one lands. Rendering slightly in the PAST instead means
 * there are always two real snapshots to interpolate between, so remote
 * things move at a constant, correct speed.
 *
 * The cost is exactly this much extra latency on everything you do not
 * control, which is why it is only a little more than one snapshot interval
 * (100ms) — enough to always have a pair, not enough to feel behind.
 */
export const INTERP_DELAY_MS = 120;

/** Nothing has arrived for this long: stop interpolating and hold, rather
 *  than extrapolating a monster off into the distance. */
export const BUFFER_STALE_MS = 1000;

interface Held {
  /** LOCAL arrival time. The host's clock is not ours and the difference
   *  between two machines' clocks is unbounded — but the gaps between
   *  arrivals are exactly what interpolation needs, and those are local. */
  at: number;
  snap: WorldSnap;
}

/**
 * Keeps the last few world snapshots so the renderer can look up where
 * something was a moment ago, between two things the host actually said.
 */
export class SnapshotBuffer {
  private held: Held[] = [];

  /** Ignores anything out of order — a late packet must not rewrite history. */
  push(snap: WorldSnap, nowMs: number): boolean {
    const last = this.held[this.held.length - 1];
    if (last && !isFresh(snap, last.snap.t)) return false;
    this.held.push({ at: nowMs, snap });
    // Two is the minimum to interpolate between; a handful covers a hiccup.
    while (this.held.length > 8) this.held.shift();
    return true;
  }

  get size(): number {
    return this.held.length;
  }

  latest(): WorldSnap | null {
    return this.held[this.held.length - 1]?.snap ?? null;
  }

  /**
   * The world as it was `INTERP_DELAY_MS` ago. Returns positions only —
   * health and existence come from the newest snapshot, because being told
   * late that something died is fine but being told a stale HP is not.
   */
  sample(nowMs: number, delayMs = INTERP_DELAY_MS): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    if (!this.held.length) return out;
    const target = nowMs - delayMs;
    const newest = this.held[this.held.length - 1]!;
    // Nothing recent: hold the last known pose rather than extrapolating a
    // monster off into the distance on a dropped connection.
    if (nowMs - newest.at > BUFFER_STALE_MS || target >= newest.at) {
      for (const m of newest.snap.mobs) out.set(m.n, { x: m.x, y: m.y });
      return out;
    }
    // Find the pair bracketing the target time.
    let b = 0;
    while (b < this.held.length && this.held[b]!.at < target) b++;
    const after = this.held[Math.min(b, this.held.length - 1)]!;
    const before = this.held[Math.max(0, b - 1)]!;
    const span = after.at - before.at;
    const k = span > 0 ? Math.max(0, Math.min(1, (target - before.at) / span)) : 1;
    const from = new Map(before.snap.mobs.map((m) => [m.n, m]));
    for (const m of after.snap.mobs) {
      const a = from.get(m.n);
      // New since the earlier snapshot: it has no history to come from.
      out.set(m.n, a ? { x: a.x + (m.x - a.x) * k, y: a.y + (m.y - a.y) * k } : { x: m.x, y: m.y });
    }
    return out;
  }

  clear(): void {
    this.held = [];
  }
}
