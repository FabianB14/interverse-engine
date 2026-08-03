/**
 * 🏡 Blobhaven — the cozy social hub (spec §2: party/cozy first).
 *
 * Every player owns a WORLD: a big island meadow and a house you can walk
 * into and decorate — now in three sizes (the manor has a real upstairs)
 * and five themes, all bought with ⬡ Verium, the SHARED Interverse
 * wallet (@interverse/core): the same balance Bloomstead pays out, spent
 * here on hats, coats, furniture and houses. Earning here is cozy too —
 * a welcome gift, a daily gift, and a little ⬡ for every new friend.
 *
 * Identity is an opaque friend code (no accounts, no PII — spec §8.6);
 * the friends LIST lives in the local save, and the relay's in-memory
 * presence directory only answers "is this code online right now, and
 * what room do I knock on?" Losing the relay loses nothing.
 *
 * Cameras: PlayerCam third person by default, 📷 toggles first person.
 * Left half of the screen is the walk stick, right half is the look
 * stick, exactly like every mobile 3D game.
 */

import { Fog, Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import {
  PlayerCam, autoQuality, createGame3, lightRig, skyDome,
} from '@interverse/three';
import type { Game3 } from '@interverse/three';
import { audio, verium } from '@interverse/core';
import { host, join } from '@interverse/net';
import type { Session } from '@interverse/net';
import {
  CATALOGUE, blobAvatar, buildItem, houseExterior, houseInterior, islandView, loftInterior,
  modelAvatar, modelStats, pathView, pondView, rockCluster, yardTrees,
} from './art.js';
import type { Avatar, HouseSpec } from './art.js';
import { addFriend, freshDecorId, loadProfile, removeFriend, saveProfile } from './save.js';
import type { DecorItem, Profile } from './save.js';
import {
  AVATAR_STORE, BASE_COLORS, FURNITURE_STORE, HAT_STORE, HOUSE_SIZES, HOUSE_STORE, MODEL_DECOR,
  PETS, PREMIUM_COLORS, REDEEM_CODES, THEME_STORE, themeById,
} from './store.js';
import { modelThumb } from './thumbs.js';
import type { HouseSizeId } from './store.js';
import { GAME_TAG, presenceUrl, resolveRelayUrl } from './config.js';

// ------------------------------------------------------------ constants

/** 10× the original island's AREA: r 1150 → 3650. */
const YARD_R = 3650;
const HOUSE_Z = -620;
const SPEED = 430;
const POS_HZ_MS = 100;
const WELCOME_VRM = 200;
const DAILY_VRM = 60;
const FRIEND_VRM = 25;

type Room = 'yard' | 'house' | 'loft';

const params = new URLSearchParams(location.search);
if (params.get('fresh')) localStorage.removeItem('interverse:haven');

const profile: Profile = loadProfile();
if (params.get('name')) {
  profile.name = params.get('name')!.slice(0, 12);
  saveProfile(profile);
}

// 🎁 The welcome gift: enough ⬡ for a first hat and a campfire.
if (!profile.welcomed) {
  profile.welcomed = true;
  verium.add(WELCOME_VRM);
  saveProfile(profile);
}

// --------------------------------------------------------- ownership

const ownsHat = (id: string): boolean =>
  (HAT_STORE.find((h) => h.id === id)?.price ?? 1) === 0 || profile.ownedHats.includes(id);
const ownsColor = (c: number): boolean =>
  BASE_COLORS.includes(c) || profile.ownedColors.includes(c);
const ownsFurniture = (id: string): boolean =>
  !FURNITURE_STORE.some((f) => f.id === id) || profile.ownedFurniture.includes(id);
const ownsHouse = (id: HouseSizeId): boolean =>
  id === 'cozy' || profile.ownedHouses.includes(id);
const ownsTheme = (id: string): boolean =>
  (THEME_STORE.find((t) => t.id === id)?.price ?? 1) === 0 || profile.ownedThemes.includes(id);
const ownsAvatar = (id: string): boolean =>
  (AVATAR_STORE.find((a) => a.id === id)?.price ?? 1) === 0 || profile.ownedAvatars.includes(id);

type BuyKind = 'hat' | 'color' | 'furniture' | 'house' | 'theme' | 'avatar';

/** Spend ⬡, record ownership, equip/apply immediately. */
function buy(kind: BuyKind, id: string | number): boolean {
  const fail = (msg: string): false => {
    toast(msg);
    return false;
  };
  if (kind === 'hat') {
    const row = HAT_STORE.find((h) => h.id === id);
    if (!row) return false;
    if (!ownsHat(row.id)) {
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedHats.push(row.id);
    }
    profile.hat = row.id;
    me.setHat(row.id);
  } else if (kind === 'color') {
    const c = Number(id);
    const row = PREMIUM_COLORS.find((p) => p.color === c);
    if (!ownsColor(c)) {
      if (!row) return false;
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedColors.push(c);
    }
    profile.color = c;
    me.setColor(c);
  } else if (kind === 'furniture') {
    const row = FURNITURE_STORE.find((f) => f.id === id);
    if (!row) return false;
    if (!ownsFurniture(row.id)) {
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedFurniture.push(row.id);
    }
  } else if (kind === 'house') {
    const row = HOUSE_STORE.find((h) => h.id === id);
    if (!row) return false;
    const sizeId = row.id as HouseSizeId;
    if (!ownsHouse(sizeId)) {
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedHouses.push(sizeId);
    }
    profile.houseSize = sizeId;
    if (!visiting) {
      if (room !== 'yard') exitToYard();
      rebuildWorld();
    }
  } else if (kind === 'avatar') {
    const row = AVATAR_STORE.find((a) => a.id === id);
    if (!row) return false;
    if (!ownsAvatar(row.id)) {
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedAvatars.push(row.id);
    }
    profile.avatar = row.id;
    setMyAvatar(row.id);
  } else {
    const row = THEME_STORE.find((t) => t.id === id);
    if (!row) return false;
    if (!ownsTheme(row.id)) {
      if (!verium.spend(row.price)) return fail(`need ⬡${row.price}`);
      profile.ownedThemes.push(row.id);
    }
    profile.houseTheme = row.id;
    if (!visiting) rebuildWorld();
  }
  saveProfile(profile);
  sendLook();
  sendHouse();
  audio.chime();
  updateHud();
  return true;
}

// ------------------------------------------------------------- three.js

const game: Game3 = createGame3({
  background: 0xc9a37c,
  fov: 55,
  update: (dt) => update(dt),
});
autoQuality(game);
const rig = lightRig(game.scene, { intensity: 1.15, shadowArea: 1600 });
rig.hemi.intensity = 0.65;
game.scene.fog = new Fog(0xc9a37c, 2400, 8600);
game.scene.add(skyDome({ horizon: 0xd8a878, zenith: 0x5a7a9a }));

const playerCam = new PlayerCam({
  dom: document.getElementById('look')!,
  mode: 'third',
  distance: 470,
  eyeHeight: 96,
});
playerCam.yaw = 0; // spawn vista: the path leading up to YOUR house

// ------------------------------------------------------- world building

const worldRoot = new Group();
game.scene.add(worldRoot);
let yardGroup = new Group();
let houseGroup = new Group();
let loftGroup = new Group();
/** Placed decor views by id, for tap-to-remove. */
const decorViews = new Map<string, { group: Group; item: string }>();

/** What decor the CURRENT world shows: mine at home, the host's while
 *  visiting. Mutating this while at home mutates the save's array. */
let worldDecor: DecorItem[] = profile.decor;
let visiting: { hostName: string; hostCode: string } | null = null;
/** Whose house shape/theme the world wears right now. */
let worldHouse: { size: HouseSizeId; theme: string } = {
  size: profile.houseSize,
  theme: profile.houseTheme,
};

function houseSpec(): HouseSpec {
  const dims = HOUSE_SIZES[worldHouse.size];
  return { x: 0, z: HOUSE_Z, w: dims.w, d: dims.d, doorW: dims.doorW, stories: dims.stories };
}

function rebuildWorld(): void {
  if (!visiting) worldHouse = { size: profile.houseSize, theme: profile.houseTheme };
  const spec = houseSpec();
  const dims = HOUSE_SIZES[worldHouse.size];
  const theme = themeById(worldHouse.theme);
  worldRoot.remove(yardGroup, houseGroup, loftGroup);
  decorViews.clear();
  yardGroup = new Group();
  yardGroup.add(islandView(YARD_R));
  yardGroup.add(pathView(360, HOUSE_Z + spec.d / 2 + 90));
  yardGroup.add(
    yardTrees(YARD_R, [
      { x: 0, z: HOUSE_Z, r: dims.w + 400 },
      { x: 0, z: 200, r: 700 },
      { x: 1500, z: 1100, r: 520 },
    ]),
  );
  yardGroup.add(pondView(1500, 1100, 340));
  yardGroup.add(rockCluster(-1700, -400, 71));
  yardGroup.add(rockCluster(900, -1900, 83));
  yardGroup.add(rockCluster(-800, 2100, 97));
  yardGroup.add(houseExterior(spec, theme));
  houseGroup = new Group();
  houseGroup.add(houseInterior(dims.halfW, dims.halfD, dims.doorW, theme, { stairs: dims.stories > 1 }));
  loftGroup = new Group();
  if (dims.stories > 1) loftGroup.add(loftInterior(dims.halfW - 80, dims.halfD - 80, theme));
  let seed = 5;
  for (const d of worldDecor) {
    const view = buildItem(d.item, seed++);
    if (!view) continue;
    view.position.set(d.x, 0, d.z);
    view.rotation.y = d.rot;
    (d.room === 'yard' ? yardGroup : d.room === 'loft' ? loftGroup : houseGroup).add(view);
    decorViews.set(d.id, { group: view, item: d.item });
  }
  worldRoot.add(yardGroup, houseGroup, loftGroup);
  initPets();
  applyRoom();
}

/**
 * 🐾 Pets: model decor that LIVES. The uploaded files carry no rigs, so
 * the whole body animates — wander a patch around where they were
 * placed, hop while walking, and throw in a real jump now and then.
 */
interface PetState {
  home: { x: number; z: number };
  tx: number;
  tz: number;
  pause: number;
  jump: number;
  phase: number;
  room: Room;
}
const petStates = new Map<string, PetState>();

function initPets(): void {
  petStates.clear();
  for (const d of worldDecor) {
    if (!PETS.has(d.item)) continue;
    petStates.set(d.id, {
      home: { x: d.x, z: d.z },
      tx: d.x,
      tz: d.z,
      pause: Math.random() * 2,
      jump: 3 + Math.random() * 5,
      phase: Math.random() * 6,
      room: d.room,
    });
  }
}

function tickPets(dt: number): void {
  const dims = HOUSE_SIZES[worldHouse.size];
  for (const [id, pet] of petStates) {
    const view = decorViews.get(id)?.group;
    if (!view) continue;
    const dx = pet.tx - view.position.x;
    const dz = pet.tz - view.position.z;
    const dist = Math.hypot(dx, dz);
    let walking = false;
    if (pet.pause > 0) {
      pet.pause -= dt;
    } else if (dist > 12) {
      walking = true;
      view.position.x += (dx / dist) * 105 * dt;
      view.position.z += (dz / dist) * 105 * dt;
      view.rotation.y = Math.atan2(dx, dz);
    } else {
      // Arrived: sniff around a moment, then pick a new spot near home.
      pet.pause = 0.8 + Math.random() * 2.4;
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 220;
      let nx = pet.home.x + Math.cos(a) * r;
      let nz = pet.home.z + Math.sin(a) * r;
      if (pet.room === 'yard') {
        const rr = Math.hypot(nx, nz);
        if (rr > YARD_R - 140) {
          nx *= (YARD_R - 140) / rr;
          nz *= (YARD_R - 140) / rr;
        }
      } else {
        const bw = (pet.room === 'loft' ? dims.halfW - 80 : dims.halfW) - 100;
        const bd = (pet.room === 'loft' ? dims.halfD - 80 : dims.halfD) - 100;
        nx = Math.max(-bw, Math.min(bw, nx));
        nz = Math.max(-bd, Math.min(bd, nz));
      }
      pet.tx = nx;
      pet.tz = nz;
    }
    // The gait: quick hops while walking, an occasional REAL jump.
    pet.jump -= dt;
    let y = walking ? Math.abs(Math.sin(t * 7 + pet.phase)) * 10 : 0;
    if (pet.jump < 0.6 && pet.jump > 0) {
      y += Math.sin(((0.6 - pet.jump) / 0.6) * Math.PI) * 55;
    } else if (pet.jump <= 0) {
      pet.jump = 4 + Math.random() * 6;
    }
    view.position.y = y;
    // A happy lean into the hop.
    view.rotation.z = walking ? Math.sin(t * 7 + pet.phase) * 0.06 : 0;
  }
}

let room: Room = 'yard';
function applyRoom(): void {
  yardGroup.visible = room === 'yard';
  houseGroup.visible = room === 'house';
  loftGroup.visible = room === 'loft';
  for (const o of others.values()) o.avatar.view.visible = o.room === room;
}

// --------------------------------------------------------- the avatars

/** Build a body for an avatar id: the blob, or a bought model. */
function makeAvatar(avatarId: string, color: number, hat: string): Avatar {
  const row = AVATAR_STORE.find((a) => a.id === avatarId);
  if (row?.url) return modelAvatar(row.url, row.height ?? 120, hat);
  return blobAvatar(color, hat);
}

let me: Avatar = makeAvatar(profile.avatar, profile.color, profile.hat);
game.scene.add(me.view);
me.view.position.set(0, 0, 420);
let myYaw = Math.PI;

/** Swap my body live: keep where I stand and where I face. */
function setMyAvatar(avatarId: string): void {
  const pos = me.view.position.clone();
  const rotY = me.view.rotation.y;
  game.scene.remove(me.view);
  me = makeAvatar(avatarId, profile.color, profile.hat);
  me.view.position.copy(pos);
  me.view.rotation.y = rotY;
  game.scene.add(me.view);
}

interface Other {
  avatar: Avatar;
  avatarId: string;
  name: string;
  color: number;
  hat: string;
  room: Room;
  tx: number;
  tz: number;
  ty: number;
  yaw: number;
  moving: boolean;
}
const others = new Map<string, Other>();

function upsertOther(id: string, name: string, color: number, hat: string, avatarId = 'blob'): Other {
  let o = others.get(id);
  // A changed BODY needs a rebuild; everything else patches in place.
  if (o && o.avatarId !== avatarId) {
    const pos = o.avatar.view.position.clone();
    game.scene.remove(o.avatar.view);
    others.delete(id);
    o = undefined;
    const fresh = upsertOther(id, name, color, hat, avatarId);
    fresh.avatar.view.position.copy(pos);
    return fresh;
  }
  if (!o) {
    o = {
      avatar: makeAvatar(avatarId, color, hat), avatarId, name, color, hat,
      room: 'yard', tx: 0, tz: 300, ty: 0, yaw: 0, moving: false,
    };
    o.avatar.view.position.set(0, 0, 300);
    game.scene.add(o.avatar.view);
    others.set(id, o);
    audio.blip();
  } else {
    o.name = name;
    o.color = color;
    o.hat = hat;
    o.avatar.setColor(color);
    o.avatar.setHat(hat);
  }
  return o;
}

function dropOther(id: string): void {
  const o = others.get(id);
  if (o) {
    game.scene.remove(o.avatar.view);
    others.delete(id);
  }
}

function clearOthers(): void {
  for (const id of [...others.keys()]) dropOther(id);
}

// ---------------------------------------------------------------- input

const held = { x: 0, z: 0 };
const down = new Set<string>();
const KEYS = new Map<string, [number, number]>([
  ['arrowleft', [-1, 0]], ['a', [-1, 0]],
  ['arrowright', [1, 0]], ['d', [1, 0]],
  ['arrowup', [0, -1]], ['w', [0, -1]],
  ['arrowdown', [0, 1]], ['s', [0, 1]],
]);
const applyKeys = (): void => {
  held.x = 0;
  held.z = 0;
  for (const k of down) {
    const v = KEYS.get(k);
    if (v) {
      held.x += v[0];
      held.z += v[1];
    }
  }
};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
  if (KEYS.has(k)) {
    down.add(k);
    applyKeys();
  }
  if (k === 'c') toggleCam();
  if (k === ' ') doJump();
});
window.addEventListener('keyup', (e) => {
  down.delete(e.key.toLowerCase());
  applyKeys();
});

// Virtual stick on the left half; PlayerCam already owns the right half.
const joyEl = document.getElementById('joy')!;
const knobEl = document.getElementById('joyknob')!;
const moveEl = document.getElementById('move')!;
const stick = { active: false, ox: 0, oy: 0, x: 0, z: 0 };
moveEl.addEventListener('pointerdown', (e) => {
  stick.active = true;
  stick.ox = e.clientX;
  stick.oy = e.clientY;
  joyEl.style.display = 'block';
  joyEl.style.left = `${e.clientX - 55}px`;
  joyEl.style.top = `${e.clientY - 55}px`;
});
moveEl.addEventListener('pointermove', (e) => {
  if (!stick.active) return;
  const dx = e.clientX - stick.ox;
  const dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy);
  const cap = Math.min(len, 55);
  const nx = len > 4 ? (dx / len) * cap : 0;
  const ny = len > 4 ? (dy / len) * cap : 0;
  knobEl.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  stick.x = nx / 55;
  stick.z = ny / 55;
});
const stickEnd = (): void => {
  stick.active = false;
  stick.x = 0;
  stick.z = 0;
  joyEl.style.display = 'none';
  knobEl.style.transform = 'translate(-50%, -50%)';
};
moveEl.addEventListener('pointerup', stickEnd);
moveEl.addEventListener('pointercancel', stickEnd);

// Taps (short press, either half) place/remove decor in decorate mode.
const ray = new Raycaster();
const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
for (const el of [moveEl, document.getElementById('look')!]) {
  let start: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY }));
  el.addEventListener('pointerup', (e) => {
    const was = start;
    start = null;
    if (!was || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8) return;
    onTap(e.clientX, e.clientY);
  });
}

function onTap(cx: number, cy: number): void {
  if (!decorMode || visiting) return;
  ray.setFromCamera(
    new Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1),
    game.camera,
  );
  // An existing furnishing under the tap? Pick it back up.
  for (const [id, v] of decorViews) {
    if (!v.group.visible || !v.group.parent?.visible) continue;
    if (ray.intersectObject(v.group, true).length) {
      removeDecor(id);
      return;
    }
  }
  const at = new Vector3();
  if (ray.ray.intersectPlane(groundPlane, at)) placeDecor(selItem, at.x, at.z);
}

// ------------------------------------------------------------ decorating

let decorMode = false;
let selItem = 'plant';

function decorAllowedAt(item: string, x: number, z: number): boolean {
  const entry = CATALOGUE.find((c) => c.id === item);
  if (!entry || !entry.rooms.includes(room) || !ownsFurniture(item)) return false;
  const dims = HOUSE_SIZES[worldHouse.size];
  if (room === 'house') return Math.abs(x) < dims.halfW - 60 && Math.abs(z) < dims.halfD - 60;
  if (room === 'loft') {
    return Math.abs(x) < dims.halfW - 140 && Math.abs(z) < dims.halfD - 140;
  }
  if (Math.hypot(x, z) > YARD_R - 110) return false;
  const spec = houseSpec();
  const inHouse =
    Math.abs(x) < spec.w / 2 + 40 && Math.abs(z - HOUSE_Z) < spec.d / 2 + 40;
  return !inHouse;
}

function placeDecor(item: string, x: number, z: number): boolean {
  if (visiting || !decorAllowedAt(item, x, z)) return false;
  const d: DecorItem = { id: freshDecorId(), item, room, x: Math.round(x), z: Math.round(z), rot: myYaw };
  worldDecor.push(d);
  saveProfile(profile);
  rebuildWorld();
  audio.chime();
  return true;
}

function removeDecor(id: string): void {
  const i = worldDecor.findIndex((d) => d.id === id);
  if (i < 0) return;
  worldDecor.splice(i, 1);
  saveProfile(profile);
  rebuildWorld();
  audio.pop();
}

// ----------------------------------------------------------------- net

const relayUrl = resolveRelayUrl();
let session: Session | null = null;
let posTimer: ReturnType<typeof setInterval> | null = null;

function pubProfile(): { name: string; color: number; hat: string; avatar: string; friendCode: string } {
  return {
    name: profile.name, color: profile.color, hat: profile.hat,
    avatar: profile.avatar, friendCode: profile.friendCode,
  };
}

function myPos(): [number, number, Room, number, number, number] {
  return [
    Math.round(me.view.position.x),
    Math.round(me.view.position.z),
    room,
    Math.round(myYaw * 100) / 100,
    held.x || held.z || stick.x || stick.z ? 1 : 0,
    Math.round(me.view.position.y),
  ];
}

function worldSnapshot(): Record<string, unknown> {
  return {
    t: 'world',
    host: pubProfile(),
    decor: profile.decor,
    house: { size: profile.houseSize, theme: profile.houseTheme },
  };
}

/** A new friendship pays a little ⬡ — meeting people is the game. */
function metFriend(code: string, name: string): void {
  if (addFriend(profile, code, name)) {
    verium.add(FRIEND_VRM);
    toast(`New friend: ${name} 💛 +⬡${FRIEND_VRM}`);
    updateHud();
  }
}

/** Open my world: host a room, announce presence, greet guests with the
 *  full world snapshot. */
async function openWorld(): Promise<string> {
  if (session) return session.code;
  if (visiting) throw new Error('go home first');
  const s = await host({ url: relayUrl, name: profile.name, game: GAME_TAG });
  session = s;
  s.announce(profile.friendCode);
  s.onPlayerJoin((p) => {
    s.sendTo(p.id, worldSnapshot());
    toast(`${p.name} arrived! 🌟`);
  });
  s.onPlayerLeave((id) => {
    const o = others.get(id);
    if (o) toast(`${o.name} headed home`);
    dropOther(id);
  });
  s.onMessage((from, raw) => {
    const msg = raw as { t?: string; p?: ReturnType<typeof pubProfile>; l?: unknown[] };
    if (msg.t === 'hi' && msg.p) {
      upsertOther(from, msg.p.name, msg.p.color, msg.p.hat, msg.p.avatar ?? 'blob');
      if (msg.p.friendCode) metFriend(msg.p.friendCode, msg.p.name);
      meetAll();
      renderFriends();
      updateHud();
    } else if (msg.t === 'pos' && Array.isArray(msg.l)) {
      applyPos(from, msg.l as [number, number, Room, number, number, number?]);
    }
  });
  s.onClose(() => goHome('Your world closed'));
  posTimer = setInterval(() => {
    // Host streams EVERYONE (guests + itself) so guests see each other.
    const l: Record<string, unknown[]> = { [s.id]: myPos() };
    for (const [id, o] of others) l[id] = [o.tx, o.tz, o.room, o.yaw, o.moving ? 1 : 0];
    s.broadcast({ t: 'allpos', l });
  }, POS_HZ_MS);
  updateHud();
  return s.code;
}

/** Host re-introduces the whole room (itself + every guest) so a fresh
 *  arrival renders everyone and everyone renders the arrival. Guests only
 *  talk to the host — spec §5.2 topology — so the host is the mirror. */
function meetAll(): void {
  if (!session?.isHost) return;
  session.broadcast({ t: 'meet', id: session.id, p: pubProfile() });
  for (const [id, o] of others) {
    session.broadcast({
      t: 'meet', id,
      p: { name: o.name, color: o.color, hat: o.hat, avatar: o.avatarId, friendCode: '' },
    });
  }
}

function applyPos(id: string, l: [number, number, Room, number, number, number?]): void {
  const o = others.get(id);
  if (!o) return;
  o.tx = l[0];
  o.tz = l[1];
  o.room = l[2] === 'house' ? 'house' : l[2] === 'loft' ? 'loft' : 'yard';
  o.yaw = l[3];
  o.moving = !!l[4];
  o.ty = Number(l[5]) || 0;
  o.avatar.view.visible = o.room === room;
}

/** Walk into a friend's world by room code. */
async function visit(code: string): Promise<void> {
  if (session) {
    session.leave();
    session = null;
  }
  const s = await join(code.toUpperCase(), profile.name, { url: relayUrl, game: GAME_TAG });
  session = s;
  clearOthers();
  s.send({ t: 'hi', p: pubProfile() });
  s.onMessage((_from, raw) => {
    const msg = raw as {
      t?: string;
      id?: string;
      host?: ReturnType<typeof pubProfile>;
      p?: ReturnType<typeof pubProfile>;
      decor?: DecorItem[];
      house?: { size?: string; theme?: string };
      l?: Record<string, [number, number, Room, number, number, number?]>;
    };
    if (msg.t === 'world' && msg.host && Array.isArray(msg.decor)) {
      visiting = { hostName: msg.host.name, hostCode: msg.host.friendCode };
      worldDecor = msg.decor;
      const size = msg.house?.size;
      worldHouse = {
        size: size === 'grand' || size === 'manor' ? size : 'cozy',
        theme: typeof msg.house?.theme === 'string' ? msg.house.theme : 'meadow',
      };
      metFriend(msg.host.friendCode, msg.host.name);
      rebuildWorld();
      room = 'yard';
      me.view.position.set(120, 0, 420);
      applyRoom();
      const hostId = s.players.find((p) => p.isHost)?.id;
      if (hostId) upsertOther(hostId, msg.host.name, msg.host.color, msg.host.hat, msg.host.avatar ?? 'blob');
      updateHud();
      renderFriends();
      toast(`Welcome to ${msg.host.name}'s haven 💛`);
    } else if (msg.t === 'allpos' && msg.l) {
      for (const [id, p] of Object.entries(msg.l)) {
        if (id === s.id || !others.has(id)) continue;
        applyPos(id, p);
      }
    } else if (msg.t === 'meet' && msg.p && msg.id && msg.id !== s.id) {
      // Someone else in the room (or a fresh look), mirrored by the host.
      upsertOther(msg.id, msg.p.name, msg.p.color, msg.p.hat, msg.p.avatar ?? 'blob');
    }
  });
  s.onPlayerJoin(() => undefined);
  s.onPlayerLeave((id) => dropOther(id));
  s.onClose((reason) => goHome(reason.includes('host') ? 'The host closed their world' : 'Disconnected'));
  posTimer = setInterval(() => s.send({ t: 'pos', l: myPos() }), POS_HZ_MS);
  updateHud();
}

function goHome(reason?: string): void {
  if (posTimer) clearInterval(posTimer);
  posTimer = null;
  if (session) {
    try {
      session.leave();
    } catch {
      /* already gone */
    }
  }
  session = null;
  visiting = null;
  clearOthers();
  worldDecor = profile.decor;
  rebuildWorld();
  room = 'yard';
  me.view.position.set(0, 0, 420);
  rig.hemi.intensity = 0.65;
  applyRoom();
  updateHud();
  if (reason) toast(reason);
}

/** Cosmetics changed mid-session: re-introduce myself. */
function sendLook(): void {
  if (!session) return;
  if (session.isHost) {
    session.broadcast({ t: 'meet', id: session.id, p: pubProfile() });
  } else {
    session.send({ t: 'hi', p: pubProfile() });
  }
}

/** House size/theme changed while guests are over: re-send the world. */
function sendHouse(): void {
  if (session?.isHost) session.broadcast(worldSnapshot());
}

// 🎟 Redeem: a typed code unlocks a cosmetic outright — no ⬡ spent.
function redeem(codeRaw: string): boolean {
  const code = codeRaw.trim().toUpperCase();
  const grant = REDEEM_CODES[code];
  if (!grant) {
    toast('Hmm, that code does nothing 🤔');
    return false;
  }
  if (grant.kind === 'avatar') {
    if (!profile.ownedAvatars.includes(grant.id)) profile.ownedAvatars.push(grant.id);
    profile.avatar = grant.id;
    setMyAvatar(grant.id);
    sendLook();
  } else if (!profile.ownedFurniture.includes(grant.id)) {
    profile.ownedFurniture.push(grant.id);
  }
  saveProfile(profile);
  audio.chime();
  toast('Unlocked! 🎁');
  updateHud();
  return true;
}

// ------------------------------------------------------------- presence

let onlineMap: Record<string, string> = {};
async function pollPresence(): Promise<number> {
  if (!profile.friends.length) {
    onlineMap = {};
    renderFriends();
    return 0;
  }
  try {
    const res = await fetch(presenceUrl(profile.friends.map((f) => f.code)));
    const body = (await res.json()) as { online?: Record<string, string> };
    onlineMap = body.online ?? {};
  } catch {
    onlineMap = {};
  }
  renderFriends();
  updateHud();
  return Object.keys(onlineMap).length;
}
// (First poll happens in the boot section — the UI it repaints must exist.)
setInterval(() => void pollPresence(), 25_000);

// ------------------------------------------------------------------- UI

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const titleEl = $('title');
const subtitleEl = $('subtitle');
const hintEl = $('hint');
const toastEl = $('toast');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = '0'), 2600);
}

function updateHud(): void {
  titleEl.textContent = visiting ? `${visiting.hostName}'s Haven` : `${profile.name}'s Haven`;
  const bits: string[] = [];
  if (session?.isHost) bits.push(`open · code ${session.code}`);
  if (others.size) bits.push(`${others.size} ${others.size === 1 ? 'friend' : 'friends'} here`);
  const online = Object.keys(onlineMap).length;
  if (!session && online) bits.push(`${online} online`);
  subtitleEl.textContent = bits.join(' · ');
  $('verium').textContent = `⬡ ${verium.balance()}`;
  $('b-decor').classList.toggle('hidden', !!visiting);
  $('b-home').classList.toggle('hidden', !visiting);
  hintEl.textContent = decorMode ? 'tap the ground to place · tap a furnishing to pick it up' : '';
}

function togglePanel(id: string, open?: boolean): void {
  const el = $(id);
  const want = open ?? el.classList.contains('hidden');
  for (const p of ['wardrobe', 'friends', 'invite', 'store']) $(p).classList.add('hidden');
  if (want) el.classList.remove('hidden');
}
for (const el of document.querySelectorAll<HTMLElement>('[data-close]')) {
  el.onclick = () => $(el.dataset.close!).classList.add('hidden');
}

function toggleCam(): void {
  playerCam.setMode(playerCam.mode === 'third' ? 'first' : 'third');
  $('b-cam').textContent = playerCam.mode === 'third' ? '📷' : '👁';
  toast(playerCam.mode === 'third' ? 'Third person' : 'First person');
}
$('b-cam').onclick = toggleCam;
// pointerdown, not click: a jump must fire the instant the thumb lands.
$('b-jump').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doJump();
});

$('b-decor').onclick = () => {
  decorMode = !decorMode;
  $('b-decor').classList.toggle('on', decorMode);
  $('decorbar').style.display = decorMode ? 'flex' : 'none';
  if (decorMode) renderDecorBar();
  updateHud();
};

$('b-home').onclick = () => goHome('Home sweet home 🏡');
$('b-wardrobe').onclick = () => {
  renderWardrobe();
  togglePanel('wardrobe');
};
$('b-friends').onclick = () => {
  renderFriends();
  void pollPresence();
  togglePanel('friends');
};
$('b-invite').onclick = () => {
  renderInvite();
  togglePanel('invite');
};
$('b-store').onclick = () => {
  renderStore();
  togglePanel('store');
};

function renderDecorBar(): void {
  const bar = $('decorbar');
  bar.innerHTML = '';
  for (const item of CATALOGUE) {
    if (!item.rooms.includes(room)) continue;
    const owned = ownsFurniture(item.id);
    const b = document.createElement('button');
    b.innerHTML = owned
      ? `${item.emoji}<small>${item.label}</small>`
      : `🔒<small>${item.label}</small>`;
    b.classList.toggle('on', selItem === item.id && owned);
    b.onclick = () => {
      if (!owned) {
        togglePanel('store', true);
        renderStore('furniture');
        return;
      }
      selItem = item.id;
      renderDecorBar();
    };
    bar.appendChild(b);
  }
}

// 🏪 The store: five shelves, one buy() path.
function renderStore(tab = 'hats'): void {
  const tabs = $('s-tabs');
  tabs.innerHTML = '';
  const sections: [string, string][] = [
    ['hats', '👒 Hats'], ['coats', '🎨 Coats'], ['avatars', '🧍 Avatars'],
    ['furniture', '🛋 Furniture'], ['houses', '🏠 Houses'], ['themes', '🖌 Themes'],
  ];
  for (const [id, label] of sections) {
    const b = document.createElement('button');
    b.className = `hatbtn${tab === id ? ' on' : ''}`;
    b.textContent = label;
    b.onclick = () => renderStore(id);
    tabs.appendChild(b);
  }
  $('s-balance').textContent = `⬡ ${verium.balance()}`;
  // The daily gift lives in the store's header — one tap a day.
  const today = new Date().toISOString().slice(0, 10);
  const daily = $('s-daily') as HTMLButtonElement;
  daily.disabled = profile.lastDaily === today;
  daily.textContent = daily.disabled ? '🎁 come back tomorrow' : `🎁 Daily gift +⬡${DAILY_VRM}`;
  daily.onclick = () => {
    if (profile.lastDaily === today) return;
    profile.lastDaily = today;
    saveProfile(profile);
    verium.add(DAILY_VRM);
    audio.chime();
    renderStore(tab);
    updateHud();
  };
  // The redeem slot: type a giveaway code, own the thing.
  const redeemBtn = $('s-redeem') as HTMLButtonElement;
  redeemBtn.onclick = () => {
    const input = $('s-code') as HTMLInputElement;
    if (redeem(input.value)) {
      input.value = '';
      renderStore(tab);
    }
  };
  const list = $('s-list');
  list.innerHTML = '';
  const row = (
    label: string,
    price: number,
    owned: boolean,
    active: boolean,
    onBuy: () => void,
    swatch?: number,
    thumbUrl?: { url: string; height: number },
  ): void => {
    const div = document.createElement('div');
    div.className = 'friend';
    const dot = swatch !== undefined
      ? `<span class="swatch" style="width:26px;height:26px;background:#${swatch.toString(16).padStart(6, '0')}"></span>`
      : '';
    div.innerHTML = `${dot}<span class="who">${label}</span>`;
    // A model gets its PHOTO — rendered once, cached forever.
    if (thumbUrl) {
      const img = document.createElement('img');
      img.style.cssText = 'width:44px;height:44px;border-radius:10px;background:#14201a';
      div.prepend(img);
      void modelThumb(thumbUrl.url, thumbUrl.height).then((src) => (img.src = src));
    }
    const b = document.createElement('button');
    b.className = active ? 'ghost' : 'primary';
    b.textContent = active ? 'Using' : owned ? 'Use' : price === 0 ? 'Free' : `⬡ ${price}`;
    if (!active) b.onclick = onBuy;
    div.appendChild(b);
    list.appendChild(div);
  };
  if (tab === 'hats') {
    for (const h of HAT_STORE) {
      row(h.name, h.price, ownsHat(h.id), profile.hat === h.id, () => {
        if (buy('hat', h.id)) renderStore(tab);
      });
    }
  } else if (tab === 'coats') {
    for (const c of BASE_COLORS) {
      row('Coat', 0, true, profile.color === c, () => {
        if (buy('color', c)) renderStore(tab);
      }, c);
    }
    for (const p of PREMIUM_COLORS) {
      row(p.name, p.price, ownsColor(p.color), profile.color === p.color, () => {
        if (buy('color', p.color)) renderStore(tab);
      }, p.color);
    }
  } else if (tab === 'avatars') {
    for (const a of AVATAR_STORE) {
      row(
        a.name, a.price, ownsAvatar(a.id), profile.avatar === a.id,
        () => {
          if (buy('avatar', a.id)) renderStore(tab);
        },
        undefined,
        a.url ? { url: a.url, height: a.height ?? 120 } : undefined,
      );
    }
  } else if (tab === 'furniture') {
    for (const f of FURNITURE_STORE) {
      const model = MODEL_DECOR.find((m) => m.id === f.id);
      row(
        f.name, f.price, ownsFurniture(f.id), false,
        () => {
          if (buy('furniture', f.id)) {
            toast(`${f.name} added to your decorate bar 🛋`);
            renderStore(tab);
          }
        },
        undefined,
        model ? { url: model.url, height: model.height } : undefined,
      );
    }
  } else if (tab === 'houses') {
    for (const h of HOUSE_STORE) {
      row(
        `${h.name} — ${h.blurb}`,
        h.price,
        ownsHouse(h.id as HouseSizeId),
        !visiting && profile.houseSize === h.id,
        () => {
          if (buy('house', h.id)) renderStore(tab);
        },
      );
    }
  } else {
    for (const t of THEME_STORE) {
      row(t.name, t.price, ownsTheme(t.id), profile.houseTheme === t.id, () => {
        if (buy('theme', t.id)) renderStore(tab);
      }, t.wall);
    }
  }
}

function renderWardrobe(): void {
  const nameIn = $('w-name') as HTMLInputElement;
  nameIn.value = profile.name;
  nameIn.onchange = () => {
    profile.name = nameIn.value.trim().slice(0, 12) || profile.name;
    saveProfile(profile);
    sendLook();
    updateHud();
  };
  const colors = $('w-colors');
  colors.innerHTML = '';
  for (const c of [...BASE_COLORS, ...profile.ownedColors]) {
    const b = document.createElement('button');
    b.className = `swatch${profile.color === c ? ' on' : ''}`;
    b.style.background = `#${c.toString(16).padStart(6, '0')}`;
    b.onclick = () => {
      buy('color', c);
      renderWardrobe();
    };
    colors.appendChild(b);
  }
  const hats = $('w-hats');
  hats.innerHTML = '';
  for (const h of HAT_STORE) {
    if (!ownsHat(h.id)) continue;
    const b = document.createElement('button');
    b.className = `hatbtn${profile.hat === h.id ? ' on' : ''}`;
    b.textContent = h.name;
    b.onclick = () => {
      buy('hat', h.id);
      renderWardrobe();
    };
    hats.appendChild(b);
  }
  for (const a of AVATAR_STORE) {
    if (!ownsAvatar(a.id)) continue;
    const b = document.createElement('button');
    b.className = `hatbtn${profile.avatar === a.id ? ' on' : ''}`;
    b.textContent = `🧍 ${a.name}`;
    b.onclick = () => {
      buy('avatar', a.id);
      renderWardrobe();
    };
    hats.appendChild(b);
  }
  const more = document.createElement('button');
  more.className = 'hatbtn';
  more.textContent = '🏪 more in the Store…';
  more.onclick = () => {
    renderStore('hats');
    togglePanel('store', true);
  };
  hats.appendChild(more);
}

function renderFriends(): void {
  $('mycode').textContent = profile.friendCode;
  const list = $('f-list');
  list.innerHTML = '';
  if (!profile.friends.length) {
    list.innerHTML = '<p style="color:#8ba090;font-size:14px">No friends saved yet — visit someone (or have them over) and you\'ll remember each other automatically.</p>';
  }
  for (const f of profile.friends) {
    const roomCode = onlineMap[f.code];
    const rowEl = document.createElement('div');
    rowEl.className = 'friend';
    rowEl.innerHTML = `<span class="dot${roomCode ? ' online' : ''}"></span><span class="who">${f.name}<small>${f.code}</small></span>`;
    if (roomCode) {
      const go = document.createElement('button');
      go.className = 'primary';
      go.textContent = 'Visit';
      go.onclick = () => {
        togglePanel('friends', false);
        void visit(roomCode).catch((err: Error) => toast(err.message));
      };
      rowEl.appendChild(go);
    }
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '✕';
    del.onclick = () => {
      removeFriend(profile, f.code);
      renderFriends();
    };
    rowEl.appendChild(del);
    list.appendChild(rowEl);
  }
  ($('f-add') as HTMLButtonElement).onclick = () => {
    const code = ($('f-code') as HTMLInputElement).value.trim().toUpperCase();
    const name = ($('f-name') as HTMLInputElement).value.trim() || 'Friend';
    if (code.length >= 4) {
      metFriend(code, name);
      ($('f-code') as HTMLInputElement).value = '';
      ($('f-name') as HTMLInputElement).value = '';
      renderFriends();
      void pollPresence();
    }
  };
}

function renderInvite(): void {
  const status = $('i-status');
  const codeEl = $('i-code');
  const openBtn = $('i-open') as HTMLButtonElement;
  if (session?.isHost) {
    status.textContent = 'Your world is open — friends can join with this code:';
    codeEl.textContent = session.code;
    codeEl.classList.remove('hidden');
    openBtn.textContent = 'Close my world';
    openBtn.onclick = () => {
      goHome('World closed');
      renderInvite();
    };
  } else {
    status.textContent = visiting
      ? 'You are visiting — head home before opening your own world.'
      : 'Open your world to get a room code your friends can join.';
    codeEl.classList.add('hidden');
    openBtn.textContent = 'Open my world';
    openBtn.disabled = !!visiting;
    openBtn.onclick = () => {
      openBtn.disabled = true;
      void openWorld()
        .then(() => {
          openBtn.disabled = false;
          renderInvite();
        })
        .catch((err: Error) => {
          openBtn.disabled = false;
          toast(err.message);
        });
    };
  }
  ($('i-go') as HTMLButtonElement).onclick = () => {
    const code = ($('i-join') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length === 4) {
      togglePanel('invite', false);
      void visit(code).catch((err: Error) => toast(err.message));
    }
  };
}

// ------------------------------------------------------------ main loop

// 🦘 The jump: one impulse, one gravity, one ground. Guests see it too —
// the y rides the same position stream as everything else.
let vy = 0;
function doJump(): void {
  if (me.view.position.y > 0.5) return; // no double jumps — cozy, not Quake
  vy = 640;
  audio.blip();
}

let t = 0;
function update(dt: number): void {
  t += dt;
  if (vy !== 0 || me.view.position.y > 0) {
    me.view.position.y += vy * dt;
    vy -= 1900 * dt;
    if (me.view.position.y <= 0) {
      me.view.position.y = 0;
      vy = 0;
    }
  }
  const ix = Math.max(-1, Math.min(1, held.x + stick.x));
  const iz = Math.max(-1, Math.min(1, held.z + stick.z));
  const mv = playerCam.moveVector(ix, iz);
  const moving = mv.x !== 0 || mv.z !== 0;
  const dims = HOUSE_SIZES[worldHouse.size];
  const spec = houseSpec();
  if (moving) {
    let nx = me.view.position.x + mv.x * SPEED * dt;
    let nz = me.view.position.z + mv.z * SPEED * dt;
    if (room === 'yard') {
      // Stay on the island…
      const r = Math.hypot(nx, nz);
      if (r > YARD_R - 70) {
        nx *= (YARD_R - 70) / r;
        nz *= (YARD_R - 70) / r;
      }
      // …and out of the house walls (the door strip is the way in).
      const inX = Math.abs(nx) < spec.w / 2 + 30;
      const inZ = Math.abs(nz - HOUSE_Z) < spec.d / 2 + 30;
      const inDoor =
        Math.abs(nx) < spec.doorW / 2 && nz > HOUSE_Z && nz < HOUSE_Z + spec.d / 2 + 80;
      if (inX && inZ && !inDoor) {
        const keepX = Math.abs(me.view.position.x) >= spec.w / 2 + 30;
        const keepZ = Math.abs(me.view.position.z - HOUSE_Z) >= spec.d / 2 + 30;
        if (keepX) nx = me.view.position.x;
        else if (keepZ) nz = me.view.position.z;
        else {
          nx = me.view.position.x;
          nz = me.view.position.z;
        }
      }
      me.view.position.x = nx;
      me.view.position.z = nz;
      // Through the door: into the house.
      if (inDoor && nz < HOUSE_Z + spec.d / 2 - 10) enterHouse();
    } else if (room === 'house') {
      nx = Math.max(-dims.halfW + 50, Math.min(dims.halfW - 50, nx));
      nz = Math.max(-dims.halfD + 50, Math.min(dims.halfD + 40, nz));
      me.view.position.x = nx;
      me.view.position.z = nz;
      if (nz > dims.halfD - 20 && Math.abs(nx) < spec.doorW / 2) exitToYard();
      // The stairs' rectangle (only drawn when there ARE stairs).
      else if (
        dims.stories > 1 &&
        nx < -dims.halfW + 170 &&
        nz < -dims.halfD + 180
      ) {
        goUpstairs();
      }
    } else {
      // The loft: tighter bounds, the stairwell corner goes back down.
      nx = Math.max(-dims.halfW + 130, Math.min(dims.halfW - 130, nx));
      nz = Math.max(-dims.halfD + 130, Math.min(dims.halfD - 130, nz));
      me.view.position.x = nx;
      me.view.position.z = nz;
      if (nx < -dims.halfW + 220 && nz < -dims.halfD + 240) goDownstairs();
    }
    myYaw = Math.atan2(mv.x, mv.z);
    me.view.rotation.y = myYaw;
  }
  me.tick(t, moving);
  me.view.visible = !playerCam.hidePlayer;
  playerCam.update(game.camera, me.view.position);
  // Indoors the chase camera must stay INSIDE the room — a lens that
  // backs through the wall films the wall. Clamp it into the shell and
  // re-aim at the player's head.
  if (room !== 'yard' && playerCam.mode === 'third') {
    const inW = (room === 'loft' ? dims.halfW - 80 : dims.halfW) - 40;
    const inD = (room === 'loft' ? dims.halfD - 80 : dims.halfD) - 40;
    const cp = game.camera.position;
    const clamped =
      cp.x < -inW || cp.x > inW || cp.z < -inD || cp.z > inD || cp.y > 300;
    cp.x = Math.max(-inW, Math.min(inW, cp.x));
    cp.z = Math.max(-inD, Math.min(inD, cp.z));
    cp.y = Math.min(300, cp.y);
    if (clamped) {
      game.camera.lookAt(new Vector3(me.view.position.x, 80, me.view.position.z));
    }
  }
  // The shadow box can't cover a 10× island — it follows the player.
  rig.follow(me.view.position);
  // Friends drift toward their reported spots; snap across room changes.
  for (const o of others.values()) {
    const v = o.avatar.view;
    const k = Math.min(1, dt * 10);
    v.position.x += (o.tx - v.position.x) * k;
    v.position.z += (o.tz - v.position.z) * k;
    v.position.y += (o.ty - v.position.y) * Math.min(1, dt * 14);
    v.rotation.y += (o.yaw - v.rotation.y) * k;
    o.avatar.tick(t, o.moving);
  }
  tickPets(dt);
  // Anything named bob (fountain drops, flames, fish) bobs.
  worldRoot.traverse((obj) => {
    if (obj.name !== 'bob') return;
    if (obj.userData.baseY === undefined) obj.userData.baseY = obj.position.y;
    obj.position.y = (obj.userData.baseY as number) + Math.sin(t * 3 + obj.id) * 8;
  });
}

function enterHouse(): void {
  const dims = HOUSE_SIZES[worldHouse.size];
  room = 'house';
  me.view.position.set(0, 0, dims.halfD - 90);
  playerCam.distance = Math.min(playerCam.distance, 320);
  // Indoors the sun can't reach the walls' inner faces — the hemisphere
  // becomes the room's lamplight.
  rig.hemi.intensity = 1.6;
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

function exitToYard(): void {
  const spec = houseSpec();
  room = 'yard';
  me.view.position.set(0, 0, HOUSE_Z + spec.d / 2 + 130);
  playerCam.distance = Math.max(playerCam.distance, 470);
  rig.hemi.intensity = 0.65;
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

function goUpstairs(): void {
  const dims = HOUSE_SIZES[worldHouse.size];
  room = 'loft';
  me.view.position.set(-dims.halfW + 320, 0, -dims.halfD + 320);
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

function goDownstairs(): void {
  const dims = HOUSE_SIZES[worldHouse.size];
  room = 'house';
  me.view.position.set(-dims.halfW + 260, 0, -dims.halfD + 300);
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

// ----------------------------------------------------------------- boot

rebuildWorld();
updateHud();
void pollPresence();

const joinParam = params.get('join');
if (joinParam) {
  void visit(joinParam).catch((err: Error) => toast(err.message));
}
if (params.get('open')) {
  void openWorld().catch((err: Error) => toast(err.message));
}

// ------------------------------------------------- headless test hooks

declare global {
  interface Window {
    __haven?: {
      state: () => Record<string, unknown>;
      warp: (x: number, z: number) => void;
      setCam: (m: 'third' | 'first') => void;
      enterHouse: () => void;
      exitHouse: () => void;
      goUpstairs: () => void;
      goDownstairs: () => void;
      jump: () => void;
      setDecorMode: (on: boolean, item?: string) => void;
      placeAt: (item: string, x: number, z: number) => boolean;
      decorCount: () => number;
      openWorld: () => Promise<string>;
      visit: (code: string) => Promise<void>;
      goHome: () => void;
      addFriend: (code: string, name: string) => void;
      friends: () => { code: string; name: string; online: boolean }[];
      poll: () => Promise<number>;
      setHat: (id: string) => void;
      setColor: (c: number) => void;
      profile: () => { name: string; friendCode: string; color: number; hat: string };
      verium: () => number;
      grant: (n: number) => void;
      buy: (kind: BuyKind, id: string | number) => boolean;
      redeem: (code: string) => boolean;
      owned: () => Record<string, unknown>;
    };
  }
}

window.__haven = {
  state: () => ({
    room,
    x: Math.round(me.view.position.x),
    z: Math.round(me.view.position.z),
    camY: Math.round(game.camera.position.y),
    cam: playerCam.mode,
    playerVisible: me.view.visible,
    decor: worldDecor.length,
    guests: others.size,
    hosting: !!session?.isHost,
    visiting: !!visiting,
    code: session?.code ?? null,
    hostName: visiting?.hostName ?? null,
    friends: profile.friends.length,
    online: Object.keys(onlineMap).length,
    worldR: YARD_R,
    houseSize: worldHouse.size,
    houseTheme: worldHouse.theme,
    verium: verium.balance(),
    avatar: profile.avatar,
    modelsLoaded: modelStats.loaded,
    playerY: Math.round(me.view.position.y),
    pets: [...petStates.entries()].map(([id, p]) => {
      const v = decorViews.get(id)?.group;
      return {
        id,
        x: Math.round(v?.position.x ?? 0),
        z: Math.round(v?.position.z ?? 0),
        y: Math.round(v?.position.y ?? 0),
        room: p.room,
      };
    }),
    othersHere: [...others.values()].map((o) => ({
      name: o.name,
      room: o.room,
      hat: o.hat,
      avatar: o.avatarId,
      color: o.color,
      x: Math.round(o.avatar.view.position.x),
      z: Math.round(o.avatar.view.position.z),
      y: Math.round(o.avatar.view.position.y),
    })),
  }),
  warp: (x, z) => {
    me.view.position.set(x, 0, z);
  },
  setCam: (m) => {
    playerCam.setMode(m);
  },
  enterHouse,
  exitHouse: exitToYard,
  goUpstairs,
  goDownstairs,
  jump: doJump,
  setDecorMode: (on, item) => {
    decorMode = on;
    if (item) selItem = item;
  },
  placeAt: (item, x, z) => placeDecor(item, x, z),
  decorCount: () => worldDecor.length,
  openWorld,
  visit,
  goHome: () => goHome(),
  addFriend: (code, name) => {
    metFriend(code, name);
    renderFriends();
  },
  friends: () => profile.friends.map((f) => ({ ...f, online: !!onlineMap[f.code] })),
  poll: pollPresence,
  setHat: (id) => {
    profile.hat = id;
    saveProfile(profile);
    me.setHat(id);
    sendLook();
  },
  setColor: (c) => {
    profile.color = c;
    saveProfile(profile);
    me.setColor(c);
    sendLook();
  },
  profile: () => ({ name: profile.name, friendCode: profile.friendCode, color: profile.color, hat: profile.hat }),
  verium: () => verium.balance(),
  grant: (n) => {
    verium.add(n);
    updateHud();
  },
  buy: (kind, id) => buy(kind, id),
  redeem,
  owned: () => ({
    hats: [...profile.ownedHats],
    colors: [...profile.ownedColors],
    avatars: [...profile.ownedAvatars],
    furniture: [...profile.ownedFurniture],
    houses: [...profile.ownedHouses],
    themes: [...profile.ownedThemes],
    houseSize: profile.houseSize,
    houseTheme: profile.houseTheme,
  }),
};
