import { createSave } from '@interverse/engine';

export const store = createSave('blobvale', 1);
export const NAME_KEY = 'name';

/** Kid-safe-ish: letters/digits/spaces only, trimmed, max 10. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 10);
}

export function savedName(): string | null {
  const n = store.get<string | null>(NAME_KEY, null);
  return n ? cleanName(n) || null : null;
}

// Remember the last room a joiner was in, so they can rejoin after being
// knocked out (a dropped connection, an accidental reload).
export const LAST_ROOM_KEY = 'lastRoom';

export function saveLastRoom(code: string): void {
  store.set(LAST_ROOM_KEY, code);
}

export function lastRoom(): string | null {
  return store.get<string | null>(LAST_ROOM_KEY, null);
}

export function clearLastRoom(): void {
  store.set(LAST_ROOM_KEY, null);
}
