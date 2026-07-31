/** Headless-playtest hooks (window.__crashers) — the playtest drives the
 *  game through these instead of clicking screens. */
import type { Run } from './save.js';

export interface CrashersDebug {
  ready: () => boolean;
  screen: () => 'boot' | 'menu' | 'map' | 'fight' | 'result';
  stageCount: () => number;
  pickClass: (i: number) => void;
  pickedClass: () => string;
  start: () => void;
  unlocked: () => number[];
  play: (n: number) => void;
  fight: () => { hearts: number; foes: number; limitX: number; heroX: number; done: boolean } | null;
  move: (x: number, y: number) => void;
  swing: () => void;
  clearWave: () => void;
  next: () => void;
  run: () => Run;
  setRun: (patch: Partial<Run>) => void;
}

declare global {
  interface Window {
    __crashers?: CrashersDebug;
  }
}
