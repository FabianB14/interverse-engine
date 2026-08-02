/**
 * 🏡 Blobhaven — the cozy social hub (spec §2: party/cozy first).
 *
 * Every player owns a WORLD: an island yard and a house you can walk into
 * and decorate. Your world persists on your device; opening it creates a
 * relay room and friends walk in as guests — they see YOUR decor, you all
 * see each other, and nobody but you can move your furniture. Cosmetics
 * ride along: color + hat travel in the hello and roster messages.
 *
 * Identity is an opaque friend code (no accounts, no PII — spec §8.6);
 * the friends LIST lives in the local save, and the relay's in-memory
 * presence directory only answers "is this code online right now, and
 * what room do I knock on?" Losing the relay loses nothing.
 *
 * Cameras: this is the first game on PlayerCam — third person by default,
 * 📷 toggles first person. Left half of the screen is the walk stick,
 * right half is the look stick, exactly like every mobile 3D game.
 */

import { Fog, Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import {
  PlayerCam, autoQuality, createGame3, lightRig, skyDome,
} from '@interverse/three';
import type { Game3 } from '@interverse/three';
import { audio } from '@interverse/core';
import { host, join } from '@interverse/net';
import type { Session } from '@interverse/net';
import {
  CATALOGUE, blobAvatar, buildItem, houseExterior, houseInterior, islandView, pathView, yardTrees,
} from './art.js';
import type { Avatar } from './art.js';
import {
  COLORS, HATS, addFriend, freshDecorId, loadProfile, removeFriend, saveProfile,
} from './save.js';
import type { DecorItem, Profile } from './save.js';
import { GAME_TAG, presenceUrl, resolveRelayUrl } from './config.js';

// ------------------------------------------------------------ constants

const YARD_R = 1150;
const HOUSE = { x: 0, z: -620, w: 640, d: 460, doorW: 150 };
const HOUSE_HALF_W = 460;
const HOUSE_HALF_D = 320;
const SPEED = 340;
const POS_HZ_MS = 100;

type Room = 'yard' | 'house';

const params = new URLSearchParams(location.search);
if (params.get('fresh')) localStorage.removeItem('interverse:haven');

const profile: Profile = loadProfile();
if (params.get('name')) {
  profile.name = params.get('name')!.slice(0, 12);
  saveProfile(profile);
}

// ------------------------------------------------------------- three.js

const game: Game3 = createGame3({
  background: 0xc9a37c,
  fov: 55,
  update: (dt) => update(dt),
});
autoQuality(game);
const rig = lightRig(game.scene, { intensity: 1.15, shadowArea: 1400 });
rig.hemi.intensity = 0.65;
game.scene.fog = new Fog(0xc9a37c, 1600, 5200);
game.scene.add(skyDome({ horizon: 0xd8a878, zenith: 0x5a7a9a }));

const playerCam = new PlayerCam({
  dom: document.getElementById('look')!,
  mode: 'third',
  distance: 470,
  eyeHeight: 96,
});
playerCam.yaw = Math.PI; // face the house on spawn

// ------------------------------------------------------- world building

const worldRoot = new Group();
game.scene.add(worldRoot);
let yardGroup = new Group();
let houseGroup = new Group();
/** Placed decor views by id, for tap-to-remove. */
const decorViews = new Map<string, { group: Group; item: string }>();

/** What decor the CURRENT world shows: mine at home, the host's while
 *  visiting. Mutating this while at home mutates the save's array. */
let worldDecor: DecorItem[] = profile.decor;
let visiting: { hostName: string; hostCode: string } | null = null;

function rebuildWorld(): void {
  worldRoot.remove(yardGroup, houseGroup);
  decorViews.clear();
  yardGroup = new Group();
  yardGroup.add(islandView(YARD_R));
  yardGroup.add(pathView(360, HOUSE.z + HOUSE.d / 2 + 90));
  yardGroup.add(yardTrees(YARD_R));
  yardGroup.add(houseExterior(HOUSE));
  houseGroup = new Group();
  houseGroup.add(houseInterior(HOUSE_HALF_W, HOUSE_HALF_D, HOUSE.doorW));
  let seed = 5;
  for (const d of worldDecor) {
    const view = buildItem(d.item, seed++);
    if (!view) continue;
    view.position.set(d.x, 0, d.z);
    view.rotation.y = d.rot;
    (d.room === 'yard' ? yardGroup : houseGroup).add(view);
    decorViews.set(d.id, { group: view, item: d.item });
  }
  worldRoot.add(yardGroup, houseGroup);
  applyRoom();
}

let room: Room = 'yard';
function applyRoom(): void {
  yardGroup.visible = room === 'yard';
  houseGroup.visible = room === 'house';
  for (const o of others.values()) o.avatar.view.visible = o.room === room;
}

// --------------------------------------------------------- the avatars

const me: Avatar = blobAvatar(profile.color, profile.hat);
game.scene.add(me.view);
me.view.position.set(0, 0, 420);
let myYaw = Math.PI;

interface Other {
  avatar: Avatar;
  name: string;
  color: number;
  hat: string;
  room: Room;
  tx: number;
  tz: number;
  yaw: number;
  moving: boolean;
}
const others = new Map<string, Other>();

function upsertOther(id: string, name: string, color: number, hat: string): Other {
  let o = others.get(id);
  if (!o) {
    o = {
      avatar: blobAvatar(color, hat), name, color, hat,
      room: 'yard', tx: 0, tz: 300, yaw: 0, moving: false,
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
  if (!entry || !entry.rooms.includes(room)) return false;
  if (room === 'house') return Math.abs(x) < HOUSE_HALF_W - 60 && Math.abs(z) < HOUSE_HALF_D - 60;
  if (Math.hypot(x, z) > YARD_R - 110) return false;
  const inHouse =
    Math.abs(x - HOUSE.x) < HOUSE.w / 2 + 40 && Math.abs(z - HOUSE.z) < HOUSE.d / 2 + 40;
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

function pubProfile(): { name: string; color: number; hat: string; friendCode: string } {
  return { name: profile.name, color: profile.color, hat: profile.hat, friendCode: profile.friendCode };
}

function myPos(): [number, number, Room, number, number] {
  return [
    Math.round(me.view.position.x),
    Math.round(me.view.position.z),
    room,
    Math.round(myYaw * 100) / 100,
    held.x || held.z || stick.x || stick.z ? 1 : 0,
  ];
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
    s.sendTo(p.id, { t: 'world', host: pubProfile(), decor: worldDecor });
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
      upsertOther(from, msg.p.name, msg.p.color, msg.p.hat);
      if (msg.p.friendCode) addFriend(profile, msg.p.friendCode, msg.p.name);
      meetAll();
      renderFriends();
      updateHud();
    } else if (msg.t === 'pos' && Array.isArray(msg.l)) {
      applyPos(from, msg.l as [number, number, Room, number, number]);
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
      p: { name: o.name, color: o.color, hat: o.hat, friendCode: '' },
    });
  }
}

function applyPos(id: string, l: [number, number, Room, number, number]): void {
  const o = others.get(id);
  if (!o) return;
  o.tx = l[0];
  o.tz = l[1];
  o.room = l[2] === 'house' ? 'house' : 'yard';
  o.yaw = l[3];
  o.moving = !!l[4];
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
      l?: Record<string, [number, number, Room, number, number]>;
    };
    if (msg.t === 'world' && msg.host && Array.isArray(msg.decor)) {
      visiting = { hostName: msg.host.name, hostCode: msg.host.friendCode };
      worldDecor = msg.decor;
      addFriend(profile, msg.host.friendCode, msg.host.name);
      rebuildWorld();
      room = 'yard';
      me.view.position.set(120, 0, 420);
      applyRoom();
      const hostId = s.players.find((p) => p.isHost)?.id;
      if (hostId) upsertOther(hostId, msg.host.name, msg.host.color, msg.host.hat);
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
      upsertOther(msg.id, msg.p.name, msg.p.color, msg.p.hat);
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
  applyRoom();
  updateHud();
  if (reason) toast(reason);
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
setInterval(() => void pollPresence(), 25_000);
void pollPresence();

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
  $('b-decor').classList.toggle('hidden', !!visiting);
  $('b-home').classList.toggle('hidden', !visiting);
  hintEl.textContent = decorMode ? 'tap the ground to place · tap a furnishing to pick it up' : '';
}

function togglePanel(id: string, open?: boolean): void {
  const el = $(id);
  const want = open ?? el.classList.contains('hidden');
  for (const p of ['wardrobe', 'friends', 'invite']) $(p).classList.add('hidden');
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

function renderDecorBar(): void {
  const bar = $('decorbar');
  bar.innerHTML = '';
  for (const item of CATALOGUE) {
    if (!item.rooms.includes(room)) continue;
    const b = document.createElement('button');
    b.innerHTML = `${item.emoji}<small>${item.label}</small>`;
    b.classList.toggle('on', selItem === item.id);
    b.onclick = () => {
      selItem = item.id;
      renderDecorBar();
    };
    bar.appendChild(b);
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
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = `swatch${profile.color === c ? ' on' : ''}`;
    b.style.background = `#${c.toString(16).padStart(6, '0')}`;
    b.onclick = () => {
      profile.color = c;
      saveProfile(profile);
      me.setColor(c);
      sendLook();
      renderWardrobe();
    };
    colors.appendChild(b);
  }
  const hats = $('w-hats');
  hats.innerHTML = '';
  for (const h of HATS) {
    const b = document.createElement('button');
    b.className = `hatbtn${profile.hat === h.id ? ' on' : ''}`;
    b.textContent = h.name;
    b.onclick = () => {
      profile.hat = h.id;
      saveProfile(profile);
      me.setHat(h.id);
      sendLook();
      renderWardrobe();
    };
    hats.appendChild(b);
  }
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

function renderFriends(): void {
  $('mycode').textContent = profile.friendCode;
  const list = $('f-list');
  list.innerHTML = '';
  if (!profile.friends.length) {
    list.innerHTML = '<p style="color:#8ba090;font-size:14px">No friends saved yet — visit someone (or have them over) and you\'ll remember each other automatically.</p>';
  }
  for (const f of profile.friends) {
    const roomCode = onlineMap[f.code];
    const row = document.createElement('div');
    row.className = 'friend';
    row.innerHTML = `<span class="dot${roomCode ? ' online' : ''}"></span><span class="who">${f.name}<small>${f.code}</small></span>`;
    if (roomCode) {
      const go = document.createElement('button');
      go.className = 'primary';
      go.textContent = 'Visit';
      go.onclick = () => {
        togglePanel('friends', false);
        void visit(roomCode).catch((err: Error) => toast(err.message));
      };
      row.appendChild(go);
    }
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = '✕';
    del.onclick = () => {
      removeFriend(profile, f.code);
      renderFriends();
    };
    row.appendChild(del);
    list.appendChild(row);
  }
  ($('f-add') as HTMLButtonElement).onclick = () => {
    const code = ($('f-code') as HTMLInputElement).value.trim().toUpperCase();
    const name = ($('f-name') as HTMLInputElement).value.trim() || 'Friend';
    if (code.length >= 4) {
      addFriend(profile, code, name);
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

let t = 0;
function update(dt: number): void {
  t += dt;
  const ix = Math.max(-1, Math.min(1, held.x + stick.x));
  const iz = Math.max(-1, Math.min(1, held.z + stick.z));
  const mv = playerCam.moveVector(ix, iz);
  const moving = mv.x !== 0 || mv.z !== 0;
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
      const inX = Math.abs(nx - HOUSE.x) < HOUSE.w / 2 + 30;
      const inZ = Math.abs(nz - HOUSE.z) < HOUSE.d / 2 + 30;
      const inDoor =
        Math.abs(nx - HOUSE.x) < HOUSE.doorW / 2 &&
        nz > HOUSE.z &&
        nz < HOUSE.z + HOUSE.d / 2 + 80;
      if (inX && inZ && !inDoor) {
        const keepX = Math.abs(me.view.position.x - HOUSE.x) >= HOUSE.w / 2 + 30;
        const keepZ = Math.abs(me.view.position.z - HOUSE.z) >= HOUSE.d / 2 + 30;
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
      if (inDoor && nz < HOUSE.z + HOUSE.d / 2 - 10) enterHouse();
    } else {
      nx = Math.max(-HOUSE_HALF_W + 50, Math.min(HOUSE_HALF_W - 50, nx));
      nz = Math.max(-HOUSE_HALF_D + 50, Math.min(HOUSE_HALF_D + 40, nz));
      me.view.position.x = nx;
      me.view.position.z = nz;
      if (nz > HOUSE_HALF_D - 20 && Math.abs(nx) < HOUSE.doorW / 2) exitHouse();
    }
    myYaw = Math.atan2(mv.x, mv.z);
    me.view.rotation.y = myYaw;
  }
  me.tick(t, moving);
  me.view.visible = !playerCam.hidePlayer;
  playerCam.update(game.camera, me.view.position);
  // Friends drift toward their reported spots; snap across room changes.
  for (const o of others.values()) {
    const v = o.avatar.view;
    const k = Math.min(1, dt * 10);
    v.position.x += (o.tx - v.position.x) * k;
    v.position.z += (o.tz - v.position.z) * k;
    v.rotation.y += (o.yaw - v.rotation.y) * k;
    o.avatar.tick(t, o.moving);
  }
  // The fountain (and anything else named bob) bobs.
  worldRoot.traverse((obj) => {
    if (obj.name === 'bob') obj.position.y = 128 + Math.sin(t * 3) * 8;
  });
}

function enterHouse(): void {
  room = 'house';
  me.view.position.set(0, 0, HOUSE_HALF_D - 90);
  playerCam.distance = Math.min(playerCam.distance, 320);
  // Indoors the sun can't reach the walls' inner faces — the hemisphere
  // becomes the room's lamplight.
  rig.hemi.intensity = 1.6;
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

function exitHouse(): void {
  room = 'yard';
  me.view.position.set(HOUSE.x, 0, HOUSE.z + HOUSE.d / 2 + 130);
  playerCam.distance = Math.max(playerCam.distance, 470);
  rig.hemi.intensity = 0.65;
  applyRoom();
  if (decorMode) renderDecorBar();
  audio.blip();
}

// ----------------------------------------------------------------- boot

rebuildWorld();
updateHud();

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
    othersHere: [...others.values()].map((o) => ({
      name: o.name,
      room: o.room,
      hat: o.hat,
      color: o.color,
      x: Math.round(o.avatar.view.position.x),
      z: Math.round(o.avatar.view.position.z),
    })),
  }),
  warp: (x, z) => {
    me.view.position.set(x, 0, z);
  },
  setCam: (m) => {
    playerCam.setMode(m);
  },
  enterHouse,
  exitHouse,
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
    addFriend(profile, code, name);
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
};
