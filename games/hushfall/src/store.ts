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

/** Class XP: playing a class levels it, and levels gate its passives. */
export function classXp(clsId: string): number {
  return store.get<Record<string, number>>('classXp', {})[clsId] ?? 0;
}
export function addClassXp(clsId: string, n: number): number {
  const all = store.get<Record<string, number>>('classXp', {});
  all[clsId] = (all[clsId] ?? 0) + n;
  store.set('classXp', all);
  return all[clsId];
}

/** Passive upgrades bought with Verium (upgrade ids, across all classes). */
export function ownedUpgrades(): string[] {
  return store.get<string[]>('upgrades', []);
}
export function addUpgrade(id: string): void {
  const owned = ownedUpgrades();
  if (!owned.includes(id)) store.set('upgrades', [...owned, id]);
}

/** Preferred class per role — remembered between matches. */
export function savedClass(role: 'seeker' | 'hider'): string {
  return store.get<string>(
    role === 'seeker' ? 'seekerClass' : 'hiderClass',
    role === 'seeker' ? 'stalker' : 'scout',
  );
}

export function musicPref(): boolean {
  return store.get<boolean>('music', true);
}
export function setMusicPref(on: boolean): void {
  store.set('music', on);
}

/** Sound effects (stingers) — separate from the ambient music bed. */
export function sfxPref(): boolean {
  return store.get<boolean>('sfx', true);
}
export function setSfxPref(on: boolean): void {
  store.set('sfx', on);
}

/** Proximity voice chat. OFF by default (kid-safe, spec §8.6) — voice only
 *  ever starts when THIS device opted in, and it asks for the mic then. */
export function voicePref(): boolean {
  return store.get<boolean>('voice', false);
}
export function setVoicePref(on: boolean): void {
  store.set('voice', on);
}

/** Show the in-match screen-record button (hidden by default). */
export function recordPref(): boolean {
  return store.get<boolean>('record', false);
}
export function setRecordPref(on: boolean): void {
  store.set('record', on);
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
