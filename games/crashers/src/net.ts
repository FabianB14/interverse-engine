/**
 * 📡 What the four machines say to each other.
 *
 * The split follows the rules in the engine's coop module: the host owns the
 * enemies, each player owns their own body. So the wire has exactly two
 * shapes going up (here is where I am, here is a hit I claim) and one coming
 * down (here is the world).
 *
 * Everything is sent as plain JSON through the relay, which never inspects
 * it. Keeping the messages small matters more than keeping them pretty —
 * a snapshot goes out ten times a second to every phone in the room.
 */

import type { PartyMember } from '@interverse/engine';

// ------------------------------------------------------------- lobby

/** Host → all: the roster, whenever it changes. */
export interface RosterMsg {
  type: 'roster';
  /** Player ids in a stable order — slot order decides duplicate-class tint. */
  order: string[];
  names: Record<string, string>;
  classes: Record<string, string>;
  stage: number;
}

/** Joiner → host: my class pick. */
export interface PickMsg {
  type: 'pick';
  classId: string;
}

/** Host → all: everyone into the fight, now. */
export interface StartMsg {
  type: 'start';
  stage: number;
}

/** Joiner → host, on arrival: I am here and already in a scene. Lets a late
 *  joiner be told the fight is in progress instead of waiting on a lobby
 *  that has already emptied. */
export interface HelloMsg {
  type: 'hello';
}

/** Host → one joiner: there is a fight running, come to it. */
export interface InProgressMsg {
  type: 'inprogress';
  stage: number;
}

// -------------------------------------------------------------- fight

/** Player → host: my body, as I decided it. Sent for the host too (locally),
 *  so both paths write the same party table. */
export interface BodyMsg {
  type: 'body';
  x: number;
  y: number;
  z: number;
  dir: number;
  hearts: number;
  heartsMax: number;
  downed: boolean;
}

/**
 * Joiner → host: I swung and I believe I connected.
 *
 * A *request*, not a result: the host owns enemy health, so it re-checks the
 * claim against its own positions. Sending the swing rather than the damage
 * is what stops a modified client from deleting a boss.
 */
export interface HitMsg {
  type: 'hit';
  x: number;
  y: number;
  dir: number;
  reach: number;
  damage: number;
  launch: boolean;
}

/** One enemy, as everyone else needs to see it. Short keys because this goes
 *  out ten times a second times four phones. */
export interface FoeSnap {
  /** Instance id, stable for the life of the enemy. */
  i: number;
  /** Foe archetype id, so joiners can build the right body once. */
  k: string;
  x: number;
  y: number;
  z: number;
  d: number;
  /** Health as a fraction, 0–1 — joiners draw a bar, they never do damage. */
  h: number;
  /** Telegraph progress 0–1, or -1 for "not winding up". */
  t: number;
}

export interface ShotSnap {
  i: number;
  x: number;
  y: number;
  c: number;
}

/** Host → all, 10Hz: the whole world a joiner cannot decide for itself. */
export interface SnapMsg {
  type: 'snap';
  foes: FoeSnap[];
  shots: ShotSnap[];
  /** Party bodies as the host last heard them, so everyone sees everyone. */
  party: PartyMember[];
  /** How far right anyone may walk — the gate, shared by all. */
  limitX: number;
  /** Wave banner to show, once. */
  banner?: string;
}

/** Host → all: the stage ended. */
export interface EndMsg {
  type: 'end';
  won: boolean;
  xp: number;
  coins: number;
}

export type UpMsg = PickMsg | BodyMsg | HitMsg | HelloMsg;
export type DownMsg = RosterMsg | StartMsg | SnapMsg | EndMsg | InProgressMsg;
export type AnyMsg = UpMsg | DownMsg;

/** Narrow an unknown relay payload. Anything unrecognised is dropped rather
 *  than trusted — the relay forwards bytes, it does not vouch for them. */
export function asMsg(data: unknown): AnyMsg | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { type?: unknown }).type;
  return typeof t === 'string' ? (data as AnyMsg) : null;
}

/** How often bodies and snapshots go out. Ten a second is enough for a
 *  brawler — the gaps are covered by each machine simulating between them,
 *  and doubling the rate mostly doubles the phone bill. */
export const BODY_HZ = 12;
export const SNAP_HZ = 10;
