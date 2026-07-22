import { store } from './store.js';
import { cleanName } from './store.js';

/** A saved friend — their display name and their farm room code. */
export interface Friend {
  name: string;
  code: string;
}

const FRIENDS_KEY = 'friends';

/** A 4-letter room code (relay alphabet), uppercased. */
export function cleanCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, '')
    .slice(0, 4);
}

export function friends(): Friend[] {
  return store.get<Friend[]>(FRIENDS_KEY, []);
}

/** Add or update a friend by code; returns false for invalid input. */
export function addFriend(name: string, code: string): boolean {
  const n = cleanName(name);
  const c = cleanCode(code);
  if (!n || c.length !== 4) return false;
  const list = friends().filter((f) => f.code !== c);
  list.push({ name: n, code: c });
  store.set(FRIENDS_KEY, list);
  return true;
}

export function removeFriend(code: string): void {
  store.set(
    FRIENDS_KEY,
    friends().filter((f) => f.code !== code),
  );
}
