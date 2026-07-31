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
