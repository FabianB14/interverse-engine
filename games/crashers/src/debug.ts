/** Headless-playtest hooks (window.__crashers) — the playtest drives the
 *  game through these instead of clicking screens. */
import type { PartyMember } from '@interverse/engine';
import type { Run } from './save.js';

export interface FightState {
  hearts: number;
  foes: number;
  limitX: number;
  heroX: number;
  done: boolean;
  downed: boolean;
  /** How many players this machine believes are in the fight. */
  party: number;
  /** Whether this machine is the one simulating the world. */
  host: boolean;
  revive: number;
}

export interface CrashersDebug {
  ready: () => boolean;
  screen: () => 'boot' | 'menu' | 'map' | 'fight' | 'result' | 'lobby' | 'join';
  stageCount: () => number;
  pickClass: (i: number) => void;
  pickedClass: () => string;
  start: () => void;
  unlocked: () => number[];
  play: (n: number) => void;
  fight: () => FightState | null;
  move: (x: number, y: number) => void;
  swing: () => void;
  clearWave: () => void;
  next: () => void;
  run: () => Run;
  setRun: (patch: Partial<Run>) => void;

  // -------------------------------------------------------------- co-op
  /** Open a room and land in the lobby as its host. */
  hostRoom: () => void;
  /** Go to the join screen (if not already there) and type a code. */
  joinRoom: (code: string) => void;
  roomCode: () => string;
  lobby: () => { id: string; name: string; classId: string }[];
  lobbyStart: () => void;
  party: () => PartyMember[];
  goDown: () => void;
}

declare global {
  interface Window {
    __crashers?: CrashersDebug;
  }
}
