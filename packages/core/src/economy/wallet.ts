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
const SEQ_KEY = 'veriumSeq';

function read(): number {
  const n = wallet.get<number>(KEY, 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function readSeq(): number {
  const n = wallet.get<number>(SEQ_KEY, 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Every mutation bumps a sequence number, so a remote mirror (the relay's
 *  wallet vault) can be reconciled: higher seq wins, and a wiped mirror
 *  (seq 0) can never clobber a device's real balance. */
function write(balance: number): void {
  wallet.set(KEY, balance);
  wallet.set(SEQ_KEY, readSeq() + 1);
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
    write(next);
    return next;
  },
  /** Spend `n` Verium if affordable. Returns true on success. */
  spend(n: number): boolean {
    const cost = Math.floor(n);
    if (!Number.isFinite(cost) || cost < 0) return false;
    const bal = read();
    if (bal < cost) return false;
    write(bal - cost);
    return true;
  },
  /** Snapshot for mirroring: the balance and its mutation counter. */
  state(): { balance: number; seq: number } {
    return { balance: read(), seq: readSeq() };
  },
  /** Adopt a mirrored state — only if it is NEWER than what this device
   *  has seen. Returns true when adopted. */
  adopt(balance: number, seq: number): boolean {
    if (!Number.isFinite(seq) || Math.floor(seq) <= readSeq()) return false;
    const b = Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0;
    wallet.set(KEY, b);
    wallet.set(SEQ_KEY, Math.floor(seq));
    return true;
  },
};
