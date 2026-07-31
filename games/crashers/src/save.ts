/**
 * 💾 The campaign file.
 *
 * Fifteen stages is long enough that nobody finishes in one sitting, so the
 * run has to survive closing the tab: which class, how far, how much XP, and
 * where the upgrade points went.
 *
 * The rule everywhere here is that a corrupt or hand-edited file must
 * degrade to a sensible new game rather than throw — a save is the one thing
 * a player cannot recreate, and taking the title screen down with it is the
 * worst possible failure.
 */

import { createSave, levelFromXp } from '@interverse/engine';
import type { Upgrades } from '@interverse/engine';
import { STAGES } from './levels.js';

const store = createSave('crashers');

export interface Run {
  classId: string;
  /** Highest stage cleared. 0 = nothing yet, so stage 1 is next. */
  cleared: number;
  xp: number;
  coins: number;
  upgrades: Upgrades;
}

export const NEW_RUN: Run = {
  classId: 'knight',
  cleared: 0,
  xp: 0,
  coins: 0,
  upgrades: { power: 0, speed: 0, hearts: 0 },
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadRun(): Run {
  const raw = store.get<unknown>('run', null);
  if (!raw || typeof raw !== 'object') return { ...NEW_RUN, upgrades: { ...NEW_RUN.upgrades } };
  const r = raw as Record<string, unknown>;
  const up = (r.upgrades ?? {}) as Record<string, unknown>;
  return {
    classId: typeof r.classId === 'string' ? r.classId : NEW_RUN.classId,
    // Clamped to the campaign that exists: a file claiming stage 99 must not
    // leave the player staring at a map with nothing playable on it.
    cleared: Math.max(0, Math.min(STAGES.length, Math.floor(num(r.cleared)))),
    xp: Math.max(0, num(r.xp)),
    coins: Math.max(0, num(r.coins)),
    upgrades: {
      power: Math.max(0, Math.floor(num(up.power))),
      speed: Math.max(0, Math.floor(num(up.speed))),
      hearts: Math.max(0, Math.floor(num(up.hearts))),
    },
  };
}

export function saveRun(run: Run): void {
  store.set('run', run);
}

export function clearRun(): void {
  store.remove('run');
}

/** Points earned but not yet spent. One per level, which keeps the upgrade
 *  screen a choice rather than a formality. */
export function unspentPoints(run: Run): number {
  const level = levelFromXp(run.xp);
  const spent = run.upgrades.power + run.upgrades.speed + run.upgrades.hearts;
  return Math.max(0, level - 1 - spent);
}

/** Which stages the player may start. Everything cleared, plus the next one
 *  — the same "you may replay anything you finished" rule the rest of the
 *  engine uses, so progression never surprises anyone. */
export function unlockedStages(run: Run): number[] {
  const top = Math.min(STAGES.length, run.cleared + 1);
  return STAGES.filter((s) => s.n <= top).map((s) => s.n);
}

export function isUnlocked(run: Run, n: number): boolean {
  return n <= run.cleared + 1 && n >= 1 && n <= STAGES.length;
}

/** Fold a finished stage into the run. Replaying an already-cleared stage
 *  still pays XP and coins — grinding for an upgrade is a legitimate way to
 *  get past a wall — but it cannot un-clear progress. */
export function completeStage(run: Run, n: number, xp: number, coins: number): Run {
  return {
    ...run,
    cleared: Math.max(run.cleared, n),
    xp: run.xp + Math.max(0, Math.round(xp)),
    coins: run.coins + Math.max(0, Math.round(coins)),
  };
}

export function spendPoint(run: Run, on: keyof Upgrades): Run {
  if (unspentPoints(run) <= 0) return run;
  return { ...run, upgrades: { ...run.upgrades, [on]: run.upgrades[on] + 1 } };
}
