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
  /** The cosmetic's angle vs the body's — the roll/cosmetic split. */
  hat: () => { hat: number; lean: number; wheel: number; children: number } | null;
  // -------------------------------------------------------------- result
  again: () => void;
  menu: () => void;
}

declare global {
  interface Window {
    __rush?: RushDebug;
  }
}
