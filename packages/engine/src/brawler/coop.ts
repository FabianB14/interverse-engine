/**
 * 🤝 Four blobs in the same fight.
 *
 * Co-op turns every question in a brawler into a harder one. Whose enemies
 * are these? Whose gate is it? What happens when one of you dies and the
 * other three are still swinging?
 *
 * The answers here are deliberately blunt, because the alternative to a
 * blunt answer is two machines with different opinions:
 *
 *   - The HOST owns the world. Enemies, waves, gates and enemy health are
 *     its business alone; everyone else renders what it says. (The general
 *     machinery for that lives in net/authority.ts — this file is the part
 *     that is specific to a party of fighters.)
 *   - Each player owns their OWN body. Where you are and whether you got hit
 *     is decided on your machine, because a round-trip before you feel your
 *     own hit is the one delay nobody forgives.
 *   - The gate opens for EVERYONE at once, and the stage is only lost when
 *     the last of you goes down.
 *
 * That last rule is what makes it co-op rather than four people playing
 * alone next to each other: a downed friend is a problem you can solve.
 */

/** One player as everyone else needs to see them. */
export interface PartyMember {
  id: string;
  name: string;
  /** Roster class id — decides colour and silhouette. */
  classId: string;
  x: number;
  y: number;
  /** Height above the plane, so a jump reads the same on every screen. */
  z: number;
  /** Facing, +1 right. */
  dir: number;
  hearts: number;
  heartsMax: number;
  /** Out of the fight until a friend picks them up. */
  downed: boolean;
}

export function emptyMember(id: string, name: string, classId: string): PartyMember {
  return { id, name, classId, x: 0, y: 0, z: 0, dir: 1, hearts: 0, heartsMax: 0, downed: false };
}

// ------------------------------------------------------------- reviving

/** How long a friend has to stand over you. Long enough to be a real
 *  decision in the middle of a fight, short enough to be worth making. */
export const REVIVE_SECS = 2;

/** How close counts as "standing over you". Generous — fumbling for a pixel
 *  while enemies hit you is not the interesting part of the mechanic. */
export const REVIVE_RANGE = 110;

/** Hearts you come back with. Not full: a rescue is a second chance, not a
 *  reset, or going down stops mattering. */
export const REVIVE_HEARTS = 2;

export function inReviveRange(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= REVIVE_RANGE;
}

/**
 * Advance a revive. Returns the new progress in seconds — the caller
 * compares against REVIVE_SECS. Progress DECAYS rather than resetting when
 * the rescuer steps away, so being knocked back for half a second does not
 * throw away the two you already spent.
 */
export function reviveProgress(current: number, helping: boolean, dt: number): number {
  const next = helping ? current + dt : current - dt * 1.5;
  return Math.max(0, Math.min(REVIVE_SECS, next));
}

// -------------------------------------------------------- party outcomes

/**
 * Is the run over? Only when everyone is down.
 *
 * Checked as "nobody is standing" rather than "I am down", so a player who
 * goes down while their friends fight on keeps watching a game they might
 * yet be pulled back into.
 */
export function partyWiped(members: readonly PartyMember[]): boolean {
  return members.length > 0 && members.every((m) => m.downed);
}

export function standing(members: readonly PartyMember[]): PartyMember[] {
  return members.filter((m) => !m.downed);
}

/**
 * Enemy health, scaled for how many are fighting.
 *
 * Four players at four times the damage would delete a wave designed for
 * one. But scaling linearly makes co-op feel like the same fight taking
 * four times as long, which is worse — so this is deliberately sublinear:
 * more players still means faster, just not four times faster.
 */
export function partyHpScale(playerCount: number): number {
  const n = Math.max(1, Math.floor(playerCount));
  return 1 + (n - 1) * 0.6;
}

/**
 * Who an enemy should go for.
 *
 * The nearest STANDING player, because an enemy that keeps attacking a
 * downed body is an enemy that has stopped playing the game — and it makes
 * rescuing someone impossible for exactly as long as it matters.
 */
export function pickTarget(
  from: { x: number; y: number },
  members: readonly PartyMember[],
): PartyMember | null {
  let best: PartyMember | null = null;
  let bestD = Infinity;
  for (const m of standing(members)) {
    const d = Math.hypot(m.x - from.x, m.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/**
 * How far right the party may walk.
 *
 * The camera holds the group together, so the gate has to be a wall for
 * everyone at once — including whoever is still poking around at the back.
 * Using the FURTHEST player would drag stragglers along; using the nearest
 * would let one player hold the whole party still. The gate limit is simply
 * the gate.
 */
export function partyLimit(gateX: number): number {
  return gateX;
}

/** Where the camera should sit: the middle of everyone still standing, so
 *  nobody is off-screen while they still have a say in the fight. */
export function partyCenter(members: readonly PartyMember[]): { x: number; y: number } | null {
  const live = standing(members);
  const use = live.length ? live : members;
  if (!use.length) return null;
  const x = use.reduce((n, m) => n + m.x, 0) / use.length;
  const y = use.reduce((n, m) => n + m.y, 0) / use.length;
  return { x, y };
}

/**
 * A tether so the party cannot split across a whole stage.
 *
 * Beyond this, the one running ahead is stopped rather than dragged back —
 * being teleported is worse than being stopped, and stopping is legible.
 */
export const PARTY_TETHER = 900;

export function tetheredX(x: number, centerX: number): number {
  return Math.max(centerX - PARTY_TETHER, Math.min(centerX + PARTY_TETHER, x));
}
