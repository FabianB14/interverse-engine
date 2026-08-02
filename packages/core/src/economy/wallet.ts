import { createSave } from '../save/save.js';

/**
 * Verium — the shared Interverse currency (§ economy). Backed by ONE save
 * namespace (`interverse:wallet`) so every game on the platform reads and
 * writes the same balance: earn it in one game, spend it in another.
 *
 * Balances are per-device (localStorage today; the Capacitor / account-synced
 * backing lands with the native shell). Values are clamped to a non-negative
 * integer.
 */
const wallet = createSave('wallet', 1);
const KEY = 'verium';

function read(): number {
  const n = wallet.get<number>(KEY, 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export const verium = {
  /** Current balance. */
  balance(): number {
    return read();
  },
  /** Grant `n` Verium (ignored if `n <= 0`). Returns the new balance. */
  add(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return read();
    const next = read() + Math.floor(n);
    wallet.set(KEY, next);
    return next;
  },
  /** Spend `n` Verium if affordable. Returns true on success. */
  spend(n: number): boolean {
    const cost = Math.floor(n);
    if (!Number.isFinite(cost) || cost < 0) return false;
    const bal = read();
    if (bal < cost) return false;
    wallet.set(KEY, bal - cost);
    return true;
  },
};
