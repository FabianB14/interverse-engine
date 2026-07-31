/**
 * 💾 What survives closing the tab.
 *
 * A runner's save is short: how far you have ever got, how many coins you
 * have, and which hats you own. That is the whole progression, and it is
 * also the whole reason to open the game again tomorrow.
 *
 * As everywhere in this engine, a corrupt or hand-edited file degrades to a
 * sensible new profile rather than throwing — losing a best distance is
 * annoying, but taking the title screen down with it is unforgivable.
 */

import { createSave } from '@interverse/engine';
import { HATS } from './hats.js';

const store = createSave('rush');

export interface Profile {
  /** Best run, in metres. */
  best: number;
  /** Coins in the pocket, spendable in the shop. */
  coins: number;
  /** Total metres ever run — the number that never goes down. */
  lifetime: number;
  runs: number;
  owned: string[];
  wearing: string;
}

export const NEW_PROFILE: Profile = {
  best: 0,
  coins: 0,
  lifetime: 0,
  runs: 0,
  owned: ['none'],
  wearing: 'none',
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function loadProfile(): Profile {
  const raw = store.get<Partial<Profile>>('profile', {});
  const ids = new Set(HATS.map((h) => h.id));
  // Filter against the catalogue: a hat id that no longer exists must not
  // become an un-equippable ghost in the shop.
  const owned = Array.isArray(raw.owned) ? raw.owned.filter((id) => ids.has(String(id))) : [];
  if (!owned.includes('none')) owned.unshift('none');
  const wearing = typeof raw.wearing === 'string' && owned.includes(raw.wearing) ? raw.wearing : 'none';
  return {
    best: num(raw.best),
    coins: num(raw.coins),
    lifetime: num(raw.lifetime),
    runs: num(raw.runs),
    owned,
    wearing,
  };
}

export function saveProfile(p: Profile): void {
  store.set('profile', p);
}

export function clearProfile(): void {
  store.set('profile', NEW_PROFILE);
}

/** Bank a finished run. Returns the updated profile and whether it was a
 *  personal best, because "NEW BEST" is the result screen's whole job. */
export function bankRun(p: Profile, metres: number, coins: number): { profile: Profile; best: boolean } {
  const m = Math.max(0, Math.floor(metres));
  const best = m > p.best;
  return {
    profile: {
      ...p,
      best: Math.max(p.best, m),
      coins: p.coins + Math.max(0, Math.floor(coins)),
      lifetime: p.lifetime + m,
      runs: p.runs + 1,
    },
    best,
  };
}

export function canAfford(p: Profile, hatId: string): boolean {
  const h = HATS.find((x) => x.id === hatId);
  return !!h && !p.owned.includes(hatId) && p.coins >= h.price;
}

/** Buy and immediately wear it. Nobody buys a hat to leave it in a drawer. */
export function buyHat(p: Profile, hatId: string): Profile {
  if (!canAfford(p, hatId)) return p;
  const h = HATS.find((x) => x.id === hatId)!;
  return { ...p, coins: p.coins - h.price, owned: [...p.owned, hatId], wearing: hatId };
}

export function wearHat(p: Profile, hatId: string): Profile {
  return p.owned.includes(hatId) ? { ...p, wearing: hatId } : p;
}
