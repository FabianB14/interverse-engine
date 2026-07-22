import { verium } from '@interverse/engine';
import { store } from './store.js';
import { invAdd } from './inventory.js';
import { CROPS } from './crops.js';

/** A fresh free gift box every minute — a steady, cozy trickle of Verium. */
export const GIFT_COOLDOWN_MS = 60_000;
export const WELCOME_VERIUM = 100;

/** One-time welcome so a new farmer can afford their first seeds. */
export function claimWelcome(): boolean {
  if (store.get<boolean>('welcomed', false)) return false;
  store.set('welcomed', true);
  verium.add(WELCOME_VERIUM);
  invAdd('carrot', 3);
  invAdd('radish', 2);
  return true;
}

export function giftReadyInMs(): number {
  const at = store.get<number>('giftAt', 0);
  return Math.max(0, at - Date.now());
}

export interface GiftReward {
  verium: number;
  crop: string;
}

/** Claim the recharging gift box: some Verium + a random free crop. */
export function claimGift(): GiftReward | null {
  if (giftReadyInMs() > 0) return null;
  const coins = 25;
  verium.add(coins);
  const crop = CROPS[Math.floor(Math.random() * Math.min(6, CROPS.length))] ?? CROPS[0]!;
  invAdd(crop.id, 1);
  store.set('giftAt', Date.now() + GIFT_COOLDOWN_MS);
  return { verium: coins, crop: crop.id };
}

/** Make the gift box ready now (used by tests). */
export function resetGift(): void {
  store.set('giftAt', 0);
}

// ---------------------------------------------------------------- bundle

/** A value bundle: pay a little Verium, get a basket of assorted produce. */
export const BUNDLE = { cost: 40, count: 8 };

export function buyBundle(): boolean {
  if (!verium.spend(BUNDLE.cost)) return false;
  const pool = CROPS.slice(0, 6); // common/uncommon starter produce
  for (let i = 0; i < BUNDLE.count; i++) {
    const c = pool[Math.floor(Math.random() * pool.length)] ?? CROPS[0]!;
    invAdd(c.id, 1);
  }
  return true;
}
