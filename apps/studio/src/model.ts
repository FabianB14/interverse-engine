/**
 * Studio project model — a game is DATA. The editor edits these defs, the
 * runtime (runtime.ts) turns them into live engine scenes, and exported
 * games ship the same JSON + runtime. Keep every field concrete (with a
 * default) so the inspector and the AI copilot can edit anything safely.
 */
import { TILE_LAYERS, anyTiles, colsFor, normalizeRows, rowsFor } from './tiles.js';
import { isAttackPattern } from './attacks.js';
import type { AttackPattern } from './attacks.js';

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
  | 'image'
  // 3D-first kinds. In 2D views they draw as simple markers; their real
  // bodies live in the 3D editor and 3D play.
  | 'shape' // primitive geometry: plane / box / ramp
  | 'camera'; // a placed viewpoint — play mode films from here

/** What a 'shape' actor is shaped like. */
export type ShapeType = 'plane' | 'box' | 'ramp';

/** How a 'camera' actor films in 3D play. */
export type CamMode = 'fixed' | 'third' | 'first';

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
    | 'settings' // open the ⚙ settings screen (volumes + language)
    | 'pause' // open the ⏸ pause menu
    | 'title' // show the title / save-slot screen
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
  'var', 'shop', 'inventory', 'settings', 'pause', 'title', 'spawn', 'remove', 'goto', 'switchOn',
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

/** 💬 One thing the player can say back. Choices are what turn a list of
 *  lines into a conversation: they can be hidden until a switch is on, and
 *  they run the SAME action blocks events use, so a reply can pay you,
 *  open a shop, or set the flag that unlocks the next reply. */
export interface DialogueChoiceDef {
  text: string;
  /** Node id to go to. Empty ends the conversation. */
  to: string;
  /** Only offered while this switch is ON. */
  ifSwitch?: string;
  /** Only offered while this variable is at least ifVarAtLeast. */
  ifVar?: string;
  ifVarAtLeast?: number;
  actions?: EventAction[];
}

export interface DialogueNodeDef {
  id: string;
  /** Who is speaking — blank uses the actor's own name. */
  speaker?: string;
  text: string;
  /** Where to go when there are no choices. Empty ends the conversation. */
  next?: string;
  choices?: DialogueChoiceDef[];
}

export interface DialogueDef {
  start: string;
  nodes: DialogueNodeDef[];
}

/** Turn the old flat `lines` into a node chain, so every existing NPC keeps
 *  working and can be opened in the branching editor without conversion. */
export function dialogueFromLines(lines: string[]): DialogueDef {
  const list = lines.length ? lines : ['…'];
  return {
    start: 'n0',
    nodes: list.map((text, i) => ({
      id: `n${i}`,
      text,
      ...(i < list.length - 1 ? { next: `n${i + 1}` } : {}),
    })),
  };
}

export function normalizeDialogue(input: unknown): DialogueDef | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DialogueDef>;
  if (!Array.isArray(raw.nodes)) return null;
  const nodes: DialogueNodeDef[] = [];
  for (const n of raw.nodes) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id) continue;
    const node: DialogueNodeDef = { id: n.id, text: typeof n.text === 'string' ? n.text : '' };
    if (typeof n.speaker === 'string' && n.speaker) node.speaker = n.speaker;
    if (typeof n.next === 'string' && n.next) node.next = n.next;
    const choices = (Array.isArray(n.choices) ? n.choices : [])
      .filter((c): c is DialogueChoiceDef => !!c && typeof c === 'object' && typeof c.text === 'string')
      .map((c) => {
        const out: DialogueChoiceDef = { text: c.text, to: typeof c.to === 'string' ? c.to : '' };
        if (c.ifSwitch) out.ifSwitch = String(c.ifSwitch);
        if (c.ifVar) {
          out.ifVar = String(c.ifVar);
          out.ifVarAtLeast = Number(c.ifVarAtLeast) || 1;
        }
        const acts = (Array.isArray(c.actions) ? c.actions : []).filter(
          (a) => !!a && typeof a === 'object' && EVENT_CMDS.includes(a.cmd) && a.cmd !== 'remove',
        );
        if (acts.length) out.actions = acts;
        return out;
      });
    if (choices.length) node.choices = choices;
    nodes.push(node);
  }
  if (!nodes.length) return null;
  const start = typeof raw.start === 'string' && nodes.some((n) => n.id === raw.start) ? raw.start : nodes[0]!.id;
  return { start, nodes };
}

/** Ids a node points at that do not exist — a dead end the author cannot
 *  see by reading, which is the classic way a dialogue tree breaks. */
export function danglingDialogueLinks(d: DialogueDef): string[] {
  const ids = new Set(d.nodes.map((n) => n.id));
  const bad: string[] = [];
  for (const n of d.nodes) {
    if (n.next && !ids.has(n.next)) bad.push(`${n.id} → ${n.next}`);
    for (const c of n.choices ?? []) {
      if (c.to && !ids.has(c.to)) bad.push(`${n.id} → ${c.to}`);
    }
  }
  return bad;
}

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
  /** Ranged: run the attack pattern every N secs (0 = never). */
  shootEvery: number;
  /** ⚔ What the attack looks like. 'contact' = walk into the player only. */
  attack: AttackPattern;
  /** Behaviors / juice. */
  wobble: boolean;
  popIn: boolean;
  tapSound: TapSound;
  /** Cosmetics (character kinds): hat + held item, drawn code-vector. */
  hat: string;
  held: string;
  /** Named animation clips (kind 'image' spritesheets): frame ranges. */
  clips: { name: string; from: number; to: number; fps: number }[];
  /** Story lines (kind 'npc') — said in order when tapped in Play mode.
   *  Superseded by `dialogue` when that is present; kept so every existing
   *  NPC keeps working untouched. */
  lines: string[];
  /** 💬 Branching conversation: nodes, choices, conditions and actions. */
  dialogue?: DialogueDef;
  /** ⚡ Ability ids this actor owns (see ProjectDef.db.abilities). When the
   *  actor is the player they become on-screen buttons automatically. */
  abilities: string[];
  /** 🌳 Skill tree id this actor uses (see ProjectDef.db.skills). */
  skillTree: string;
  /** No-code events: triggers + action lists (see EventDef). */
  events: EventDef[];
  /** 🧊 3D model slot: '@assetId' of an uploaded .glb, or a URL. Used by
   *  the 3D view; 2D views ignore it. Empty = code-drawn stand-in. */
  model3d: string;
  /** kind 'shape': which primitive, and its size in design units. */
  shapeType: ShapeType;
  sizeX: number;
  sizeZ: number;
  sizeH: number;
  /** kind 'camera': eye height and pull-back distance for play mode. */
  camHeight: number;
  camDist: number;
  /** kind 'camera': how play films. 'fixed' shoots from where the camera
   *  stands; 'third' chases behind the player; 'first' looks through the
   *  player's eyes. */
  camMode: CamMode;
  /** Clip names inside the model, for characters/NPCs/mobs: what plays
   *  standing still and what plays moving. Empty = the model's first clip. */
  animIdle: string;
  animMove: string;
  /** 🔊 SFX slot: named moments -> sounds. Every actor has one. */
  sfxSlot: { on: ActorEvent; sound: TapSound }[];
  /** ✨ VFX slot: named moments -> particle presets. Every actor has one. */
  vfxSlot: { on: ActorEvent; preset: string }[];
}

/** The moments an actor's sfx/vfx slots can hook. */
export type ActorEvent = 'spawn' | 'tap' | 'hit' | 'down';
export const ACTOR_EVENTS: readonly ActorEvent[] = ['spawn', 'tap', 'hit', 'down'];

/** How the scene is VIEWED (a device rotated to landscape just letterboxes —
 *  that's presentation, not a game style):
 *  - top:   flat top-down world
 *  - depth: 2.5D — higher on screen = further away (auto scale + z-sort);
 *           these worlds default WIDE, so the journey runs long-ways. */
export type SceneView = 'top' | 'depth' | '3d';

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
  /** 🥞 Decorative tile layers: behind everything, and over the actors.
   *  Absent when unpainted, so a game that never uses them costs nothing. */
  tilesBack?: string[];
  tilesOver?: string[];
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

/** ⚡ What an ability DOES, chosen from a list instead of written in code.
 *  These are the verbs the runtime knows how to perform natively. */
export type AbilityEffect = 'melee' | 'ranged' | 'heal' | 'dash' | 'spawn' | 'custom';

/** An ability an actor OWNS. Granting one to the player draws its button
 *  on screen automatically — no api.ability() call needed. */
export interface AbilityDef {
  id: string;
  name: string;
  /** Built-in icon id ('sword','fire','bolt','snow','shield','boot','heart',
   *  'star'), an emoji, or '@assetId' for imported art. */
  icon: string;
  effect: AbilityEffect;
  /** Damage · hearts healed · dash distance — whatever the effect measures. */
  power: number;
  /** Melee reach, or projectile speed for 'ranged'. */
  radius: number;
  /** Seconds before it can be used again. */
  cooldown: number;
  /** Optional keyboard shortcut (handy in the editor; phones use the button). */
  key: string;
  /** Particle burst when it fires. */
  vfx: string;
  sfx: TapSound;
  /** Actor kind spawned by the 'spawn' effect. */
  spawn: EntityKind;
  /** Body of the 'custom' effect — runs with `api` in scope. */
  script: string;
}

export const ABILITY_EFFECTS: readonly AbilityEffect[] = ['melee', 'ranged', 'heal', 'dash', 'spawn', 'custom'];

export function defaultAbility(id: string, name = id): AbilityDef {
  return {
    id,
    name,
    icon: 'sword',
    effect: 'melee',
    power: 1,
    radius: 130,
    cooldown: 0.6,
    key: '',
    vfx: '',
    sfx: 'pop',
    spawn: 'crate',
    script: '',
  };
}

/** 🎮 One named thing the player can do. Keys and the on-screen button are
 *  two BINDINGS of the same action, which is what lets a phone player and a
 *  keyboard player share one game — the Unity/Godot input-map idea, shrunk
 *  to something a kid can fill in. */
export interface ActionDef {
  /** 'move-left' … 'interact' for builtins; an ability's name otherwise. */
  id: string;
  label: string;
  /** Lowercased `e.key` values. Several keys may drive one action. */
  keys: string[];
  /** Draw an on-screen button (steering uses the joystick instead). */
  button: boolean;
  /** Built-in icon id, or '@assetId' for imported art. */
  icon: string;
  /** Builtins cannot be deleted — a game with no "move left" is broken. */
  builtin: boolean;
}

export interface ControlsDef {
  actions: ActionDef[];
  /** How phones steer. */
  touch: 'joystick' | 'dpad';
}

export const BUILTIN_ACTIONS = ['move-left', 'move-right', 'move-up', 'move-down', 'jump', 'interact'] as const;

/** The keys the engine has always used, now written down instead of baked
 *  into the movement loop. A unit test pins these against a snapshot so a
 *  typo can never quietly rebind everyone's arrow keys. */
export function defaultControls(): ControlsDef {
  return {
    touch: 'joystick',
    actions: [
      { id: 'move-left', label: '⬅ Move left', keys: ['arrowleft', 'a'], button: false, icon: 'boot', builtin: true },
      { id: 'move-right', label: '➡ Move right', keys: ['arrowright', 'd'], button: false, icon: 'boot', builtin: true },
      { id: 'move-up', label: '⬆ Move up', keys: ['arrowup', 'w'], button: false, icon: 'boot', builtin: true },
      { id: 'move-down', label: '⬇ Move down', keys: ['arrowdown', 's'], button: false, icon: 'boot', builtin: true },
      { id: 'jump', label: '⤴ Jump', keys: [' '], button: true, icon: 'boot', builtin: true },
      { id: 'interact', label: '🤝 Talk / use', keys: ['e', 'enter'], button: false, icon: 'star', builtin: true },
    ],
  };
}

/** Where a HUD piece sits. Anchors instead of coordinates, because a phone
 *  in portrait and a tablet in landscape are different sizes and "16px from
 *  the top-left" is the only thing that means the same in both. */
export type HudAnchor = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface HudElement {
  anchor: HudAnchor;
  /** Offset from that corner, in design units, always pointing INWARD. */
  dx: number;
  dy: number;
  scale: number;
  show: boolean;
}

export type HudPart = 'hearts' | 'score' | 'coins' | 'level' | 'abilities' | 'joystick';

export const HUD_PARTS: readonly HudPart[] = ['hearts', 'score', 'coins', 'level', 'abilities', 'joystick'];

export interface HudDef {
  parts: Record<HudPart, HudElement>;
  /** Keep-out band for notches and home indicators, in design units. */
  safeTop: number;
  safeBottom: number;
}

/** The layout the engine has always drawn, now written down. A snapshot
 *  test pins these so a stray edit cannot silently move every game's HUD. */
export function defaultHud(): HudDef {
  const el = (anchor: HudAnchor, dx: number, dy: number): HudElement => ({ anchor, dx, dy, scale: 1, show: true });
  return {
    parts: {
      hearts: el('top-left', 16, 12),
      score: el('top-right', 16, 12),
      coins: el('top-left', 16, 54),
      level: el('top-center', 0, 16),
      abilities: el('bottom-right', 84, 96),
      joystick: el('bottom-left', 150, 170),
    },
    safeTop: 0,
    safeBottom: 0,
  };
}

/** Resolve an element to a screen position for a given viewport. */
export function hudPos(el: HudElement, W: number, H: number, safeTop = 0, safeBottom = 0): { x: number; y: number } {
  const top = el.anchor.startsWith('top');
  const y = top ? safeTop + el.dy : H - safeBottom - el.dy;
  let x = el.dx;
  if (el.anchor.endsWith('center')) x = W / 2 + el.dx;
  else if (el.anchor.endsWith('right')) x = W - el.dx;
  return { x, y };
}

export function normalizeHud(input: unknown): HudDef {
  const base = defaultHud();
  const raw = input && typeof input === 'object' ? (input as Partial<HudDef>) : {};
  const parts = (raw.parts ?? {}) as Partial<Record<HudPart, Partial<HudElement>>>;
  const anchors: readonly HudAnchor[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  for (const key of HUD_PARTS) {
    const got = parts[key];
    if (!got || typeof got !== 'object') continue;
    const cur = base.parts[key];
    if (got.anchor && anchors.includes(got.anchor)) cur.anchor = got.anchor;
    if (Number.isFinite(Number(got.dx))) cur.dx = Number(got.dx);
    if (Number.isFinite(Number(got.dy))) cur.dy = Number(got.dy);
    if (Number.isFinite(Number(got.scale))) cur.scale = Math.max(0.4, Math.min(2.5, Number(got.scale)));
    if (typeof got.show === 'boolean') cur.show = got.show;
  }
  base.safeTop = Math.max(0, Math.min(200, Number(raw.safeTop) || 0));
  base.safeBottom = Math.max(0, Math.min(200, Number(raw.safeBottom) || 0));
  return base;
}

/** True when the HUD is untouched, so it can be left out of the file. */
export function isDefaultHud(h: HudDef): boolean {
  return JSON.stringify(h) === JSON.stringify(defaultHud());
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
  /** 🎛 HUD layout (absent = the engine defaults). */
  hud?: HudDef;
  /** 🎮 Key + on-screen button bindings (absent = engine defaults). */
  controls?: ControlsDef;
  /** 🗄 Content database (items today; more tables to come). */
  db?: {
    items: ItemDef[];
    /** ⚡ Abilities actors can be given. */
    abilities?: AbilityDef[];
    /** 🌳 Named skill trees, id -> tree definition (see skilltree.ts). */
    skills?: Record<string, unknown>;
  };
  /** 🌐 Localization: language -> key -> text; strings starting with @key
   *  resolve through this table at play time. */
  locales?: Record<string, Record<string, string>>;
}

let nextId = 1;
export function freshId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

/**
 * How tall the ground is on a shape at a world point — the walkable half
 * of primitives, as pure maths so it tests without a renderer.
 *
 * Query is in the same 2D world coordinates entities use (x right, y
 * down = 3D z). Rotation is honored by spinning the query point into the
 * shape's local frame — the shape does not care which way it faces, the
 * point does. Returns 0 off the shape: flat ground.
 */
export function shapeHeightAt(e: EntityDef, wx: number, wy: number): number {
  if (e.kind !== 'shape') return 0;
  const cos = Math.cos(-e.rotation);
  const sin = Math.sin(-e.rotation);
  const dx = wx - e.x;
  const dy = wy - e.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  if (Math.abs(lx) > e.sizeX / 2 || Math.abs(ly) > e.sizeZ / 2) return 0;
  if (e.shapeType === 'plane') return 6;
  if (e.shapeType === 'box') return Math.max(10, e.sizeH);
  // Ramp: rises along local +Y (screen-down / 3D +z), 0 at the near edge
  // to sizeH at the far one — matching the tipped box the editor draws.
  const t = ly / e.sizeZ + 0.5;
  return Math.max(0, Math.min(1, t)) * Math.max(10, e.sizeH);
}

/** Ground height across every shape in a scene — highest wins, so a box
 *  on a plane is stood on, not stood inside. */
export function groundHeightAt(scene: SceneDef, wx: number, wy: number): number {
  let h = 0;
  for (const e of scene.entities) h = Math.max(h, shapeHeightAt(e, wx, wy));
  return h;
}

/** How big a step legs can take. Rises above this are WALLS. */
export const STEP_LIMIT = 48;

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
    attack: 'contact',
    wobble: kind === 'blob' || kind === 'npc' || kind === 'mob' || kind === 'boss',
    popIn: true,
    tapSound: kind === 'button' ? 'blip' : '',
    hat: '',
    held: '',
    clips: [],
    lines: [],
    abilities: [],
    skillTree: '',
    events: [],
    model3d: '',
    shapeType: kind === 'shape' ? 'box' : 'plane',
    sizeX: 240,
    sizeZ: 240,
    sizeH: kind === 'shape' ? 80 : 0,
    camHeight: 420,
    camDist: 520,
    camMode: 'fixed',
    animIdle: '',
    animMove: '',
    sfxSlot: [],
    vfxSlot: [],
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
      base.attack = 'ring';
      base.shootEvery = 2.6;
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

/** Merge a stored control table over the defaults: every builtin survives
 *  (with its stored keys), custom actions are kept if they are well formed,
 *  and junk is dropped. */
export function normalizeControls(input: unknown): ControlsDef {
  const base = defaultControls();
  const raw = input && typeof input === 'object' ? (input as Partial<ControlsDef>) : {};
  const stored = Array.isArray(raw.actions) ? raw.actions : [];
  const clean = (a: unknown): ActionDef | null => {
    if (!a || typeof a !== 'object') return null;
    const d = a as Partial<ActionDef>;
    if (typeof d.id !== 'string' || !d.id) return null;
    return {
      id: d.id,
      label: typeof d.label === 'string' && d.label ? d.label : d.id,
      keys: (Array.isArray(d.keys) ? d.keys : []).filter((k): k is string => typeof k === 'string' && k.length > 0).map((k) => k.toLowerCase()),
      button: !!d.button,
      icon: typeof d.icon === 'string' && d.icon ? d.icon : 'star',
      builtin: BUILTIN_ACTIONS.includes(d.id as (typeof BUILTIN_ACTIONS)[number]),
    };
  };
  const byId = new Map(base.actions.map((a) => [a.id, a]));
  for (const a of stored) {
    const c = clean(a);
    if (c) byId.set(c.id, c);
  }
  // Builtins keep their canonical order, then customs in stored order.
  const actions = [
    ...BUILTIN_ACTIONS.map((id) => byId.get(id)!),
    ...[...byId.values()].filter((a) => !a.builtin),
  ];
  return { touch: raw.touch === 'dpad' ? 'dpad' : 'joystick', actions };
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
    s.view = s.view === 'depth' || s.view === '3d' ? s.view : 'top';
    s.gravity = !!s.gravity;
    s.worldW = Math.max(720, Math.min(2880, Number(s.worldW) || 720));
    s.worldH = Math.max(720, Math.min(2560, Number(s.worldH) || 1280));
    // 2.5D boards are one landscape screen tall — the journey runs long-ways.
    if (s.view === 'depth') s.worldH = 720;
    for (const layer of TILE_LAYERS) {
      const rows = (s as unknown as Record<string, unknown>)[layer.key];
      if (rows === undefined) continue;
      const fixed = normalizeRows(rows, colsFor(s.worldW), rowsFor(s.worldH));
      // An empty decorative layer is the same as not having one — drop it
      // rather than writing a screenful of dots into every saved file.
      if (layer.key !== 'tiles' && !anyTiles(fixed)) delete (s as unknown as Record<string, unknown>)[layer.key];
      else (s as unknown as Record<string, unknown>)[layer.key] = fixed;
    }
    s.script ??= '';
    s.entities ||= [];
    for (const e of s.entities) {
      // Read these BEFORE the defaults are merged in: telling an old project
      // apart from a new one is exactly a question about what it did or did
      // not say, and after the merge everything says everything.
      const said = e as { attack?: unknown; shootEvery?: unknown };
      const saidAttack = said.attack;
      const saidTimer = Number(said.shootEvery) > 0;
      const isOldFile = 'attack' in said === false && 'shootEvery' in said;
      const d = defaultEntity(e.kind ?? 'blob', e.x ?? 360, e.y ?? 640);
      Object.assign(d, e);
      Object.assign(e, d);
      if (!['chase', 'patrol', 'wander', 'guard'].includes(e.behavior)) e.behavior = 'chase';
      // Projects made before attack patterns existed said "shoots every N"
      // and meant one aimed shot, so that is exactly what they keep meaning.
      if (!isAttackPattern(saidAttack)) {
        e.attack = isOldFile || saidAttack !== undefined ? (saidTimer ? 'aimed' : 'contact') : d.attack;
      }
      e.clips = (Array.isArray(e.clips) ? e.clips : []).filter(
        (c) => !!c && typeof c === 'object' && typeof c.name === 'string' && Number.isFinite(c.from) && Number.isFinite(c.to),
      );
      const dlg = normalizeDialogue(e.dialogue);
      if (dlg) e.dialogue = dlg;
      else delete e.dialogue;
      e.abilities = (Array.isArray(e.abilities) ? e.abilities : []).filter((a): a is string => typeof a === 'string' && !!a);
      e.skillTree = typeof e.skillTree === 'string' ? e.skillTree : '';
      e.events = normalizeEvents(e.events, 'entity');
      // 🧊 The 3D + slot fields: absent in every project saved before they
      // existed, so they repair to their defaults rather than to undefined.
      e.model3d = typeof e.model3d === 'string' ? e.model3d : '';
      e.animIdle = typeof e.animIdle === 'string' ? e.animIdle : '';
      e.animMove = typeof e.animMove === 'string' ? e.animMove : '';
      const isEvent = (v: unknown): v is ActorEvent =>
        typeof v === 'string' && (ACTOR_EVENTS as readonly string[]).includes(v);
      e.sfxSlot = (Array.isArray(e.sfxSlot) ? e.sfxSlot : []).filter(
        (x) => !!x && typeof x === 'object' && isEvent(x.on) && typeof x.sound === 'string',
      );
      e.vfxSlot = (Array.isArray(e.vfxSlot) ? e.vfxSlot : []).filter(
        (x) => !!x && typeof x === 'object' && isEvent(x.on) && typeof x.preset === 'string',
      );
      if (!['fixed', 'third', 'first'].includes(e.camMode)) e.camMode = 'fixed';
    }
    // ⚡ Level events use the same blocks, minus the actor-only ones. Kept
    // absent rather than empty so an untouched level adds nothing to the JSON.
    const levelEvents = normalizeEvents(s.events, 'level');
    if (levelEvents.length) s.events = levelEvents;
    else delete s.events;
  }
  if (!p.scenes.some((s) => s.id === p.startScene)) p.startScene = p.scenes[0]!.id;
  // 🎮 Controls: repair to a table that always has every builtin action, so
  // the movement loop can never find itself with no binding for "left".
  p.controls = normalizeControls(p.controls);
  // 🎛 HUD: absent when untouched, like level events and ability tables.
  const hud = normalizeHud(p.hud);
  if (isDefaultHud(hud)) delete p.hud;
  else p.hud = hud;
  // Content database + locales: normalize to well-formed shapes.
  const db = p.db && typeof p.db === 'object' ? p.db : { items: [] };
  db.items = (Array.isArray(db.items) ? db.items : []).filter(
    (i): i is ItemDef => !!i && typeof i === 'object' && typeof (i as ItemDef).id === 'string' && (i as ItemDef).id !== '',
  );
  db.abilities = (Array.isArray(db.abilities) ? db.abilities : []).filter(
    (a): a is AbilityDef => !!a && typeof a === 'object' && typeof a.id === 'string' && a.id !== '',
  );
  for (const a of db.abilities) {
    const d = defaultAbility(a.id, a.name || a.id);
    // Keep what the author set, repair what they did not.
    a.name = a.name || d.name;
    a.icon = a.icon || d.icon;
    if (!ABILITY_EFFECTS.includes(a.effect)) a.effect = d.effect;
    a.power = Number.isFinite(Number(a.power)) ? Number(a.power) : d.power;
    a.radius = Number.isFinite(Number(a.radius)) ? Number(a.radius) : d.radius;
    a.cooldown = Math.max(0, Number(a.cooldown) || 0);
    a.key = typeof a.key === 'string' ? a.key.toLowerCase() : '';
    a.vfx = typeof a.vfx === 'string' ? a.vfx : '';
    a.sfx = (['', 'pop', 'blip', 'chime', 'buzz'] as const).includes(a.sfx) ? a.sfx : 'pop';
    a.spawn = a.spawn || d.spawn;
    a.script = typeof a.script === 'string' ? a.script : '';
  }
  // Absent rather than empty, like level events — a project that uses no
  // abilities should not carry an empty table in every saved file.
  if (!db.abilities.length) delete db.abilities;
  if (!db.skills || typeof db.skills !== 'object' || !Object.keys(db.skills).length) delete db.skills;
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
