/**
 * Studio project model — a game is DATA. The editor edits these defs, the
 * runtime (runtime.ts) turns them into live engine scenes, and exported
 * games ship the same JSON + runtime. Keep every field concrete (with a
 * default) so the inspector and the AI copilot can edit anything safely.
 */
import { colsFor, normalizeRows, rowsFor } from './tiles.js';

export type EntityKind =
  | 'blob' // playable-looking character
  | 'npc' // character with a story (tap to talk)
  | 'mob' // enemy with HP + AI (chase/patrol/wander/guard)
  | 'boss' // big enemy with a named health bar
  | 'crate'
  | 'lantern'
  | 'plant'
  | 'text'
  | 'button'
  | 'image';

/** Enemy AI (kind 'mob'/'boss'): chase the player, patrol left-right,
 *  wander randomly, or guard a home spot (chase when close, then return). */
export type MobBehavior = 'chase' | 'patrol' | 'wander' | 'guard';

/** No-code events (RPG-Maker style): pick a trigger, stack actions.
 *  Runs in Play mode with zero code — the Code tab stays for power users. */
export type EventTrigger = 'tap' | 'touch' | 'start' | 'every' | 'cleared';

/** Triggers that make sense on an actor ('cleared' is a level-wide fact). */
export const ENTITY_TRIGGERS: readonly EventTrigger[] = ['tap', 'touch', 'start', 'every'];
/** Triggers a LEVEL can carry ('touch' needs a body to touch). */
export const LEVEL_TRIGGERS: readonly EventTrigger[] = ['tap', 'start', 'every', 'cleared'];

export interface EventAction {
  cmd:
    | 'say' // show a message (text)
    | 'coins' // give n coins
    | 'score' // add n score
    | 'xp' // grant n XP (turns leveling on)
    | 'heal' // restore n hearts
    | 'sfx' // play a sound (text: pop|blip|chime|buzz)
    | 'music' // play a music track (text: adventure|cozy|battle|spooky|fanfare|stop)
    | 'vfx' // particle burst (text: confetti|sparkle|poof|hearts|embers|coins)
    | 'item' // give n of database item (text: item id)
    | 'var' // add n to a named variable (text: variable name)
    | 'shop' // open the shop screen (db items with prices)
    | 'inventory' // open the player's inventory
    | 'spawn' // spawn a kind (text) at x/y (defaults: this entity's spot)
    | 'remove' // remove this entity
    | 'goto' // switch to level (text)
    | 'switchOn' // turn switch (text) on
    | 'switchOff' // turn switch (text) off
    | 'win' // end the game victorious (text = message)
    | 'lose'; // end the game defeated (text = message)
  text?: string;
  n?: number;
  x?: number;
  y?: number;
}

/** Every command the runtime knows how to run. Imported projects are
 *  filtered against this so an unknown/typo'd cmd can't ride along as a
 *  dead row in the inspector and the Flow map. */
export const EVENT_CMDS: readonly EventAction['cmd'][] = [
  'say', 'coins', 'score', 'xp', 'heal', 'sfx', 'music', 'vfx', 'item',
  'var', 'shop', 'inventory', 'spawn', 'remove', 'goto', 'switchOn',
  'switchOff', 'win', 'lose',
];

export interface EventDef {
  trigger: EventTrigger;
  /** Seconds between firings for trigger 'every'. */
  every?: number;
  /** Only run while this switch is ON (empty = always). */
  ifSwitch?: string;
  /** Only run while variable (ifVar) is at least ifVarAtLeast (default 1). */
  ifVar?: string;
  ifVarAtLeast?: number;
  /** Fire at most once per play. */
  once?: boolean;
  actions: EventAction[];
}

export type TapSound = '' | 'pop' | 'blip' | 'chime' | 'buzz';

export interface EntityDef {
  id: string;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: number;
  radius: number;
  seed: number;
  text: string;
  fontSize: number;
  /** Key into project.assets for kind 'image'. */
  assetId: string;
  /** Spritesheet animation (kind 'image'): frame size + speed. 0 = static. */
  frameW: number;
  frameH: number;
  fps: number;
  /** Combat (kind 'mob'/'boss'): health, contact damage, XP dropped, AI. */
  hp: number;
  damage: number;
  xp: number;
  moveSpeed: number;
  behavior: MobBehavior;
  /** Ranged: fire a projectile at the player every N secs (0 = never). */
  shootEvery: number;
  /** Behaviors / juice. */
  wobble: boolean;
  popIn: boolean;
  tapSound: TapSound;
  /** Cosmetics (character kinds): hat + held item, drawn code-vector. */
  hat: string;
  held: string;
  /** Named animation clips (kind 'image' spritesheets): frame ranges. */
  clips: { name: string; from: number; to: number; fps: number }[];
  /** Story lines (kind 'npc') — said in order when tapped in Play mode. */
  lines: string[];
  /** No-code events: triggers + action lists (see EventDef). */
  events: EventDef[];
}

/** How the scene is VIEWED (a device rotated to landscape just letterboxes —
 *  that's presentation, not a game style):
 *  - top:   flat top-down world
 *  - depth: 2.5D — higher on screen = further away (auto scale + z-sort);
 *           these worlds default WIDE, so the journey runs long-ways. */
export type SceneView = 'top' | 'depth';

export interface SceneDef {
  id: string;
  name: string;
  background: number;
  view: SceneView;
  /** Physics: gravity + jumping (platformers) — ←→ run, ↑/W/joystick-up jump. */
  gravity: boolean;
  /** World size in design units — up to several screens; the camera follows
   *  the player when the world is bigger than 720x1280. */
  worldW: number;
  worldH: number;
  /** Painted tile grid (worldW/40 x worldH/40 chars) — optional per level. */
  tiles?: string[];
  /** Scene script (the Code tab) — runs when the scene starts in Play mode. */
  script: string;
  /** ⚡ Level events — the same blocks actors carry, owned by the level
   *  itself: start music, run a timer, win when every enemy is down.
   *  Absent (not empty) when the level has none, so projects stay small. */
  events?: EventDef[];
  entities: EntityDef[];
}

/** Public Interverse-world wiring — safe to ship (no secrets, spec §8.4). */
export interface PlatformDef {
  /** Base URL of an Interverse (IVX) node. */
  apiUrl: string;
  /** Registered world game id. */
  gameId: string;
  /** Player wallet address to show chain balance for (optional). */
  wallet: string;
}

/** Content database: project-wide item definitions referenced by id. */
export interface ItemDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** Coin price for api.items.buy (0 = not for sale). */
  price: number;
  /** What using it does. */
  effect: 'none' | 'heal' | 'coins' | 'xp';
  n: number;
}

export interface ProjectDef {
  version: 1;
  name: string;
  /** Wire up the Verium wallet + Interverse hooks in Play/exported games. */
  interverse: boolean;
  /** Multiplayer blocks: Play opens a host/join lobby; players share a room. */
  multiplayer?: boolean;
  /** Optional Interverse-world connection (public fields only). */
  platform?: PlatformDef;
  startScene: string;
  scenes: SceneDef[];
  /** Imported images as data URLs, keyed by asset id. */
  assets: Record<string, string>;
  /** 🗄 Content database (items today; more tables to come). */
  db?: { items: ItemDef[] };
  /** 🌐 Localization: language -> key -> text; strings starting with @key
   *  resolve through this table at play time. */
  locales?: Record<string, Record<string, string>>;
}

let nextId = 1;
export function freshId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function defaultEntity(kind: EntityKind, x: number, y: number): EntityDef {
  const base: EntityDef = {
    id: freshId('e'),
    kind,
    name: kind,
    x: Math.round(x),
    y: Math.round(y),
    scale: 1,
    rotation: 0,
    color: 0xff6f91,
    radius: 34,
    seed: Math.floor(Math.random() * 1000),
    text: '',
    fontSize: 30,
    assetId: '',
    frameW: 0,
    frameH: 0,
    fps: 8,
    hp: 3,
    damage: 1,
    xp: 5,
    moveSpeed: 120,
    behavior: 'chase',
    shootEvery: 0,
    wobble: kind === 'blob' || kind === 'npc' || kind === 'mob' || kind === 'boss',
    popIn: true,
    tapSound: kind === 'button' ? 'blip' : '',
    hat: '',
    held: '',
    clips: [],
    lines: [],
    events: [],
  };
  switch (kind) {
    case 'npc':
      base.color = 0x8fd0ff;
      base.lines = ['Hello, traveler!'];
      break;
    case 'mob':
      base.color = 0xff5b5b;
      base.radius = 28;
      break;
    case 'boss':
      base.color = 0x9d4edd;
      base.radius = 58;
      base.hp = 25;
      base.xp = 50;
      base.moveSpeed = 90;
      base.behavior = 'guard';
      break;
    case 'crate':
      base.color = 0x4a3826;
      break;
    case 'lantern':
      base.color = 0xffd166;
      break;
    case 'plant':
      base.color = 0x2f8d4a;
      break;
    case 'text':
      base.text = 'Your text here';
      base.color = 0xe6e4f0;
      break;
    case 'button':
      base.text = 'TAP ME';
      base.color = 0xffd166;
      break;
    case 'image':
      base.scale = 0.5;
      break;
  }
  return base;
}

export function defaultScene(name: string): SceneDef {
  return {
    id: freshId('s'),
    name,
    background: 0x101018,
    view: 'top',
    gravity: false,
    worldW: 720,
    worldH: 1280,
    script: '',
    entities: [],
  };
}

export function defaultProject(): ProjectDef {
  const scene = defaultScene('Level 1');
  const blob = defaultEntity('blob', 360, 640);
  blob.name = 'Hero';
  scene.entities.push(blob);
  return {
    version: 1,
    name: 'My Game',
    interverse: false,
    startScene: scene.id,
    scenes: [scene],
    assets: {},
  };
}

/** Keep only well-formed events for a scope, and inside them only actions
 *  the runtime can actually run. Shared by actors and levels so a command
 *  can never be legal in one place and junk in the other. */
export function normalizeEvents(input: unknown, scope: 'entity' | 'level'): EventDef[] {
  const triggers = scope === 'level' ? LEVEL_TRIGGERS : ENTITY_TRIGGERS;
  const events = (Array.isArray(input) ? input : []).filter(
    (ev): ev is EventDef =>
      !!ev &&
      typeof ev === 'object' &&
      triggers.includes((ev as EventDef).trigger) &&
      Array.isArray((ev as EventDef).actions),
  );
  for (const ev of events) {
    ev.actions = ev.actions.filter(
      (a) =>
        !!a &&
        typeof a === 'object' &&
        EVENT_CMDS.includes(a.cmd) &&
        // 'remove' means "remove me" — meaningless with no owning actor.
        !(scope === 'level' && a.cmd === 'remove'),
    );
    if (ev.every !== undefined) {
      // 0 is a real number the author typed, not a missing value — clamp it
      // rather than letting `|| 1` silently turn it into a one-second timer.
      const secs = Number(ev.every);
      ev.every = Math.max(0.1, Number.isFinite(secs) ? secs : 1);
    }
  }
  return events;
}

/** Parse + minimally repair an imported project. Throws on hopeless input. */
export function parseProject(json: string): ProjectDef {
  const p = JSON.parse(json) as ProjectDef;
  if (!p || !Array.isArray(p.scenes) || p.scenes.length === 0) {
    throw new Error('Not an Interverse Studio project');
  }
  p.version = 1;
  p.name ||= 'My Game';
  p.interverse = !!p.interverse;
  p.assets ||= {};
  for (const s of p.scenes) {
    s.id ||= freshId('s');
    s.name ||= 'Level';
    s.background ??= 0x101018;
    // Older projects had a 'side' view style — that was really just gravity
    // physics (a rotated device is presentation, not a game style).
    if ((s.view as string) === 'side') {
      s.view = 'top';
      s.gravity = true;
    }
    s.view = s.view === 'depth' ? 'depth' : 'top';
    s.gravity = !!s.gravity;
    s.worldW = Math.max(720, Math.min(2880, Number(s.worldW) || 720));
    s.worldH = Math.max(720, Math.min(2560, Number(s.worldH) || 1280));
    // 2.5D boards are one landscape screen tall — the journey runs long-ways.
    if (s.view === 'depth') s.worldH = 720;
    if (s.tiles !== undefined) s.tiles = normalizeRows(s.tiles, colsFor(s.worldW), rowsFor(s.worldH));
    s.script ??= '';
    s.entities ||= [];
    for (const e of s.entities) {
      const d = defaultEntity(e.kind ?? 'blob', e.x ?? 360, e.y ?? 640);
      Object.assign(d, e);
      Object.assign(e, d);
      if (!['chase', 'patrol', 'wander', 'guard'].includes(e.behavior)) e.behavior = 'chase';
      e.clips = (Array.isArray(e.clips) ? e.clips : []).filter(
        (c) => !!c && typeof c === 'object' && typeof c.name === 'string' && Number.isFinite(c.from) && Number.isFinite(c.to),
      );
      e.events = normalizeEvents(e.events, 'entity');
    }
    // ⚡ Level events use the same blocks, minus the actor-only ones. Kept
    // absent rather than empty so an untouched level adds nothing to the JSON.
    const levelEvents = normalizeEvents(s.events, 'level');
    if (levelEvents.length) s.events = levelEvents;
    else delete s.events;
  }
  if (!p.scenes.some((s) => s.id === p.startScene)) p.startScene = p.scenes[0]!.id;
  // Content database + locales: normalize to well-formed shapes.
  const db = p.db && typeof p.db === 'object' ? p.db : { items: [] };
  db.items = (Array.isArray(db.items) ? db.items : []).filter(
    (i): i is ItemDef => !!i && typeof i === 'object' && typeof (i as ItemDef).id === 'string' && (i as ItemDef).id !== '',
  );
  for (const i of db.items) {
    i.name ||= i.id;
    i.emoji ||= '🎁';
    i.desc ||= '';
    i.price = Math.max(0, Number(i.price) || 0);
    if (!['none', 'heal', 'coins', 'xp'].includes(i.effect)) i.effect = 'none';
    i.n = Math.max(0, Number(i.n) || 0);
  }
  p.db = db;
  if (!p.locales || typeof p.locales !== 'object' || Array.isArray(p.locales)) p.locales = {};
  return p;
}
