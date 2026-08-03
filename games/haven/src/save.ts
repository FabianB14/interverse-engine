/**
 * 💾 Blobhaven's memory: who you are, what your world looks like, what you
 * OWN, and who your friends are. All of it lives HERE, on the device —
 * the relay's presence directory only ever sees the opaque friend code,
 * never the friends list itself. That is the deliberate no-backend
 * design: the friendship graph is yours, and losing the relay loses
 * nothing. (The ⬡ Verium balance is NOT here — it is the shared
 * cross-game wallet in @interverse/core.)
 */

import { createSave } from '@interverse/core';
import { BASE_COLORS } from './store.js';
import type { HouseSizeId } from './store.js';

const store = createSave('haven');

/** One placed furnishing. Positions are world units around each room's
 *  own origin, so yard, house and loft decor never collide. */
export interface DecorItem {
  id: string;
  item: string;
  room: 'yard' | 'house' | 'loft';
  x: number;
  z: number;
  rot: number;
}

export interface FriendEntry {
  code: string;
  name: string;
}

export interface Profile {
  name: string;
  /** Opaque, machine-made, shareable — the whole identity system. */
  friendCode: string;
  color: number;
  hat: string;
  houseSize: HouseSizeId;
  houseTheme: string;
  decor: DecorItem[];
  friends: FriendEntry[];
  /** Bought-once ownership. Price-0 store rows are owned implicitly. */
  ownedHats: string[];
  ownedColors: number[];
  ownedFurniture: string[];
  ownedHouses: HouseSizeId[];
  ownedThemes: string[];
  /** Earning bookkeeping: the welcome grant and the daily gift day. */
  welcomed: boolean;
  lastDaily: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeFriendCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (i === 3) out += '-';
  }
  return out;
}

let decorSeq = 0;
export function freshDecorId(): string {
  return `d${Date.now().toString(36)}${(decorSeq++).toString(36)}`;
}

/** The starter world: a lived-in corner, not an empty void. */
function starterDecor(): DecorItem[] {
  return [
    { id: freshDecorId(), item: 'lamp', room: 'yard', x: 240, z: 260, rot: 0 },
    { id: freshDecorId(), item: 'flower', room: 'yard', x: -300, z: 180, rot: 0.6 },
    { id: freshDecorId(), item: 'plant', room: 'house', x: -360, z: -220, rot: 0 },
    { id: freshDecorId(), item: 'rug', room: 'house', x: 0, z: 0, rot: 0 },
  ];
}

function isDecor(v: unknown): v is DecorItem {
  const d = v as DecorItem;
  return (
    !!v && typeof v === 'object' && typeof d.id === 'string' && typeof d.item === 'string' &&
    (d.room === 'yard' || d.room === 'house' || d.room === 'loft') &&
    Number.isFinite(d.x) && Number.isFinite(d.z)
  );
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function loadProfile(): Profile {
  const raw = store.get<Partial<Profile>>('profile', {});
  const p: Profile = {
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 12)
        : `Blob${Math.floor(Math.random() * 90 + 10)}`,
    friendCode: typeof raw.friendCode === 'string' && raw.friendCode ? raw.friendCode : makeFriendCode(),
    color: typeof raw.color === 'number' ? raw.color : BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)]!,
    hat: typeof raw.hat === 'string' ? raw.hat : 'none',
    houseSize: raw.houseSize === 'grand' || raw.houseSize === 'manor' ? raw.houseSize : 'cozy',
    houseTheme: typeof raw.houseTheme === 'string' && raw.houseTheme ? raw.houseTheme : 'meadow',
    decor: Array.isArray(raw.decor) ? raw.decor.filter(isDecor).map((d) => ({ ...d, rot: Number(d.rot) || 0 })) : starterDecor(),
    friends: Array.isArray(raw.friends)
      ? raw.friends
          .filter((f): f is FriendEntry => !!f && typeof f === 'object' && typeof f.code === 'string' && !!f.code)
          .map((f) => ({ code: f.code, name: typeof f.name === 'string' ? f.name.slice(0, 12) : 'Friend' }))
      : [],
    ownedHats: strList(raw.ownedHats),
    ownedColors: Array.isArray(raw.ownedColors)
      ? raw.ownedColors.filter((c): c is number => typeof c === 'number')
      : [],
    ownedFurniture: strList(raw.ownedFurniture),
    ownedHouses: strList(raw.ownedHouses).filter(
      (h): h is HouseSizeId => h === 'cozy' || h === 'grand' || h === 'manor',
    ),
    ownedThemes: strList(raw.ownedThemes),
    welcomed: raw.welcomed === true,
    lastDaily: typeof raw.lastDaily === 'string' ? raw.lastDaily : '',
  };
  // First run mints the identity; write it back so the code never changes.
  if (raw.friendCode !== p.friendCode || !Array.isArray(raw.decor)) saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  store.set('profile', p);
}

/** Remember someone (dedup by code; a fresh name wins — people rename).
 *  Returns true when this was a NEW friendship. */
export function addFriend(p: Profile, code: string, name: string): boolean {
  const clean = code.trim().toUpperCase();
  if (!clean || clean === p.friendCode) return false;
  const existing = p.friends.find((f) => f.code === clean);
  if (existing) {
    existing.name = name.slice(0, 12) || existing.name;
    saveProfile(p);
    return false;
  }
  p.friends.push({ code: clean, name: name.slice(0, 12) || 'Friend' });
  saveProfile(p);
  return true;
}

export function removeFriend(p: Profile, code: string): void {
  const i = p.friends.findIndex((f) => f.code === code);
  if (i >= 0) {
    p.friends.splice(i, 1);
    saveProfile(p);
  }
}
