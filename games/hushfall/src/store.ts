import { createSave } from '@interverse/engine';

/** Local save: name, cosmetics, unlocks, last room, prefs. Verium is shared. */
export const store = createSave('hushfall', 1);

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

/** Chosen accessory index (cosmetic). */
export function savedAcc(): number {
  return store.get<number>('acc', 0);
}

/** Preferred class per role — remembered between matches. */
export function savedClass(role: 'seeker' | 'hider'): string {
  return store.get<string>(role === 'seeker' ? 'seekerClass' : 'hiderClass', role === 'seeker' ? 'stalker' : 'scout');
}

export function musicPref(): boolean {
  return store.get<boolean>('music', true);
}
export function setMusicPref(on: boolean): void {
  store.set('music', on);
}

// Rejoin support: remember the last room a joiner was in.
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
