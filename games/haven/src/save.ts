/**
 * 💾 Blobhaven's memory: who you are, what your world looks like, and who
 * your friends are. All of it lives HERE, on the device — the relay's
 * presence directory only ever sees the opaque friend code, never the
 * friends list itself. That is the deliberate no-backend design: the
 * friendship graph is yours, and losing the relay loses nothing.
 */

import { createSave } from '@interverse/core';

const store = createSave('haven');

/** One placed furnishing. Positions are world units around each room's
 *  own origin, so yard decor and house decor never collide. */
export interface DecorItem {
  id: string;
  item: string;
  room: 'yard' | 'house';
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
  decor: DecorItem[];
  friends: FriendEntry[];
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

const BLOB_COLORS = [0xe07a5f, 0xf2cc8f, 0x81b29a, 0x6fc3ff, 0xc77dff, 0xff6f91, 0xffc75f, 0x8affc1];

function isDecor(v: unknown): v is DecorItem {
  const d = v as DecorItem;
  return (
    !!v && typeof v === 'object' && typeof d.id === 'string' && typeof d.item === 'string' &&
    (d.room === 'yard' || d.room === 'house') && Number.isFinite(d.x) && Number.isFinite(d.z)
  );
}

export function loadProfile(): Profile {
  const raw = store.get<Partial<Profile>>('profile', {});
  const p: Profile = {
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 12)
        : `Blob${Math.floor(Math.random() * 90 + 10)}`,
    friendCode: typeof raw.friendCode === 'string' && raw.friendCode ? raw.friendCode : makeFriendCode(),
    color: typeof raw.color === 'number' ? raw.color : BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)]!,
    hat: typeof raw.hat === 'string' ? raw.hat : 'none',
    decor: Array.isArray(raw.decor) ? raw.decor.filter(isDecor).map((d) => ({ ...d, rot: Number(d.rot) || 0 })) : starterDecor(),
    friends: Array.isArray(raw.friends)
      ? raw.friends
          .filter((f): f is FriendEntry => !!f && typeof f === 'object' && typeof f.code === 'string' && !!f.code)
          .map((f) => ({ code: f.code, name: typeof f.name === 'string' ? f.name.slice(0, 12) : 'Friend' }))
      : [],
  };
  // First run mints the identity; write it back so the code never changes.
  if (raw.friendCode !== p.friendCode || !Array.isArray(raw.decor)) saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  store.set('profile', p);
}

/** Remember someone (dedup by code; a fresh name wins — people rename). */
export function addFriend(p: Profile, code: string, name: string): void {
  const clean = code.trim().toUpperCase();
  if (!clean || clean === p.friendCode) return;
  const existing = p.friends.find((f) => f.code === clean);
  if (existing) existing.name = name.slice(0, 12) || existing.name;
  else p.friends.push({ code: clean, name: name.slice(0, 12) || 'Friend' });
  saveProfile(p);
}

export function removeFriend(p: Profile, code: string): void {
  const i = p.friends.findIndex((f) => f.code === code);
  if (i >= 0) {
    p.friends.splice(i, 1);
    saveProfile(p);
  }
}

/** 👒 The wardrobe. Cosmetics are free in the demo — the point is having
 *  a look, not a grind. */
export const HATS: readonly { id: string; name: string }[] = [
  { id: 'none', name: 'Bare' },
  { id: 'sprout', name: 'Sprout' },
  { id: 'cap', name: 'Cap' },
  { id: 'sun', name: 'Sun Hat' },
  { id: 'crown', name: 'Crown' },
  { id: 'halo', name: 'Halo' },
];

export const COLORS: readonly number[] = BLOB_COLORS;
