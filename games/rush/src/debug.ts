/** Headless-playtest hooks (window.__rush) — the playtest drives the game
 *  through these instead of swiping at a canvas. */
import type { SwipeDir } from '@interverse/engine';
import type { Profile } from './save.js';

export interface RunState {
  metres: number;
  coins: number;
  lane: number;
  airborne: boolean;
  sliding: boolean;
  hazards: number;
  /** 0 = clear, 1 = caught. */
  chase: number;
  turnZ: number;
  zone: string;
  speed: number;
  over: boolean;
  /** Body rotation in radians — proof the blob is rolling. */
  spin: number;
  /** How hard the road is currently curving, and which way. */
  bend: number;
  /** Camera yaw in radians. Reaches ∓π/2 as a corner is rounded. */
  yaw: number;
  /** True once the corner has been committed to and the camera is coming
   *  round; false again the moment it is behind you. */
  turning: boolean;
}

export interface RushDebug {
  ready: () => boolean;
  screen: () => 'boot' | 'menu' | 'run' | 'result';
  profile: () => Profile;
  setProfile: (patch: Partial<Profile>) => void;
  // ---------------------------------------------------------------- menu
  hats: () => { id: string; price: number; owned: boolean }[];
  pickHat: (id: string) => void;
  buy: () => void;
  picked: () => string;
  play: () => void;
  // ----------------------------------------------------------------- run
  run: () => RunState | null;
  swipe: (dir: SwipeDir) => void;
  /** Bring the next corner into the turn window without running to it. */
  corner: () => number;
  /** Survive stumbles and pits so a test can reach the slower mechanics.
   *  A missed corner still ends the run. */
  safe: (on: boolean) => void;
  /** The cosmetic's angle vs the body's — the roll/cosmetic split. */
  hat: () => { hat: number; lean: number; wheel: number; children: number } | null;
  /** What is on the road, and how far the nearest of it is from the corner.
   *  -1 for either distance means nothing is in view. */
  track: () => {
    count: number;
    nearest: number;
    /** Obstacles standing inside the corner keep-clear span. Always 0. */
    inSpan: number;
    cornerGap: number;
    cornerSecs: number;
  } | null;
  // -------------------------------------------------------------- result
  again: () => void;
  menu: () => void;
}

declare global {
  interface Window {
    __rush?: RushDebug;
  }
}
