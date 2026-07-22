import { store } from './store.js';

/**
 * The harvest basket — crop id -> count. Persisted so it survives travelling
 * between the farm and the market (separate scenes).
 */
export function invAll(): Record<string, number> {
  return store.get<Record<string, number>>('inventory', {});
}

export function invCount(id: string): number {
  return invAll()[id] ?? 0;
}

export function invTotal(): number {
  return Object.values(invAll()).reduce((a, b) => a + b, 0);
}

export function invClear(): void {
  store.set('inventory', {});
}

export function invAdd(id: string, n = 1): void {
  const inv = invAll();
  inv[id] = (inv[id] ?? 0) + n;
  store.set('inventory', inv);
}

/** Remove `n` of `id`; returns false (unchanged) if there aren't enough. */
export function invRemove(id: string, n: number): boolean {
  const inv = invAll();
  const cur = inv[id] ?? 0;
  if (cur < n) return false;
  const left = cur - n;
  if (left <= 0) delete inv[id];
  else inv[id] = left;
  store.set('inventory', inv);
  return true;
}
