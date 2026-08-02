/**
 * 💾 The SAME profile as 2D Blob Rush — one save, two renderers.
 *
 * Both games read the 'rush' store, so coins earned in either bank into
 * the same pocket and your best run is your best run, however it was
 * drawn. That is the point of the core/engine split made visible: the
 * profile is game state, and game state does not care who renders it.
 *
 * This module deliberately does NOT import the 2D game's save.ts — that
 * file pulls the Pixi hat catalogue in for shop validation, and the 3D
 * game has no shop (buy hats in the 2D game; wear them here). Reading
 * tolerantly and writing only fields we own keeps the two writers from
 * fighting.
 */

import { createSave } from '@interverse/core';

const store = createSave('rush');

export interface Profile {
  best: number;
  coins: number;
  lifetime: number;
  runs: number;
  owned: string[];
  wearing: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function loadProfile(): Profile {
  const raw = store.get<Partial<Profile>>('profile', {});
  const owned = Array.isArray(raw.owned) ? raw.owned.map(String) : ['none'];
  if (!owned.includes('none')) owned.unshift('none');
  return {
    best: num(raw.best),
    coins: num(raw.coins),
    lifetime: num(raw.lifetime),
    runs: num(raw.runs),
    owned,
    wearing: typeof raw.wearing === 'string' ? raw.wearing : 'none',
  };
}

/** The hat catalogue — MIRRORS games/rush/src/hats.ts ids and prices, so
 *  the two shops sell the same goods from the same purse. */
export const HATS: readonly { id: string; name: string; price: number }[] = [
  { id: 'none', name: 'Bare', price: 0 },
  { id: 'cap', name: 'Cap', price: 60 },
  { id: 'party', name: 'Party Cone', price: 150 },
  { id: 'horns', name: 'Horns', price: 260 },
  { id: 'crown', name: 'Crown', price: 420 },
  { id: 'top', name: 'Top Hat', price: 600 },
  { id: 'halo', name: 'Halo', price: 850 },
  { id: 'prop', name: 'Propeller', price: 1200 },
];

export function buyHat(id: string): void {
  const p = loadProfile();
  const h = HATS.find((x) => x.id === id);
  if (!h || p.owned.includes(id) || p.coins < h.price) return;
  store.set('profile', { ...p, coins: p.coins - h.price, owned: [...p.owned, id], wearing: id });
}

export function wearHat(id: string): void {
  const p = loadProfile();
  if (p.owned.includes(id)) store.set('profile', { ...p, wearing: id });
}

export function bankRun(metres: number, coins: number): { profile: Profile; newBest: boolean } {
  const p = loadProfile();
  const m = Math.max(0, Math.floor(metres));
  const newBest = m > p.best;
  const profile: Profile = {
    ...p,
    best: Math.max(p.best, m),
    coins: p.coins + Math.max(0, Math.floor(coins)),
    lifetime: p.lifetime + m,
    runs: p.runs + 1,
  };
  store.set('profile', profile);
  return { profile, newBest };
}
