/**
 * Project runtime — turns EntityDefs into live engine display objects.
 * The editor uses buildView() for static WYSIWYG; PlayScene runs the real
 * thing: behaviors, tap sounds, NPC dialogue, and the scene script.
 */
import { AnimatedSprite, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  Camera,
  DialogueRunner,
  Entity,
  Scene,
  Tween,
  VirtualJoystick,
  Wobble,
  audio,
  blobCharacter,
  burst,
  createSave,
  darken,
  easings,
  lighten,
  makeTappable,
  moveWithCollision,
  verium,
} from '@interverse/engine';
import type { DialogueData, Game, MusicTrackId, SaveStore, TileMapData, VfxPreset } from '@interverse/engine';
import { DialogueBox, UIButton } from '@interverse/ui';
import { fetchChainBalance } from '@interverse/platform';
import { drawOutfit } from './cosmetics.js';
import { drawIcon } from './icons.js';
import { defaultEntity } from './model.js';
import type { EntityDef, EntityKind, EventAction, EventDef, ProjectDef, SceneDef, TapSound } from './model.js';
import { SkillTree } from './skills.js';
import type { SkillTreeDef } from './skills.js';
import type { StudioNet } from './net.js';
import { generateRows } from './gen.js';
import { anyTiles, buildTileLayer } from './tiles.js';

// ---- 🌐 localization: strings starting with @key resolve per-language ----
let localeTable: Record<string, Record<string, string>> = {};
let currentLang = 'en';
try {
  currentLang = window.localStorage.getItem('interverse.lang') ?? navigator.language.slice(0, 2) ?? 'en';
} catch {
  /* headless */
}

export function setLocaleTable(t: Record<string, Record<string, string>> | undefined): void {
  localeTable = t ?? {};
}

export function setLang(lang: string): void {
  currentLang = lang;
  try {
    window.localStorage.setItem('interverse.lang', lang);
  } catch {
    /* private mode */
  }
}

/** Resolve '@key' through the project's language table (falls back en → key). */
export function tr(text: string): string {
  if (!text.startsWith('@')) return text;
  const key = text.slice(1);
  return localeTable[currentLang]?.[key] ?? localeTable.en?.[key] ?? key;
}

const textureCache = new Map<string, Texture>();

function assetTexture(dataUrl: string, onReady: (tex: Texture) => void): void {
  const hit = textureCache.get(dataUrl);
  if (hit) return onReady(hit);
  const img = new Image();
  img.onload = () => {
    const tex = Texture.from(img);
    textureCache.set(dataUrl, tex);
    onReady(tex);
  };
  img.src = dataUrl;
}

/** 2.5D plays like Castle Crashers: the board is ONE LANDSCAPE SCREEN tall
 *  (720) with a backdrop above the horizon and a walkable ground band below
 *  it; the journey runs left-to-right. Characters keep near-constant size —
 *  depth reads through z-sorting and a SUBTLE far/near scale, not fake 3D. */
export const DEPTH_WORLD_H = 720;
export const DEPTH_MIN_Y = 320; // players can't walk above the horizon
/** In depth view, up/down is a slower lane than the run (brawler feel). */
export const DEPTH_LANE_SPEED = 0.6;
export function depthScale(y: number): number {
  const t = (y - DEPTH_MIN_Y) / (DEPTH_WORLD_H - DEPTH_MIN_Y);
  return 0.82 + Math.max(0, Math.min(1, t)) * 0.18;
}

/**
 * Every view is root Entity → `pop` wrapper → `body` wrapper → visuals.
 * The root carries the author's transform; pop-in scales POP; wobble scales
 * BODY. Each animation owns its own container, so none can sample another's
 * mid-animation scale as its baseline — that interaction (Wobble capturing
 * pop-in's 0.01) was the bug that made blobs vanish on Play.
 */
export const viewPop = new WeakMap<Entity, Container>();
export const viewBody = new WeakMap<Entity, Container>();
/** Per-actor cosmetics layer — redrawn in place by api.outfit. */
export const viewOutfit = new WeakMap<Entity, Graphics>();
/** Spritesheet registries for imported models: all frames + live sprite. */
export const viewFrames = new WeakMap<Entity, Texture[]>();
export const viewSprite = new WeakMap<Entity, AnimatedSprite>();

/** Build the visual for a def. Static — no behaviors, no interactivity. */
export function buildView(def: EntityDef, assets: Record<string, string>): Entity {
  const e = new Entity();
  const pop = new Container();
  e.addChild(pop);
  const body = new Container();
  pop.addChild(body);
  viewPop.set(e, pop);
  viewBody.set(e, body);
  const g = new Graphics();
  switch (def.kind) {
    case 'blob':
    case 'npc': {
      const char = blobCharacter({ radius: def.radius, color: def.color, seed: def.seed });
      body.addChild(char.view);
      if (def.kind === 'npc') {
        // little speech bubble so authors can tell NPCs apart
        g.roundRect(def.radius * 0.5, -def.radius * 1.6, 44, 30, 10)
          .fill(0xffffff)
          .poly([
            def.radius * 0.7,
            -def.radius * 1.6 + 28,
            def.radius * 0.62,
            -def.radius * 1.6 + 44,
            def.radius * 0.98,
            -def.radius * 1.6 + 28,
          ])
          .fill(0xffffff)
          .circle(def.radius * 0.5 + 12, -def.radius * 1.6 + 15, 3)
          .fill(0x444)
          .circle(def.radius * 0.5 + 22, -def.radius * 1.6 + 15, 3)
          .fill(0x444)
          .circle(def.radius * 0.5 + 32, -def.radius * 1.6 + 15, 3)
          .fill(0x444);
        body.addChild(g);
      }
      {
        const outfit = new Graphics();
        drawOutfit(outfit, def);
        body.addChild(outfit);
        viewOutfit.set(e, outfit);
      }
      break;
    }
    case 'mob':
    case 'boss': {
      const char = blobCharacter({ radius: def.radius, color: def.color, seed: def.seed });
      body.addChild(char.view);
      const r = def.radius;
      // angry brows so enemies read as enemies at a glance
      g.moveTo(-r * 0.55, -r * 0.52)
        .lineTo(-r * 0.12, -r * 0.28)
        .moveTo(r * 0.55, -r * 0.52)
        .lineTo(r * 0.12, -r * 0.28)
        .stroke({ color: darken(def.color, 0.6), width: Math.max(3, r * 0.14), cap: 'round' });
      if (def.kind === 'boss') {
        g.poly([-r * 0.65, -r * 0.5, -r * 0.95, -r * 1.2, -r * 0.3, -r * 0.75]).fill(
          darken(def.color, 0.35),
        );
        g.poly([r * 0.65, -r * 0.5, r * 0.95, -r * 1.2, r * 0.3, -r * 0.75]).fill(
          darken(def.color, 0.35),
        );
      }
      body.addChild(g);
      {
        const outfit = new Graphics();
        drawOutfit(outfit, def);
        body.addChild(outfit);
        viewOutfit.set(e, outfit);
      }
      break;
    }
    case 'crate': {
      const s = def.radius * 2;
      g.roundRect(-s / 2, -s / 2, s, s, 6).fill(def.color);
      g.roundRect(-s / 2, -s / 2, s, s, 6).stroke({ color: darken(def.color, 0.4), width: 4 });
      g.moveTo(-s / 2, -s / 2)
        .lineTo(s / 2, s / 2)
        .moveTo(s / 2, -s / 2)
        .lineTo(-s / 2, s / 2)
        .stroke({ color: darken(def.color, 0.4), width: 3, alpha: 0.7 });
      body.addChild(g);
      break;
    }
    case 'lantern': {
      g.roundRect(-6, -10, 12, 46, 4).fill(0x2a2740);
      g.circle(0, -26, 18).fill(lighten(def.color, 0.25));
      g.circle(0, -26, 18).stroke({ color: def.color, width: 3 });
      g.circle(0, -26, 34).fill({ color: def.color, alpha: 0.18 });
      body.addChild(g);
      break;
    }
    case 'plant': {
      g.roundRect(-20, 16, 40, 26, 6).fill(0x7a4a35);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.ellipse(Math.cos(a) * 18, -6 + Math.sin(a) * 16, 17, 12).fill(
          i % 2 ? def.color : darken(def.color, 0.3),
        );
      }
      g.ellipse(0, -10, 15, 12).fill(def.color);
      body.addChild(g);
      break;
    }
    case 'text': {
      const t = new Text({
        text: tr(def.text) || ' ',
        style: {
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
          fontSize: def.fontSize,
          fontWeight: '800',
          fill: def.color,
          align: 'center',
        },
      });
      t.anchor.set(0.5);
      body.addChild(t);
      break;
    }
    case 'button': {
      const w = Math.max(160, tr(def.text).length * def.fontSize * 0.62 + 60);
      const h = Math.max(84, def.fontSize + 44);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(def.color);
      body.addChild(g);
      const t = new Text({
        text: tr(def.text) || ' ',
        style: {
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
          fontSize: def.fontSize,
          fontWeight: '800',
          fill: darken(def.color, 0.75),
          align: 'center',
        },
      });
      t.anchor.set(0.5);
      body.addChild(t);
      break;
    }
    case 'image': {
      const url = assets[def.assetId];
      if (url) {
        assetTexture(url, (tex) => {
          // Spritesheet: slice into frameW x frameH cells (row-major) and
          // play them as a frame animation at `fps`. frameW 0 = static image.
          if (def.frameW > 0 && def.frameH > 0 && tex.width >= def.frameW) {
            const frames: Texture[] = [];
            for (let fy = 0; fy + def.frameH <= tex.height; fy += def.frameH) {
              for (let fx = 0; fx + def.frameW <= tex.width; fx += def.frameW) {
                frames.push(
                  new Texture({
                    source: tex.source,
                    frame: new Rectangle(fx, fy, def.frameW, def.frameH),
                  }),
                );
              }
            }
            const all = frames.length ? frames : [tex];
            const sp = new AnimatedSprite(all);
            sp.anchor.set(0.5);
            sp.animationSpeed = Math.max(0.5, def.fps || 8) / 60;
            sp.play();
            body.addChildAt(sp, 0);
            viewFrames.set(e, all);
            viewSprite.set(e, sp);
          } else {
            const sp = new Sprite(tex);
            sp.anchor.set(0.5);
            body.addChildAt(sp, 0);
          }
        });
      } else {
        g.roundRect(-40, -40, 80, 80, 8).fill({ color: 0xffffff, alpha: 0.1 });
        g.roundRect(-40, -40, 80, 80, 8).stroke({ color: 0x9a97b8, width: 2 });
        body.addChild(g);
      }
      break;
    }
  }
  e.position.set(def.x, def.y);
  e.scale.set(def.scale);
  e.rotation = def.rotation;
  return e;
}

function playSound(s: TapSound): void {
  if (s === 'pop') audio.pop();
  else if (s === 'blip') audio.blip();
  else if (s === 'chime') audio.chime();
  else if (s === 'buzz') audio.buzz();
}

function dialogueFor(def: EntityDef): DialogueData {
  const nodes: DialogueData['nodes'] = {};
  const lines = (def.lines.length ? def.lines : ['…']).map(tr);
  lines.forEach((text, i) => {
    nodes[`n${i}`] = {
      speaker: def.name,
      text,
      ...(i < lines.length - 1 ? { next: `n${i + 1}` } : {}),
    };
  });
  return { start: 'n0', nodes };
}

/** The API handed to scene scripts (the Code tab). */
export interface ScriptApi {
  scene: Scene;
  game: Game;
  sfx: typeof audio;
  verium: typeof verium;
  entity: (name: string) => Entity | undefined;
  entities: () => Record<string, Entity>;
  onUpdate: (cb: (dt: number) => void) => void;
  goto: (sceneName: string) => void;
  spawn: (kind: EntityDef['kind'], x: number, y: number) => Entity;
  say: (speaker: string, ...lines: string[]) => void;
  /** Make an entity player-controlled (arrow keys / WASD + touch joystick). */
  player: (name: string, speed?: number) => Entity | undefined;
  /** Score with an auto HUD (top-right). */
  score: { add: (n: number) => void; set: (n: number) => void; get: () => number };
  /** Run cb every `secs` seconds. */
  every: (secs: number, cb: () => void) => void;
  /** Run cb once after `secs` seconds. */
  after: (secs: number, cb: () => void) => void;
  /** Are two entities (by name or ref) within dist of each other? */
  overlap: (a: string | Entity, b: string | Entity, dist: number) => boolean;
  /** (Re)bind a tap handler on an entity (by name or reference). */
  onTap: (target: string | Entity, cb: () => void) => void;
  /** Remove an entity from the scene. */
  remove: (target: string | Entity) => void;
  /** Random number in [min, max). */
  random: (min: number, max: number) => number;
  /** Animate x/y/rotation/alpha/scale over secs (property animation). */
  tween: (
    target: string | Entity,
    props: Partial<{ x: number; y: number; rotation: number; alpha: number; scale: number }>,
    secs: number,
  ) => void;
  /** On-screen ability button (bottom-right cluster): built-in icon id
   *  ('sword','fire','bolt','snow','shield','boot','heart','star') or an
   *  imported image via '@<assetId>'; optional cooldown secs + hotkey. */
  ability: (
    name: string,
    opts: { icon?: string; cooldown?: number; key?: string },
    cb: () => void,
  ) => void;
  /** Hit every mob within radius of the player for dmg. Returns hits. */
  meleeAttack: (radius?: number, dmg?: number) => number;
  /** Damage a mob/boss by name (or entity ref) directly. */
  hurt: (target: string, dmg: number) => void;
  /** Current HP of a mob/boss (0 when defeated/unknown). */
  hpOf: (target: string) => number;
  /** Called whenever any mob or boss is defeated (gets its name). */
  onDefeat: (cb: (name: string) => void) => void;
  /** Walk an entity along waypoints in a loop (great for town NPCs):
   *  api.patrol('Villager', [[160, 300], [560, 300]], 90). */
  patrol: (target: string | Entity, points: [number, number][], speed?: number) => void;
  /** Player hearts HUD; contact with mobs costs hearts, 0 = game over.
   *  (Auto-enabled at 3 when a player + mobs share a scene.) */
  hearts: (n: number) => void;
  /** XP + level HUD; mob defeats grant their XP, each level-up awards a
   *  skill point into api.skills. */
  levels: (opts?: { xpPerLevel?: number }) => void;
  xp: { add: (n: number) => void; get: () => number };
  level: () => number;
  /** In-game save file (per game, on this device): survives closing the
   *  game. Values must be JSON-serializable. */
  save: {
    set: (key: string, value: unknown) => void;
    get: <T>(key: string, fallback: T) => T;
    remove: (key: string) => void;
    clear: () => void;
  };
  /** Coins dropped by defeated mobs (picked up by walking over them);
   *  the balance persists in the game's save file. */
  coins: { get: () => number; add: (n: number) => void; spend: (n: number) => boolean };
  /** Named on/off switches — shared with the no-code event system
   *  ("only if switch" gates), so code and event blocks interoperate. */
  switches: { on: (name: string) => void; off: (name: string) => void; isOn: (name: string) => boolean };
  /** Looping chiptune BGM ('adventure'|'cozy'|'battle'|'spooky'), a
   *  victory fanfare that ducks + resumes the BGM, and volume buses. */
  music: {
    play: (id: MusicTrackId) => void;
    stop: () => void;
    fanfare: () => void;
    current: () => MusicTrackId | null;
    setVolume: (bus: 'master' | 'music' | 'sfx', v: number) => void;
  };
  /** One-shot particle burst: 'confetti'|'sparkle'|'poof'|'hearts'|'embers'|'coins'. */
  vfx: (preset: VfxPreset, x: number, y: number) => void;
  /** Restyle a character live: hats ('cap','crown','wizard','bow','horns',
   *  'halo') and held items ('sword','shield','staff','lantern','flower').
   *  Pair with api.coins.spend for cosmetic shops. */
  outfit: (target: string, opts: { hat?: string; held?: string }) => void;
  /** Play a named animation clip on an imported spritesheet model
   *  (define clips in the inspector: name + frame range + fps). */
  playClip: (target: string, clipName: string) => void;
  /** 🗄 Database items: give/count/use/buy against project.db.items;
   *  open() shows the player's inventory (tap an item to use it). */
  items: {
    give: (id: string, count?: number) => boolean;
    count: (id: string) => number;
    use: (id: string) => boolean;
    buy: (id: string) => boolean;
    list: () => { id: string; name: string; emoji: string; price: number }[];
    open: () => void;
  };
  /** Numeric variables — the counters behind quest progress, kill
   *  tallies, anything "needs at least N". Shared with event gates. */
  vars: { get: (name: string) => number; set: (name: string, v: number) => void; add: (name: string, n?: number) => void };
  /** 🛒 Ready-made shop screen over the database items with prices. */
  shop: { open: () => void };
  /** 🎥 Camera direction: pan somewhere (gameplay keeps running), shake,
   *  return to following a player, cinematic letterbox bars. */
  camera: {
    panTo: (x: number, y: number, secs?: number) => void;
    shake: (power?: number, secs?: number) => void;
    follow: (name: string) => void;
    letterbox: (on: boolean) => void;
  };
  /** 🌐 Localization: api.t('greet') reads the project language table;
   *  setLang persists the player's language on this device. */
  t: (key: string) => string;
  setLang: (lang: string) => void;
  /** Title / save-slot screen: game name, ▶ CONTINUE (when a save file
   *  exists), ✚ NEW GAME (wipes the save + skill unlocks), and music/sfx
   *  volume bars. Gameplay pauses until a choice is made. */
  title: () => void;
  /** Procedural generation: tile rows sized to this level, ready for
   *  api.setTiles — maze (rock/dirt), dungeon (brick/stone), island. */
  gen: { maze: () => string[]; dungeon: () => string[]; island: () => string[] };
  /** Replace the level's painted tiles live (collision included). */
  setTiles: (rows: string[]) => void;
  /** Skill tree: define once, then open()/addPoints()/unlock()/isUnlocked(). */
  skills: SkillTree;
  /** End the game with a message (score shown too). */
  gameOver: (message?: string) => void;
  /** Multiplayer (null when playing solo / multiplayer off): room + players +
   *  shared state. Other players appear automatically as live avatars. */
  net: {
    id: string;
    isHost: boolean;
    code: string;
    players: () => { id: string; name: string }[];
    setState: (k: string, v: unknown) => void;
    state: (k: string) => unknown;
    onState: (cb: (k: string, v: unknown) => void) => void;
    send: (data: unknown) => void;
    onMessage: (cb: (from: string, data: unknown) => void) => void;
  } | null;
}

/** Who an event belongs to. The level itself owns events with no body,
 *  which is why every field here is required and the owner is nullable. */
interface EventOwner {
  def: EntityDef;
  e: Entity;
}

interface MobState {
  def: EntityDef;
  e: Entity;
  hp: number;
  bar: Graphics;
  homeX: number;
  homeY: number;
  dirX: number;
  dirY: number;
  wanderT: number;
  /** Ranged attack countdown (def.shootEvery > 0). */
  shootT: number;
  /** Boss phase two: below half HP — faster, angrier, shoots quicker. */
  enraged: boolean;
}

interface Projectile {
  e: Entity;
  vx: number;
  vy: number;
  ttl: number;
  damage: number;
}

interface AbilityState {
  name: string;
  key: string;
  cooldown: number;
  remaining: number;
  cb: () => void;
  root: Container;
  overlay: Graphics;
}

const ABILITY_R = 52; // button radius (≥84 design-unit touch target)

/** Live play-through of a project scene: behaviors, taps, stories, script. */
export class PlayScene extends Scene {
  private byName = new Map<string, Entity>();
  private updaters: ((dt: number) => void)[] = [];
  private box: DialogueBox | null = null;
  private keys = new Set<string>();
  private players: {
    entity: Entity;
    speed: number;
    groundY: number;
    vy: number;
    /** Brawler jump (2.5D + Gravity): height above the ground plane. */
    z: number;
    vz: number;
    shadow: Graphics | null;
    def?: EntityDef;
  }[] = [];
  private baseScales = new WeakMap<Container, number>();
  private joystick: VirtualJoystick | null = null;
  private scoreValue = 0;
  private scoreText: Text | null = null;
  private skillsTree: SkillTree | null = null;
  private tileMap: TileMapData | null = null;
  private world = new Container();
  private camera: Camera | null = null;
  private over = false;
  // Combat layer: mobs/bosses, hearts, abilities, XP/levels.
  private mobStates = new Map<string, MobState>();
  /** ⚡ Level 'tap' events — fired by tapping empty ground. */
  private levelTaps: (() => void)[] = [];
  private defeatCbs: ((name: string) => void)[] = [];
  private abilityStates: AbilityState[] = [];
  private heartsMax = 0;
  private heartsVal = 0;
  private heartsText: Text | null = null;
  private hurtT = 0;
  private levelsOn = false;
  private xpValue = 0;
  private levelValue = 1;
  private xpPerLevel = 20;
  private levelText: Text | null = null;
  private xpBarG: Graphics | null = null;
  private bossBarRoot: Container | null = null;
  private bossBarFill: Graphics | null = null;
  private gameSave: SaveStore | null = null;
  private coinDrops: { e: Entity }[] = [];
  private coinText: Text | null = null;
  private switchesMap = new Map<string, boolean>();
  private varsMap = new Map<string, number>();
  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key.toLowerCase());
    const a = this.abilityStates.find((x) => x.key && x.key === e.key.toLowerCase());
    if (a) this.fireAbility(a.name);
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  constructor(
    private readonly project: ProjectDef,
    private readonly sceneDef: SceneDef,
    private readonly onGoto: (scene: SceneDef) => void,
    private readonly onScriptError: (err: unknown) => void,
    private readonly net: StudioNet | null = null,
  ) {
    super();
  }

  private remoteViews = new Map<string, { root: Entity; label: Text }>();

  /** Other players render as live blob avatars with name tags. */
  private syncRemotes(dt: number): void {
    if (!this.net) return;
    const seen = new Set<string>();
    this.net.remotes().forEach((r, i) => {
      seen.add(r.id);
      let v = this.remoteViews.get(r.id);
      if (!v) {
        const root = new Entity();
        const colors = [0x6fc3ff, 0xff6f91, 0x8affc1, 0xffd166, 0xc77dff, 0xffb86b, 0x8fd0ff];
        const char = blobCharacter({ radius: 30, color: colors[i % colors.length]!, seed: 7 + i });
        root.addChild(char.view);
        const label = new Text({
          text: r.name,
          style: {
            fontFamily: 'system-ui, sans-serif',
            fontSize: 17,
            fontWeight: '700',
            fill: 0xe6e4f0,
          },
        });
        label.anchor.set(0.5);
        label.position.set(0, 46);
        root.addChild(label);
        root.position.set(r.x, r.y);
        this.add(root, this.world);
        v = { root, label };
        this.remoteViews.set(r.id, v);
      }
      if (r.x > -9000) {
        const k = Math.min(1, dt * 12);
        v.root.visible = true;
        v.root.x += (r.x - v.root.x) * k;
        v.root.y += (r.y - v.root.y) * k;
      } else {
        v.root.visible = false; // joined but no position yet
      }
    });
    for (const [id, v] of this.remoteViews) {
      if (!seen.has(id)) {
        this.remove(v.root);
        this.remoteViews.delete(id);
      }
    }
  }

  protected override onEnter(): void {
    // Game space lives in `world`; the camera pans it when the level is
    // bigger than one screen. HUD/UI stays on the stage (screen space).
    setLocaleTable(this.project.locales);
    this.stage.addChildAt(this.world, 0);
    const bg = new Graphics()
      .rect(0, 0, this.sceneDef.worldW, this.sceneDef.worldH)
      .fill(this.sceneDef.background);
    if (this.sceneDef.view === 'depth') {
      // Backdrop above the horizon reads as scenery, the band below as ground.
      bg.rect(0, 0, this.sceneDef.worldW, DEPTH_MIN_Y).fill(
        lighten(this.sceneDef.background, 0.22),
      );
      bg.rect(0, DEPTH_MIN_Y - 3, this.sceneDef.worldW, 6).fill({
        color: darken(this.sceneDef.background, 0.35),
        alpha: 0.6,
      });
    }
    this.world.addChildAt(bg, 0);
    // Painted tiles render above the background; solid tiles collide.
    if (anyTiles(this.sceneDef.tiles)) {
      const layer = buildTileLayer(this.sceneDef.tiles!);
      layer.view.eventMode = 'none';
      this.world.addChildAt(layer.view, 1);
      this.tileMap = layer.map;
      this.tileLayerView = layer.view;
    }
    // The camera crops the board to the current view (adaptive: a rotated
    // device sees a wide ~720-tall window) and follows the player.
    this.camera = new Camera(this.world, this.game.viewWidth, this.game.viewHeight, {
      deadzoneWidth: 120,
      deadzoneHeight: 160,
    });
    this.camera.setBounds(0, 0, this.sceneDef.worldW, this.sceneDef.worldH);
    for (const def of this.sceneDef.entities) this.spawnDef(def);
    // Actors first (each firing its own 'start'), then the level's own
    // events, then the scene script — code always gets the last word.
    this.wireLevelEvents();
    if (this.levelTaps.length) {
      bg.eventMode = 'static';
      bg.on('pointertap', () => {
        for (const cb of this.levelTaps) cb();
      });
    }
    this.refreshCoinHud(); // shows the wallet if this game has banked coins
    this.centerWorld();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // Verium chip when the project is wired into Interverse — shows the local
    // wallet, plus the on-chain IVX balance when a platform is configured.
    if (this.project.interverse) {
      const chip = new Text({
        text: `⬡ ${verium.balance()}`,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 26,
          fontWeight: '800',
          fill: 0x8affc1,
        },
      });
      chip.position.set(16, 12);
      this.stage.addChild(chip);
      let chain: number | null = null;
      this.updaters.push(
        () => (chip.text = `⬡ ${verium.balance()}${chain !== null ? `  ·  IVX ${chain}` : ''}`),
      );
      void fetchChainBalance(this.project.platform, this.project.platform?.wallet).then((b) => {
        chain = b;
      });
    }
    if (this.sceneDef.script.trim()) {
      try {
        const fn = new Function('api', this.sceneDef.script) as (api: ScriptApi) => void;
        fn(this.makeApi());
      } catch (err) {
        this.onScriptError(err);
      }
    }
  }

  protected override onExit(): void {
    audio.music.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.net?.resetSceneBindings();
  }

  /** Adaptive viewport: re-crop + re-pin the HUD when the device rotates. */
  protected override onResize(w: number, h: number): void {
    this.camera?.setViewSize(w, h);
    this.scoreText?.position.set(w - 16, 12);
    this.joystick?.position.set(150, h - 170);
    this.box?.position.set((w - 656) / 2, h - 330);
    this.layoutAbilities();
    this.layoutLevelHud();
    if (this.bossBarRoot) {
      // width depends on the view — rebuild at the new size
      this.bossBarRoot.destroy({ children: true });
      this.bossBarRoot = null;
      this.bossBarFill = null;
      if ([...this.mobStates.values()].some((m) => m.def.kind === 'boss')) this.ensureBossBar();
    }
    this.centerWorld();
  }

  /** With no player to follow (or a world smaller than the view), keep the
   *  board centred in the window instead of pinned to a corner. */
  private centerWorld(): void {
    const vw = this.game.viewWidth;
    const vh = this.game.viewHeight;
    const noFollow = this.players.length === 0;
    if (noFollow) {
      this.world.position.set(
        Math.round((vw - this.sceneDef.worldW) / 2),
        Math.round((vh - this.sceneDef.worldH) / 2),
      );
    } else {
      if (vw > this.sceneDef.worldW) this.world.x = Math.round((vw - this.sceneDef.worldW) / 2);
      if (vh > this.sceneDef.worldH) this.world.y = Math.round((vh - this.sceneDef.worldH) / 2);
    }
  }

  spawnDef(def: EntityDef): Entity {
    const e = buildView(def, this.project.assets);
    this.add(e, this.world);
    this.byName.set(def.name, e);
    // Juice: each animation owns its own wrapper (see buildView) — the root
    // keeps the author's transform, pop-in and wobble can never collide.
    const pop = viewPop.get(e)!;
    const body = viewBody.get(e)!;
    if (def.wobble) e.addBehavior(new Wobble({ target: body, amount: 0.04, speed: 2.2 }));
    if (def.popIn) {
      pop.scale.set(0.01);
      e.addBehavior(new Tween(pop.scale, { x: 1, y: 1 }, 0.4, { ease: easings.outBack }));
    }
    if (def.tapSound || def.kind === 'npc' || def.kind === 'button') {
      makeTappable(e, () => {
        playSound(def.tapSound);
        if (def.kind === 'npc') this.openStory(dialogueFor(def));
      });
    }
    if (def.kind === 'mob' || def.kind === 'boss') this.registerMob(def, e);
    this.wireEvents(def, e);
    return e;
  }

  // ------------------------------------------------------------- saving

  /** The game's save file — one namespace per project name, on-device. */
  private saveStore(): SaveStore {
    if (!this.gameSave) {
      const slug = this.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
      this.gameSave = createSave(`studio-game-${slug}`);
    }
    return this.gameSave;
  }

  private coinsGet(): number {
    return Number(this.saveStore().get('coins', 0)) || 0;
  }

  private coinsAdd(n: number): void {
    this.saveStore().set('coins', Math.max(0, this.coinsGet() + n));
    this.refreshCoinHud();
  }

  private refreshCoinHud(): void {
    const total = this.coinsGet();
    if (!this.coinText) {
      if (total <= 0) return;
      this.coinText = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '800', fill: 0xffd166 },
      });
      // stacks under the hearts (which sit under the Verium chip if shown)
      this.coinText.position.set(16, (this.project.interverse ? 54 : 12) + (this.heartsMax > 0 ? 42 : 0));
      this.stage.addChild(this.coinText);
    }
    this.coinText.text = `🪙 ${total}`;
  }

  /** Defeated mobs scatter coins; walking over one banks it in the save. */
  private dropCoins(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const e = new Entity();
      const g = new Graphics()
        .circle(0, 0, 11)
        .fill(0xffd166)
        .circle(0, 0, 11)
        .stroke({ color: darken(0xffd166, 0.4), width: 3 })
        .circle(-3, -3, 3)
        .fill(lighten(0xffd166, 0.4));
      e.addChild(g);
      e.position.set(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 60);
      e.zIndex = e.y;
      e.scale.set(0.01);
      e.addBehavior(new Tween(e.scale, { x: 1, y: 1 }, 0.3, { ease: easings.outBack }));
      this.add(e, this.world);
      this.coinDrops.push({ e });
    }
  }

  private tickCoinPickup(): void {
    const me = this.players[0]?.entity;
    if (!me || me.destroyed || !this.coinDrops.length) return;
    for (let i = this.coinDrops.length - 1; i >= 0; i--) {
      const c = this.coinDrops[i]!;
      if (c.e.destroyed) {
        this.coinDrops.splice(i, 1);
        continue;
      }
      if (Math.hypot(me.x - c.e.x, me.y - c.e.y) < 70) {
        this.spawnVfx('sparkle', c.e.x, c.e.y);
        this.remove(c.e);
        this.coinDrops.splice(i, 1);
        this.coinsAdd(1);
        audio.pop(1.6);
      }
    }
  }

  // ------------------------------------------------------------- combat

  private registerMob(def: EntityDef, e: Entity): void {
    const bar = new Graphics();
    bar.position.set(0, -def.radius - 24);
    bar.visible = false;
    e.addChild(bar);
    this.mobStates.set(def.name, {
      def,
      e,
      hp: Math.max(1, def.hp),
      bar,
      homeX: def.x,
      homeY: def.y,
      dirX: 1,
      dirY: 0,
      wanderT: 0,
      shootT: Math.max(0, def.shootEvery),
      enraged: false,
    });
    if (def.kind === 'boss') this.ensureBossBar();
    if (this.players.length && !this.heartsMax) this.enableHearts(3);
  }

  private enableHearts(n: number): void {
    this.heartsMax = Math.max(1, n);
    this.heartsVal = this.heartsMax;
    if (!this.heartsText) {
      this.heartsText = new Text({
        text: '',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 32,
          fontWeight: '800',
          fill: 0xff6f91,
        },
      });
      this.heartsText.position.set(16, this.project.interverse ? 54 : 12);
      this.stage.addChild(this.heartsText);
    }
    this.refreshHearts();
  }

  private refreshHearts(): void {
    if (!this.heartsText) return;
    this.heartsText.text =
      '♥'.repeat(this.heartsVal) + '♡'.repeat(Math.max(0, this.heartsMax - this.heartsVal));
  }

  private hurtPlayer(dmg: number, from: Entity): void {
    if (this.over || this.hurtT > 0) return;
    this.heartsVal = Math.max(0, this.heartsVal - Math.max(1, dmg));
    this.hurtT = 1; // i-frames
    audio.buzz();
    const me = this.players[0]?.entity;
    if (me && !me.destroyed) {
      // knockback away from the attacker, kept inside the walkable band
      const d = Math.hypot(me.x - from.x, me.y - from.y) || 1;
      const minY = this.sceneDef.view === 'depth' ? DEPTH_MIN_Y : 20;
      me.x = Math.max(20, Math.min(this.sceneDef.worldW - 20, me.x + ((me.x - from.x) / d) * 70));
      me.y = Math.max(minY, Math.min(this.sceneDef.worldH - 20, me.y + ((me.y - from.y) / d) * 70));
    }
    this.refreshHearts();
    if (this.heartsVal <= 0) this.endGame('DEFEATED');
  }

  private refreshMobBar(m: MobState): void {
    const max = Math.max(1, m.def.hp);
    m.bar.visible = m.hp < max;
    m.bar.clear();
    const w = Math.max(44, m.def.radius * 1.6);
    m.bar.roundRect(-w / 2, 0, w, 8, 4).fill({ color: 0x0a0812, alpha: 0.75 });
    const frac = Math.max(0, m.hp / max);
    if (frac > 0) m.bar.roundRect(-w / 2, 0, w * frac, 8, 4).fill(frac > 0.5 ? 0x8affc1 : 0xff6f91);
  }

  private damageMob(m: MobState, dmg: number, from?: Entity): void {
    if (m.e.destroyed || m.hp <= 0) return;
    m.hp -= Math.max(1, dmg);
    if (from && !from.destroyed) {
      const d = Math.hypot(m.e.x - from.x, m.e.y - from.y) || 1;
      m.e.x += ((m.e.x - from.x) / d) * 26;
      m.e.y += ((m.e.y - from.y) / d) * 26;
    }
    this.refreshMobBar(m);
    if (m.hp <= 0) {
      this.defeatMob(m);
      return;
    }
    // Boss phase two: at half HP it enrages — faster, angrier, shoots more.
    if (m.def.kind === 'boss' && !m.enraged && m.hp <= Math.max(1, m.def.hp) / 2) {
      m.enraged = true;
      const body = viewBody.get(m.e);
      if (body) body.tint = 0xff8f8f;
      audio.buzz();
      this.spawnVfx('embers', m.e.x, m.e.y);
      this.toast(`${m.def.name} is ENRAGED!`);
    }
  }

  private defeatMob(m: MobState): void {
    this.mobStates.delete(m.def.name);
    for (const [k, v] of this.byName) if (v === m.e) this.byName.delete(k);
    audio.chime();
    // squash out, then remove
    const pop = viewPop.get(m.e);
    if (pop)
      m.e.addBehavior(new Tween(pop.scale, { x: 0.01, y: 0.01 }, 0.22, { ease: easings.outQuad }));
    const doomed = m.e;
    let t = 0;
    this.updaters.push((dt) => {
      if (doomed.destroyed) return;
      t += dt;
      if (t >= 0.24) this.remove(doomed);
    });
    this.spawnVfx('poof', m.e.x, m.e.y);
    this.dropCoins(m.e.x, m.e.y, m.def.kind === 'boss' ? 5 : 1 + Math.floor(Math.random() * 2));
    if (this.levelsOn) this.addXp(Math.max(0, m.def.xp));
    for (const cb of this.defeatCbs) {
      try {
        cb(m.def.name);
      } catch (err) {
        this.onScriptError(err);
      }
    }
  }

  private meleeAttack(radius = 120, dmg = 1): number {
    const me = this.players[0]?.entity;
    if (!me || me.destroyed) return 0;
    let hits = 0;
    for (const m of [...this.mobStates.values()]) {
      if (m.e.destroyed) continue;
      if (Math.hypot(m.e.x - me.x, m.e.y - me.y) < radius + m.def.radius) {
        hits++;
        this.damageMob(m, dmg, me);
      }
    }
    if (hits) audio.pop(1.3);
    else audio.blip(0.7);
    // swing ring vfx
    const fx = new Entity();
    fx.addChild(
      new Graphics().circle(0, 0, radius).stroke({ color: 0xffffff, width: 5, alpha: 0.55 }),
    );
    fx.position.set(me.x, me.y);
    this.add(fx, this.world);
    let t = 0;
    this.updaters.push((dt) => {
      if (fx.destroyed) return;
      t += dt;
      fx.alpha = Math.max(0, 1 - t / 0.28);
      if (t >= 0.28) this.remove(fx);
    });
    return hits;
  }

  // ----------------------------------------------------------- abilities

  private addAbility(
    name: string,
    opts: { icon?: string; cooldown?: number; key?: string },
    cb: () => void,
  ): void {
    if (this.abilityStates.some((a) => a.name === name)) return;
    const root = new Container();
    const bg = new Graphics()
      .circle(0, 0, ABILITY_R)
      .fill({ color: 0x1c1930, alpha: 0.92 })
      .circle(0, 0, ABILITY_R)
      .stroke({ color: 0x8affc1, width: 3, alpha: 0.8 });
    root.addChild(bg);
    const iconId = opts.icon ?? 'star';
    if (iconId.startsWith('@')) {
      const url = this.project.assets[iconId.slice(1)];
      if (url) {
        assetTexture(url, (tex) => {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5);
          sp.scale.set((ABILITY_R * 1.2) / Math.max(tex.width, tex.height));
          root.addChildAt(sp, 1);
        });
      }
    } else {
      root.addChild(drawIcon(iconId, ABILITY_R * 1.15));
    }
    const overlay = new Graphics();
    root.addChild(overlay);
    if (opts.key) {
      const k = new Text({
        text: opts.key.toUpperCase(),
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 17,
          fontWeight: '800',
          fill: 0x9a97b8,
        },
      });
      k.anchor.set(0.5);
      k.position.set(0, ABILITY_R - 12);
      root.addChild(k);
    }
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointerdown', () => this.fireAbility(name));
    this.stage.addChild(root);
    this.abilityStates.push({
      name,
      key: (opts.key ?? '').toLowerCase(),
      cooldown: Math.max(0.1, opts.cooldown ?? 0.5),
      remaining: 0,
      cb,
      root,
      overlay,
    });
    this.layoutAbilities();
  }

  private layoutAbilities(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.abilityStates.forEach((a, i) =>
      a.root.position.set(W - 84 - i * (ABILITY_R * 2 + 22), H - 96),
    );
  }

  fireAbility(name: string): boolean {
    const a = this.abilityStates.find((x) => x.name === name);
    if (!a || a.remaining > 0 || this.over) return false;
    a.remaining = a.cooldown;
    a.root.scale.set(0.85);
    try {
      a.cb();
    } catch (err) {
      this.onScriptError(err);
    }
    return true;
  }

  private tickAbilities(dt: number): void {
    for (const a of this.abilityStates) {
      a.root.scale.x += (1 - a.root.scale.x) * Math.min(1, dt * 12);
      a.root.scale.y = a.root.scale.x;
      if (a.remaining > 0) {
        a.remaining = Math.max(0, a.remaining - dt);
        a.overlay.clear();
        if (a.remaining > 0) {
          const frac = a.remaining / a.cooldown;
          a.overlay
            .moveTo(0, 0)
            .arc(0, 0, ABILITY_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
            .lineTo(0, 0)
            .fill({ color: 0x0a0812, alpha: 0.7 });
        }
      }
    }
  }

  // ------------------------------------------------------- levels & boss

  private enableLevels(opts?: { xpPerLevel?: number }): void {
    if (this.levelsOn) return;
    this.levelsOn = true;
    this.xpPerLevel = Math.max(5, opts?.xpPerLevel ?? 20);
    // Progress persists in the game's save file between plays.
    const s = this.saveStore();
    this.xpValue = Math.max(0, Number(s.get('__xp', 0)) || 0);
    this.levelValue = Math.max(1, Number(s.get('__level', 1)) || 1);
    this.levelText = new Text({
      text: 'Lv 1',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 26,
        fontWeight: '800',
        fill: 0xc77dff,
      },
    });
    this.levelText.anchor.set(0.5, 0);
    this.xpBarG = new Graphics();
    this.stage.addChild(this.levelText, this.xpBarG);
    this.layoutLevelHud();
    this.refreshLevelHud();
  }

  private layoutLevelHud(): void {
    const cx = this.game.viewWidth / 2;
    this.levelText?.position.set(cx, 10);
    this.xpBarG?.position.set(cx - 70, 44);
  }

  private xpNeed(): number {
    return this.xpPerLevel + (this.levelValue - 1) * Math.round(this.xpPerLevel * 0.6);
  }

  private refreshLevelHud(): void {
    if (!this.levelText || !this.xpBarG) return;
    this.levelText.text = `Lv ${this.levelValue}`;
    this.xpBarG.clear();
    this.xpBarG.roundRect(0, 0, 140, 8, 4).fill({ color: 0x0a0812, alpha: 0.75 });
    const frac = Math.min(1, this.xpValue / this.xpNeed());
    if (frac > 0) this.xpBarG.roundRect(0, 0, 140 * frac, 8, 4).fill(0xc77dff);
  }

  private addXp(n: number): void {
    if (!this.levelsOn || n <= 0) return;
    this.xpValue += n;
    let need = this.xpNeed();
    while (this.xpValue >= need) {
      this.xpValue -= need;
      this.levelValue++;
      this.skillsTree?.addPoints(1);
      audio.chime();
      this.toast('LEVEL UP!');
      const me = this.players[0]?.entity;
      if (me && !me.destroyed) this.spawnVfx('confetti', me.x, me.y - 40);
      need = this.xpNeed();
    }
    const s = this.saveStore();
    s.set('__xp', this.xpValue);
    s.set('__level', this.levelValue);
    this.refreshLevelHud();
  }

  private toast(message: string): void {
    const t = new Text({
      text: message,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 44,
        fontWeight: '800',
        fill: 0xffd166,
      },
    });
    t.anchor.set(0.5);
    t.position.set(this.game.viewWidth / 2, this.game.viewHeight * 0.32);
    this.stage.addChild(t);
    let age = 0;
    this.updaters.push((dt) => {
      if (t.destroyed) return;
      age += dt;
      t.y -= 26 * dt;
      t.alpha = Math.max(0, 1 - age / 1.1);
      if (age >= 1.1) t.destroy();
    });
  }

  private ensureBossBar(): void {
    if (this.bossBarRoot) return;
    const boss = [...this.mobStates.values()].find((m) => m.def.kind === 'boss');
    const root = new Container();
    const W = Math.min(560, this.game.viewWidth - 140);
    const label = new Text({
      text: boss?.def.name ?? 'BOSS',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 20,
        fontWeight: '800',
        fill: 0xe6e4f0,
      },
    });
    label.anchor.set(0.5, 0);
    label.position.set(W / 2, 0);
    root.addChild(label);
    root.addChild(new Graphics().roundRect(0, 26, W, 14, 7).fill({ color: 0x0a0812, alpha: 0.8 }));
    this.bossBarFill = new Graphics();
    root.addChild(this.bossBarFill);
    // sits below the level HUD (Lv text + XP bar occupy the top ~52px)
    root.position.set((this.game.viewWidth - W) / 2, 60);
    this.stage.addChild(root);
    this.bossBarRoot = root;
    this.updateBossBar();
  }

  private updateBossBar(): void {
    if (!this.bossBarRoot || !this.bossBarFill) return;
    const boss = [...this.mobStates.values()].find((m) => m.def.kind === 'boss');
    if (!boss) {
      this.bossBarRoot.visible = false;
      return;
    }
    this.bossBarRoot.visible = true;
    const W = Math.min(560, this.game.viewWidth - 140);
    const frac = Math.max(0, boss.hp / Math.max(1, boss.def.hp));
    this.bossBarFill.clear();
    if (frac > 0) this.bossBarFill.roundRect(0, 26, W * frac, 14, 7).fill(0xff6f91);
  }

  // -------------------------------------------------------- brawler jump

  /** 2.5D + Gravity: hop above the ground plane (Space / the Jump button). */
  private tryJump(): void {
    for (const p of this.players) {
      if (p.entity.destroyed || p.z > 0) continue;
      p.vz = 640;
      audio.blip(1.3);
    }
  }

  /** Height physics: the visual lifts off the plane while e.x/e.y stay the
   *  steerable ground position — so you land wherever you walked to. */
  private tickJump(dt: number): void {
    for (const p of this.players) {
      if (p.entity.destroyed) continue;
      if (p.z > 0 || p.vz > 0) {
        p.vz -= 2000 * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          p.vz = 0;
          audio.pop(0.7);
        }
      }
      const body = viewBody.get(p.entity);
      if (body) body.position.y = -p.z;
      if (p.shadow) {
        p.shadow.visible = p.z > 0;
        if (p.z > 0) p.shadow.scale.set(Math.max(0.55, 1 - p.z / 420));
      }
    }
  }

  playerAirHeight(): number {
    return this.players[0]?.z ?? 0;
  }

  // --------------------------------------------------------------- mob AI

  private updateMobs(dt: number): void {
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);
    const me = this.players[0]?.entity;
    if (me && !me.destroyed) me.alpha = this.hurtT > 0 ? 0.55 : 1;
    const W = this.sceneDef.worldW;
    const H = this.sceneDef.worldH;
    const minY = this.sceneDef.view === 'depth' ? DEPTH_MIN_Y : 20;
    for (const m of this.mobStates.values()) {
      if (m.e.destroyed || m.hp <= 0) continue;
      let vx = 0;
      let vy = 0;
      const b = m.def.behavior;
      const dMe = me && !me.destroyed ? Math.hypot(me.x - m.e.x, me.y - m.e.y) : Infinity;
      if (b === 'chase' && me && !me.destroyed && dMe > 6) {
        vx = (me.x - m.e.x) / dMe;
        vy = (me.y - m.e.y) / dMe;
      } else if (b === 'guard') {
        const dHome = Math.hypot(m.e.x - m.homeX, m.e.y - m.homeY);
        if (me && !me.destroyed && dMe < 280 && dHome < 420 && dMe > 6) {
          vx = (me.x - m.e.x) / dMe;
          vy = (me.y - m.e.y) / dMe;
        } else if (dHome > 12) {
          vx = (m.homeX - m.e.x) / dHome;
          vy = (m.homeY - m.e.y) / dHome;
        }
      } else if (b === 'patrol') {
        vx = m.dirX;
        if (m.e.x > Math.min(W - 60, m.homeX + 200)) m.dirX = -1;
        else if (m.e.x < Math.max(60, m.homeX - 200)) m.dirX = 1;
      } else if (b === 'wander') {
        m.wanderT -= dt;
        if (m.wanderT <= 0) {
          m.wanderT = 0.8 + Math.random() * 1.4;
          const a = Math.random() * Math.PI * 2;
          m.dirX = Math.cos(a);
          m.dirY = Math.sin(a);
        }
        vx = m.dirX;
        vy = m.dirY;
      }
      const speed = m.def.moveSpeed * (m.enraged ? 1.4 : 1);
      if (vx !== 0) this.face(m.e, vx);
      this.autoClip(m.def, vx || vy ? 'walk' : 'idle');
      if (vx || vy) {
        m.e.x = Math.max(20, Math.min(W - 20, m.e.x + vx * speed * dt));
        m.e.y = Math.max(minY, Math.min(H - 20, m.e.y + vy * speed * dt));
      }
      // Ranged: lob a dodgeable projectile at the player on a timer.
      if (m.def.shootEvery > 0 && me && !me.destroyed && dMe < 900) {
        m.shootT -= dt;
        if (m.shootT <= 0) {
          m.shootT = m.def.shootEvery * (m.enraged ? 0.55 : 1);
          this.fireProjectile(m, me);
        }
      }
      // touching the player costs a heart (with i-frames + knockback);
      // an airborne brawler-jump player sails safely over mobs
      const airborne = (this.players[0]?.z ?? 0) > 30;
      if (me && !me.destroyed && !airborne && this.heartsMax > 0 && this.hurtT <= 0) {
        if (Math.hypot(me.x - m.e.x, me.y - m.e.y) < m.def.radius * m.def.scale + 30) {
          this.hurtPlayer(m.def.damage, m.e);
        }
      }
    }
    this.updateBossBar();
    this.tickProjectiles(dt);
  }

  // ---------------------------------------------------------- projectiles

  private projectiles: Projectile[] = [];
  private shotsFiredTotal = 0;

  private fireProjectile(m: MobState, at: Entity): void {
    const e = new Entity();
    const g = new Graphics()
      .circle(0, 0, 16)
      .fill({ color: m.def.color, alpha: 0.25 })
      .circle(0, 0, 9)
      .fill(lighten(m.def.color, 0.35));
    e.addChild(g);
    e.position.set(m.e.x, m.e.y - 10);
    this.add(e, this.world);
    const d = Math.hypot(at.x - m.e.x, at.y - m.e.y) || 1;
    this.projectiles.push({
      e,
      vx: ((at.x - m.e.x) / d) * 320,
      vy: ((at.y - m.e.y) / d) * 320,
      ttl: 2.8,
      damage: Math.max(1, m.def.damage),
    });
    this.shotsFiredTotal++;
    audio.blip(0.6);
  }

  private tickProjectiles(dt: number): void {
    if (!this.projectiles.length) return;
    const me = this.players[0]?.entity;
    const airborne = (this.players[0]?.z ?? 0) > 30;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      if (p.e.destroyed) {
        this.projectiles.splice(i, 1);
        continue;
      }
      p.e.x += p.vx * dt;
      p.e.y += p.vy * dt;
      p.e.zIndex = p.e.y; // depth scenes z-sort the world by y
      p.ttl -= dt;
      const out =
        p.ttl <= 0 ||
        p.e.x < -40 ||
        p.e.x > this.sceneDef.worldW + 40 ||
        p.e.y < -40 ||
        p.e.y > this.sceneDef.worldH + 40;
      const hit =
        !out &&
        !!me &&
        !me.destroyed &&
        !airborne &&
        this.heartsMax > 0 &&
        this.hurtT <= 0 &&
        Math.hypot(me.x - p.e.x, me.y - p.e.y) < 32;
      if (hit) this.hurtPlayer(p.damage, p.e);
      if (out || hit) {
        this.remove(p.e);
        this.projectiles.splice(i, 1);
      }
    }
  }

  spawnVfx(preset: VfxPreset, x: number, y: number): void {
    const fx = burst(preset, x, y);
    this.add(fx, this.world);
    this.vfxCount++;
  }

  /** Total bursts spawned (headless-test probe). */
  vfxCount = 0;

  /** Live cosmetics: update the def + redraw the actor's outfit layer. */
  setOutfit(target: string, opts: { hat?: string; held?: string }): void {
    const e = this.byName.get(target);
    const def = this.sceneDef.entities.find((d) => d.name === target);
    if (!e || e.destroyed || !def) return;
    if (opts.hat !== undefined) def.hat = opts.hat;
    if (opts.held !== undefined) def.held = opts.held;
    const layer = viewOutfit.get(e);
    if (layer) drawOutfit(layer, def);
  }

  playClip(target: string, clipName: string): boolean {
    const e = this.byName.get(target);
    const def = this.sceneDef.entities.find((d) => d.name === target);
    if (!e || e.destroyed || !def) return false;
    const frames = viewFrames.get(e);
    const sp = viewSprite.get(e);
    const clip = def.clips.find((c) => c.name === clipName);
    if (!frames || !sp || !clip) return false;
    const from = Math.max(0, Math.min(frames.length - 1, Math.floor(clip.from)));
    const to = Math.max(from, Math.min(frames.length - 1, Math.floor(clip.to)));
    sp.textures = frames.slice(from, to + 1);
    sp.animationSpeed = Math.max(0.5, clip.fps || 8) / 60;
    sp.play();
    this.activeClips.set(target, clipName);
    return true;
  }

  activeClips = new Map<string, string>();

  private tileLayerView: Container | null = null;

  /** Swap the painted tile layer live — procgen worlds mid-play. */
  setTilesLive(rows: string[]): void {
    this.tileLayerView?.destroy({ children: true });
    this.tileLayerView = null;
    const layer = buildTileLayer(rows);
    layer.view.eventMode = 'none';
    this.world.addChildAt(layer.view, Math.min(1, this.world.children.length));
    this.tileMap = layer.map;
    this.tileLayerView = layer.view;
  }

  /** Animation state machine v1: imported models with clips named idle /
   *  walk / jump switch automatically as they move — zero wiring. */
  private autoClip(def: EntityDef | undefined, state: string): void {
    if (!def || def.kind !== 'image') return;
    if (!def.clips.some((c) => c.name === state)) return;
    if (this.activeClips.get(def.name) === state) return;
    this.playClip(def.name, state);
  }

  /** Auto-facing: characters and imported models look where they walk.
   *  Flips the pop wrapper so Wobble's uniform scaling stays untouched. */
  private face(e: Entity, dirX: number): void {
    const pop = viewPop.get(e);
    if (!pop) return;
    const want = dirX < 0 ? -1 : 1;
    if (Math.sign(pop.scale.x) !== want) pop.scale.x = Math.abs(pop.scale.x) * want;
  }

  outfitOf(target: string): { hat: string; held: string } | null {
    const def = this.sceneDef.entities.find((d) => d.name === target);
    return def ? { hat: def.hat, held: def.held } : null;
  }

  private sayLines(speaker: string, linesIn: string[]): void {
    const lines = linesIn.map(tr);
    const nodes: DialogueData['nodes'] = {};
    lines.forEach((text, i) => {
      nodes[`n${i}`] = { speaker, text, ...(i < lines.length - 1 ? { next: `n${i + 1}` } : {}) };
    });
    this.openStory({ start: 'n0', nodes });
  }

  // ------------------------------------------------------ no-code events

  /** Wire an entity's event blocks (RPG-Maker style: trigger + actions). */
  private wireEvents(def: EntityDef, e: Entity): void {
    this.bindEvents(def.events ?? [], { def, e });
  }

  /** ⚡ Level events — the same blocks, owned by the level instead of an
   *  actor. Bound after every actor has spawned so a 'cleared' event can
   *  see the mobs it is waiting on, and before the scene script so code
   *  always gets the last word. */
  private wireLevelEvents(): void {
    this.bindEvents(this.sceneDef.events ?? [], null);
  }

  /** Bind one event list to its owner. `owner === null` means the LEVEL owns
   *  it: there is no body to tap or walk into, so 'tap' listens on the empty
   *  ground and 'cleared' watches the mob count instead. */
  private bindEvents(evs: EventDef[], owner: EventOwner | null): void {
    if (!evs.length) return;
    const state = evs.map(() => ({ fired: false, inside: false, t: 0, wasClear: this.mobStates.size === 0 }));
    const run = (ev: EventDef, i: number): void => {
      if (ev.once && state[i]!.fired) return;
      if (ev.ifSwitch && !this.switchesMap.get(ev.ifSwitch)) return;
      if (ev.ifVar && (this.varsMap.get(ev.ifVar) ?? 0) < (ev.ifVarAtLeast ?? 1)) return;
      if (ev.once) state[i]!.fired = true;
      this.runActions(owner, ev.actions ?? []);
    };
    evs.forEach((ev, i) => {
      if (ev.trigger === 'start') run(ev, i);
      else if (ev.trigger === 'tap') {
        if (owner) makeTappable(owner.e, () => run(ev, i));
        else this.levelTaps.push(() => run(ev, i));
      } else {
        this.updaters.push((dt) => {
          if (owner?.e.destroyed) return;
          if (ev.trigger === 'every') {
            const secs = Math.max(0.1, ev.every ?? 1);
            state[i]!.t += dt;
            while (state[i]!.t >= secs) {
              state[i]!.t -= secs;
              run(ev, i);
            }
          } else if (ev.trigger === 'cleared') {
            // Rising edge only, and armed from the live count — a level that
            // never had an enemy never "clears".
            const clear = this.mobStates.size === 0;
            if (clear && !state[i]!.wasClear) run(ev, i);
            state[i]!.wasClear = clear;
          } else if (owner) {
            // 'touch': edge-triggered — fires on entering, re-arms on leaving
            const me = this.players[0]?.entity;
            if (!me || me.destroyed) return;
            const near = Math.hypot(me.x - owner.e.x, me.y - owner.e.y) < owner.def.radius + 45;
            if (near && !state[i]!.inside) run(ev, i);
            state[i]!.inside = near;
          }
        });
      }
    });
  }

  /** Execute one event's action list against the live scene. A null owner
   *  is the level itself: actions that default to "where I am" fall back to
   *  the middle of the board, and "say" is spoken by the level's name. */
  private runActions(owner: EventOwner | null, actions: EventAction[]): void {
    const def = owner?.def;
    const e = owner?.e;
    const atX = def?.x ?? this.sceneDef.worldW / 2;
    const atY = def?.y ?? this.sceneDef.worldH / 2;
    for (const a of actions) {
      switch (a.cmd) {
        case 'say':
          this.sayLines(def?.name ?? this.sceneDef.name, [a.text ?? '…']);
          break;
        case 'coins':
          this.coinsAdd(a.n ?? 1);
          audio.pop(1.5);
          break;
        case 'score':
          this.scoreValue += a.n ?? 1;
          this.ensureScoreHud();
          break;
        case 'xp':
          if (!this.levelsOn) this.enableLevels();
          this.addXp(a.n ?? 5);
          break;
        case 'heal':
          if (this.heartsMax) {
            this.heartsVal = Math.min(this.heartsMax, this.heartsVal + (a.n ?? 1));
            this.refreshHearts();
          } else {
            this.enableHearts(a.n ?? 3);
          }
          audio.chime();
          break;
        case 'sfx':
          playSound((a.text ?? 'pop') as TapSound);
          break;
        case 'music':
          if (a.text === 'stop') audio.music.stop();
          else if (a.text === 'fanfare') audio.music.fanfare();
          else audio.music.play((a.text ?? 'adventure') as MusicTrackId);
          break;
        case 'vfx':
          this.spawnVfx((a.text ?? 'sparkle') as VfxPreset, a.x ?? atX, a.y ?? atY);
          break;
        case 'item':
          if (a.text) this.giveItem(a.text, a.n ?? 1);
          break;
        case 'var':
          if (a.text) this.varsMap.set(a.text, (this.varsMap.get(a.text) ?? 0) + (a.n ?? 1));
          break;
        case 'shop':
          this.openShop();
          break;
        case 'inventory':
          this.openInventory();
          break;
        case 'spawn':
          this.spawnDef(defaultEntity((a.text ?? 'crate') as EntityKind, a.x ?? atX, a.y ?? atY));
          break;
        case 'remove':
          if (!def || !e) break; // level scope has no body to remove
          for (const [k, v] of this.byName) if (v === e) this.byName.delete(k);
          this.mobStates.delete(def.name);
          if (!e.destroyed) this.remove(e);
          break;
        case 'goto': {
          const next = this.project.scenes.find((s) => s.name === a.text || s.id === a.text);
          if (next) this.onGoto(next);
          break;
        }
        case 'switchOn':
          if (a.text) this.switchesMap.set(a.text, true);
          break;
        case 'switchOff':
          if (a.text) this.switchesMap.set(a.text, false);
          break;
        case 'win':
          this.endGame(a.text || 'YOU WIN! 🌟');
          break;
        case 'lose':
          this.endGame(a.text || 'GAME OVER');
          break;
      }
    }
  }

  /** Headless hook: fire the level's 'tap anywhere' events. */
  fireLevelTaps(): boolean {
    for (const cb of this.levelTaps) cb();
    return this.levelTaps.length > 0;
  }

  switchState(name: string): boolean {
    return this.switchesMap.get(name) ?? false;
  }

  private openStory(data: DialogueData): void {
    if (!this.box) {
      this.box = new DialogueBox();
      this.box.position.set((this.game.viewWidth - 656) / 2, this.game.viewHeight - 330);
      this.add(this.box);
    }
    const runner = new DialogueRunner(data);
    runner.start();
    this.box.open(runner);
  }

  private resolve(target: string | Entity): Entity | undefined {
    return typeof target === 'string' ? this.byName.get(target) : target;
  }

  private ensureScoreHud(): void {
    if (this.scoreText) return;
    this.scoreText = new Text({
      text: '0',
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 34,
        fontWeight: '800',
        fill: 0xffd166,
      },
    });
    this.scoreText.anchor.set(1, 0);
    this.scoreText.position.set(this.game.viewWidth - 16, 12);
    this.stage.addChild(this.scoreText);
  }

  makeApi(): ScriptApi {
    if (!this.skillsTree)
      this.skillsTree = new SkillTree(this, this.project.name, () => this.game.viewWidth);
    return {
      scene: this,
      game: this.game,
      sfx: audio,
      verium,
      entity: (name) => this.byName.get(name),
      entities: () => Object.fromEntries(this.byName),
      onUpdate: (cb) => this.updaters.push(cb),
      goto: (sceneName) => {
        const next = this.project.scenes.find((s) => s.name === sceneName || s.id === sceneName);
        if (next) this.onGoto(next);
      },
      spawn: (kind, x, y) => this.spawnDef(defaultEntity(kind, x, y)),
      say: (speaker, ...lines) => {
        this.sayLines(speaker, lines);
      },
      player: (name, speed = 300) => {
        const e = this.byName.get(name);
        if (!e) return undefined;
        const pdef = this.sceneDef.entities.find((d) => d.name === name);
        const p: (typeof this.players)[number] = { entity: e, speed, groundY: e.y, vy: 0, z: 0, vz: 0, shadow: null };
        if (pdef) p.def = pdef;
        this.players.push(p);
        if (this.sceneDef.view === 'depth' && this.sceneDef.gravity) {
          // Brawler jump: a ground shadow (visible while airborne) + an
          // auto Jump button so phones can jump too (Space on keyboards).
          const shadow = new Graphics().ellipse(0, 34, 26, 10).fill({ color: 0x000000, alpha: 0.35 });
          shadow.visible = false;
          e.addChildAt(shadow, 0);
          p.shadow = shadow;
          if (!this.abilityStates.some((a) => a.name === 'Jump')) {
            this.addAbility('Jump', { icon: 'boot', cooldown: 0.1 }, () => this.tryJump());
          }
        }
        if (this.mobStates.size && !this.heartsMax) this.enableHearts(3);
        this.camera?.follow(e);
        if (!this.joystick) {
          this.joystick = new VirtualJoystick({ radius: 90 });
          this.joystick.position.set(150, this.game.viewHeight - 170);
          this.add(this.joystick);
        }
        return e;
      },
      score: {
        add: (n) => {
          this.scoreValue += n;
          this.ensureScoreHud();
        },
        set: (n) => {
          this.scoreValue = n;
          this.ensureScoreHud();
        },
        get: () => this.scoreValue,
      },
      every: (secs, cb) => {
        let t = 0;
        this.updaters.push((dt) => {
          t += dt;
          while (t >= secs) {
            t -= secs;
            cb();
          }
        });
      },
      after: (secs, cb) => {
        let t = 0;
        let done = false;
        this.updaters.push((dt) => {
          if (done) return;
          t += dt;
          if (t >= secs) {
            done = true;
            cb();
          }
        });
      },
      overlap: (a, b, dist) => {
        const ea = this.resolve(a);
        const eb = this.resolve(b);
        if (!ea || !eb || ea.destroyed || eb.destroyed) return false;
        return Math.hypot(ea.x - eb.x, ea.y - eb.y) < dist;
      },
      onTap: (target, cb) => {
        const e = this.resolve(target);
        if (e) makeTappable(e, cb);
      },
      remove: (target) => {
        const e = this.resolve(target);
        if (!e) return;
        for (const [k, v] of this.byName) if (v === e) this.byName.delete(k);
        this.remove(e);
      },
      random: (min, max) => min + Math.random() * (max - min),
      tween: (target, props, secs) => {
        const e = this.resolve(target);
        if (!e || e.destroyed) return;
        const { scale, ...rest } = props;
        if (scale !== undefined) {
          e.addBehavior(
            new Tween(e.scale, { x: scale, y: scale }, secs, { ease: easings.outQuad }),
          );
        }
        if (Object.keys(rest).length) {
          e.addBehavior(
            new Tween(e as unknown as Record<string, number>, rest, secs, {
              ease: easings.outQuad,
            }),
          );
        }
      },
      skills: this.skillsTree,
      net: this.net
        ? {
            id: this.net.id,
            isHost: this.net.isHost,
            code: this.net.code,
            players: () => this.net!.players(),
            setState: (k, v) => this.net!.setState(k, v),
            state: (k) => this.net!.getState(k),
            onState: (cb) => this.net!.onState(cb),
            send: (data) => this.net!.send(data),
            onMessage: (cb) => this.net!.onMsg(cb),
          }
        : null,
      ability: (name, opts, cb) => this.addAbility(name, opts ?? {}, cb),
      meleeAttack: (radius = 120, dmg = 1) => this.meleeAttack(radius, dmg),
      hurt: (target, dmg) => {
        const m = this.mobStates.get(target);
        if (m) this.damageMob(m, dmg, this.players[0]?.entity);
      },
      hpOf: (target) => this.mobStates.get(target)?.hp ?? 0,
      onDefeat: (cb) => this.defeatCbs.push(cb),
      patrol: (target, points, speed = 140) => {
        const e = this.resolve(target);
        if (!e || !points.length) return;
        let i = 0;
        this.updaters.push((dt) => {
          if (e.destroyed) return;
          const [tx, ty] = points[i % points.length]!;
          const d = Math.hypot(tx - e.x, ty - e.y);
          if (d < 8) {
            i++;
            return;
          }
          e.x += ((tx - e.x) / d) * speed * dt;
          e.y += ((ty - e.y) / d) * speed * dt;
        });
      },
      hearts: (n) => this.enableHearts(n),
      levels: (opts) => this.enableLevels(opts),
      xp: { add: (n) => this.addXp(n), get: () => this.xpValue },
      level: () => this.levelValue,
      save: {
        set: (key, value) => this.saveStore().set(key, value),
        get: (key, fallback) => this.saveStore().get(key, fallback),
        remove: (key) => this.saveStore().remove(key),
        clear: () => this.saveStore().clear(),
      },
      coins: {
        get: () => this.coinsGet(),
        add: (n) => this.coinsAdd(n),
        spend: (n) => {
          if (this.coinsGet() < n) return false;
          this.coinsAdd(-n);
          return true;
        },
      },
      switches: {
        on: (name) => void this.switchesMap.set(name, true),
        off: (name) => void this.switchesMap.set(name, false),
        isOn: (name) => this.switchesMap.get(name) ?? false,
      },
      music: {
        play: (id) => audio.music.play(id),
        stop: () => audio.music.stop(),
        fanfare: () => audio.music.fanfare(),
        current: () => audio.music.current(),
        setVolume: (bus, v) => audio.setVolume(bus, v),
      },
      vfx: (preset, x, y) => this.spawnVfx(preset, x, y),
      outfit: (target, opts) => this.setOutfit(target, opts),
      playClip: (target, clipName) => this.playClip(target, clipName),
      title: () => this.showTitle(),
      items: {
        give: (id, count = 1) => this.giveItem(id, count),
        count: (id) => this.itemCount(id),
        use: (id) => this.useItem(id),
        buy: (id) => this.buyItem(id),
        list: () => (this.project.db?.items ?? []).map((i) => ({ id: i.id, name: i.name, emoji: i.emoji, price: i.price })),
        open: () => this.openInventory(),
      },
      vars: {
        get: (name) => this.varsMap.get(name) ?? 0,
        set: (name, v) => void this.varsMap.set(name, v),
        add: (name, n = 1) => void this.varsMap.set(name, (this.varsMap.get(name) ?? 0) + n),
      },
      shop: { open: () => this.openShop() },
      camera: {
        panTo: (x, y, secs = 1) => this.cameraPanTo(x, y, secs),
        shake: (power = 14, secs = 0.4) => {
          this.shakePower = power;
          this.shakeT = secs;
        },
        follow: (name) => {
          this.camHold = false;
          this.camPan = null;
          const e = this.byName.get(name);
          if (e) this.camera?.follow(e);
        },
        letterbox: (on) => this.setLetterbox(on),
      },
      t: (key) => tr(key.startsWith('@') ? key : `@${key}`),
      setLang: (lang) => setLang(lang),
      gen: {
        maze: () => generateRows('maze', this.sceneDef.worldW / 40, this.sceneDef.worldH / 40),
        dungeon: () => generateRows('dungeon', this.sceneDef.worldW / 40, this.sceneDef.worldH / 40),
        island: () => generateRows('island', this.sceneDef.worldW / 40, this.sceneDef.worldH / 40),
      },
      setTiles: (rows) => this.setTilesLive(rows),
      gameOver: (message = 'GAME OVER') => this.endGame(message),
    };
  }

  // ------------------------------------------------------- 🗄 items
  private invGet(): Record<string, number> {
    return this.saveStore().get('__inv', {} as Record<string, number>);
  }

  private itemDefOf(id: string) {
    return (this.project.db?.items ?? []).find((i) => i.id === id);
  }

  giveItem(id: string, count = 1): boolean {
    if (!this.itemDefOf(id)) return false;
    const inv = this.invGet();
    inv[id] = Math.max(0, (inv[id] ?? 0) + count);
    if (inv[id] === 0) delete inv[id];
    this.saveStore().set('__inv', inv);
    audio.pop(1.4);
    return true;
  }

  itemCount(id: string): number {
    return this.invGet()[id] ?? 0;
  }

  useItem(id: string): boolean {
    const d = this.itemDefOf(id);
    const inv = this.invGet();
    if (!d || (inv[id] ?? 0) <= 0) return false;
    inv[id] = inv[id]! - 1;
    if (inv[id]! <= 0) delete inv[id];
    this.saveStore().set('__inv', inv);
    if (d.effect === 'heal') {
      if (!this.heartsMax) this.enableHearts(3);
      this.heartsVal = Math.min(this.heartsMax, this.heartsVal + Math.max(1, d.n));
      this.refreshHearts();
    } else if (d.effect === 'coins') {
      this.coinsAdd(Math.max(1, d.n));
    } else if (d.effect === 'xp') {
      if (!this.levelsOn) this.enableLevels();
      this.addXp(Math.max(1, d.n));
    }
    audio.chime();
    return true;
  }

  buyItem(id: string): boolean {
    const d = this.itemDefOf(id);
    if (!d || d.price <= 0 || this.coinsGet() < d.price) return false;
    this.coinsAdd(-d.price);
    return this.giveItem(id, 1);
  }

  private invRoot: Entity | null = null;
  private shopRoot: Entity | null = null;

  /** 🛒 Shop overlay — buy database items with coins. */
  openShop(): void {
    this.shopRoot?.destroy({ children: true });
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const root = new Entity();
    const bg = new Graphics().roundRect(W / 2 - 260, H * 0.16, 520, H * 0.58, 16).fill({ color: 0x16131f, alpha: 0.97 });
    bg.eventMode = 'static';
    root.addChild(bg);
    const title = new Text({
      text: '🛒 SHOP',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0xffd166 },
    });
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, H * 0.16 + 16);
    root.addChild(title);
    const wallet = new Text({
      text: `🪙 ${this.coinsGet()}`,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 24, fontWeight: '800', fill: 0xffd166 },
    });
    wallet.anchor.set(0, 0);
    wallet.position.set(W / 2 - 240, H * 0.16 + 20);
    root.addChild(wallet);
    const wares = (this.project.db?.items ?? []).filter((i) => i.price > 0).slice(0, 7);
    if (!wares.length) {
      const empty = new Text({
        text: '(no items for sale — set prices in 🗄 Database)',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fill: 0x9a97b8 },
      });
      empty.anchor.set(0.5);
      empty.position.set(W / 2, H * 0.16 + 120);
      root.addChild(empty);
    }
    wares.forEach((item, i) => {
      const y = H * 0.16 + 90 + i * 52;
      const row = new Text({
        text: `${item.emoji} ${tr(item.name)}   🪙${item.price}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '700', fill: 0xe6e4f0 },
      });
      row.anchor.set(0, 0.5);
      row.position.set(W / 2 - 230, y);
      row.eventMode = 'static';
      row.cursor = 'pointer';
      const owned = new Text({
        text: this.itemCount(item.id) ? `×${this.itemCount(item.id)}` : '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fill: 0x8affc1 },
      });
      owned.anchor.set(1, 0.5);
      owned.position.set(W / 2 + 230, y);
      row.on('pointertap', () => {
        if (this.buyItem(item.id)) {
          wallet.text = `🪙 ${this.coinsGet()}`;
          owned.text = `×${this.itemCount(item.id)}`;
          this.spawnVfx('coins', W / 2, y);
        } else {
          audio.buzz();
        }
      });
      root.addChild(row, owned);
    });
    const close = new Text({
      text: '✕',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0x9a97b8 },
    });
    close.anchor.set(0.5);
    close.position.set(W / 2 + 236, H * 0.16 + 30);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointertap', () => {
      root.destroy({ children: true });
      this.shopRoot = null;
    });
    root.addChild(close);
    this.add(root);
    this.shopRoot = root;
  }

  shopVisible(): boolean {
    return !!this.shopRoot;
  }

  varNow(name: string): number {
    return this.varsMap.get(name) ?? 0;
  }

  /** 🎒 Inventory overlay — tap an item to use it. */
  openInventory(): void {
    this.invRoot?.destroy({ children: true });
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const root = new Entity();
    const bg = new Graphics().roundRect(W / 2 - 250, H * 0.2, 500, H * 0.5, 16).fill({ color: 0x16131f, alpha: 0.96 });
    bg.eventMode = 'static';
    root.addChild(bg);
    const title = new Text({
      text: '🎒 INVENTORY',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0xffd166 },
    });
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, H * 0.2 + 18);
    root.addChild(title);
    const inv = this.invGet();
    const ids = Object.keys(inv);
    if (!ids.length) {
      const empty = new Text({
        text: '(nothing yet)',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 24, fill: 0x9a97b8 },
      });
      empty.anchor.set(0.5);
      empty.position.set(W / 2, H * 0.2 + 110);
      root.addChild(empty);
    }
    ids.slice(0, 8).forEach((id, i) => {
      const d = this.itemDefOf(id);
      if (!d) return;
      const row = new Text({
        text: `${d.emoji} ${tr(d.name)}  ×${inv[id]}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '700', fill: 0xe6e4f0 },
      });
      row.anchor.set(0, 0.5);
      row.position.set(W / 2 - 220, H * 0.2 + 90 + i * 46);
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointertap', () => {
        this.useItem(id);
        this.openInventory(); // rebuild counts
      });
      root.addChild(row);
    });
    const close = new Text({
      text: '✕',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0x9a97b8 },
    });
    close.anchor.set(0.5);
    close.position.set(W / 2 + 220, H * 0.2 + 34);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointertap', () => {
      root.destroy({ children: true });
      this.invRoot = null;
    });
    root.addChild(close);
    this.add(root);
    this.invRoot = root;
  }

  // ------------------------------------------------------ 🎥 camera api
  private camPan: { fx: number; fy: number; tx: number; ty: number; secs: number; t: number } | null = null;
  private camHold = false;
  private shakeT = 0;
  private shakePower = 0;
  private lastShakeX = 0;
  private lastShakeY = 0;
  private letterboxG: Graphics | null = null;

  cameraPanTo(x: number, y: number, secs: number): void {
    const vw = this.game.viewWidth;
    const vh = this.game.viewHeight;
    const tx = -Math.max(0, Math.min(this.sceneDef.worldW - vw, x - vw / 2));
    const ty = -Math.max(0, Math.min(this.sceneDef.worldH - vh, y - vh / 2));
    this.camPan = { fx: this.world.position.x, fy: this.world.position.y, tx, ty, secs: Math.max(0.05, secs), t: 0 };
    this.camHold = true;
  }

  private setLetterbox(on: boolean): void {
    if (on && !this.letterboxG) {
      const W = this.game.viewWidth;
      const H = this.game.viewHeight;
      const g = new Graphics().rect(0, 0, W, 84).fill(0x000000).rect(0, H - 84, W, 84).fill(0x000000);
      this.stage.addChild(g);
      this.letterboxG = g;
    } else if (!on && this.letterboxG) {
      this.letterboxG.destroy();
      this.letterboxG = null;
    }
  }

  cameraHolding(): boolean {
    return this.camHold;
  }

  private tickCamera(dt: number): void {
    // undo last frame's shake before anything repositions
    this.world.position.x -= this.lastShakeX;
    this.world.position.y -= this.lastShakeY;
    this.lastShakeX = 0;
    this.lastShakeY = 0;
    if (this.camPan) {
      const p = this.camPan;
      p.t += dt;
      const k = Math.min(1, p.t / p.secs);
      const e = 1 - (1 - k) ** 2;
      this.world.position.set(p.fx + (p.tx - p.fx) * e, p.fy + (p.ty - p.fy) * e);
      if (k >= 1) this.camPan = null; // camHold keeps us parked here
    } else if (!this.camHold) {
      this.camera?.update(dt);
      this.centerWorld();
    }
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.lastShakeX = (Math.random() - 0.5) * this.shakePower;
      this.lastShakeY = (Math.random() - 0.5) * this.shakePower;
      this.world.position.x += this.lastShakeX;
      this.world.position.y += this.lastShakeY;
    }
  }

  private titleRoot: Entity | null = null;
  titlePaused = false;

  /** Save-slot title screen (RPG-style Continue / New Game + volumes). */
  showTitle(): void {
    if (this.titleRoot) return;
    this.titlePaused = true;
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const root = new Entity();
    const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.93 });
    bg.eventMode = 'static';
    root.addChild(bg);
    const title = new Text({
      text: this.project.name,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 58, fontWeight: '800', fill: 0xffd166, align: 'center' },
    });
    title.anchor.set(0.5);
    title.position.set(W / 2, H * 0.26);
    root.addChild(title);
    const best = Number(this.saveStore().get('__best', 0)) || 0;
    if (best > 0) {
      const sub = new Text({
        text: `best score ${best}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '700', fill: 0x9a97b8 },
      });
      sub.anchor.set(0.5);
      sub.position.set(W / 2, H * 0.26 + 52);
      root.addChild(sub);
    }
    const played = !!this.saveStore().get('__played', false);
    let by = H * 0.44;
    if (played) {
      const cont = new UIButton('▶ CONTINUE', { fill: 0x8affc1, onTap: () => this.dismissTitle() });
      cont.position.set(W / 2, by);
      root.addChild(cont);
      by += 110;
    }
    const fresh = new UIButton(played ? '✚ NEW GAME' : '▶ PLAY', {
      onTap: () => {
        if (played) this.wipeSave();
        this.dismissTitle();
      },
    });
    fresh.position.set(W / 2, by);
    root.addChild(fresh);
    // volume bars: 5 notches each for music + sfx
    const bar = (label: string, bus: 'music' | 'sfx', y: number): void => {
      const t = new Text({
        text: label,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fill: 0xe6e4f0 },
      });
      t.anchor.set(1, 0.5);
      t.position.set(W / 2 - 120, y);
      root.addChild(t);
      const draw = (g: Graphics): void => {
        g.clear();
        const v = audio.getVolume(bus);
        for (let i = 0; i < 5; i++) {
          const on = v >= (i + 1) / 5 - 0.001;
          g.roundRect(W / 2 - 100 + i * 46, y - 11, 38, 22, 6).fill(on ? 0xc77dff : 0x35304d);
        }
      };
      const g = new Graphics();
      draw(g);
      g.eventMode = 'static';
      g.cursor = 'pointer';
      g.on('pointerdown', (ev) => {
        const local = g.toLocal(ev.global);
        const i = Math.max(0, Math.min(4, Math.floor((local.x - (W / 2 - 100)) / 46)));
        audio.setVolume(bus, (i + 1) / 5);
        draw(g);
        if (bus === 'sfx') audio.blip();
      });
      root.addChild(g);
    };
    bar('🎵', 'music', H * 0.44 + (played ? 220 : 110));
    bar('🔊', 'sfx', H * 0.44 + (played ? 270 : 160));
    this.add(root);
    this.titleRoot = root;
  }

  private wipeSave(): void {
    this.saveStore().clear();
    createSave('studio-skills').remove(this.project.name);
    this.xpValue = 0;
    this.levelValue = 1;
    this.refreshLevelHud();
    this.refreshHearts();
    this.refreshCoinHud();
  }

  private dismissTitle(): void {
    if (!this.titleRoot) return;
    if (!this.titleRoot.destroyed) this.titleRoot.destroy({ children: true });
    this.titleRoot = null;
    this.titlePaused = false;
    this.saveStore().set('__played', true);
    audio.chime();
  }

  titleVisible(): boolean {
    return !!this.titleRoot;
  }

  titlePick(kind: 'continue' | 'new'): void {
    if (!this.titleRoot) return;
    if (kind === 'new') this.wipeSave();
    this.dismissTitle();
  }

  private endGame(message: string): void {
    if (this.over) return;
    this.over = true;
    {
      const W = this.game.viewWidth;
      const H = this.game.viewHeight;
      const root = new Entity();
      const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.85 });
      bg.eventMode = 'static';
      root.addChild(bg);
      const title = new Text({
        text: message,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 62,
          fontWeight: '800',
          fill: 0xffd166,
          align: 'center',
        },
      });
      title.anchor.set(0.5);
      title.position.set(W / 2, H * 0.4);
      root.addChild(title);
      // the best score lives in the game's save file
      const store = this.saveStore();
      const best = Math.max(this.scoreValue, Number(store.get('__best', 0)) || 0);
      store.set('__best', best);
      const sub = new Text({
        text: best > this.scoreValue ? `score ${this.scoreValue} · best ${best}` : `score ${this.scoreValue}`,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 32,
          fontWeight: '700',
          fill: 0xe6e4f0,
        },
      });
      sub.anchor.set(0.5);
      sub.position.set(W / 2, H * 0.5);
      root.addChild(sub);
      this.add(root);
    }
  }

  protected override onUpdate(dt: number): void {
    if (this.scoreText) this.scoreText.text = String(this.scoreValue);
    // Player movement: arrows/WASD + the touch joystick, clamped to design.
    if (!this.over && !this.titlePaused) {
      const depth = this.sceneDef.view === 'depth';
      // Gravity means two different things by view: top = platformer physics
      // (run + jump on a fixed ground); 2.5D = a BRAWLER jump (Castle
      // Crashers): you rise above the ground plane, keep steering in x AND
      // depth while airborne, and land wherever you are on the plane.
      const brawlerJump = depth && this.sceneDef.gravity;
      let kx = 0;
      let ky = 0;
      if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w') || (!brawlerJump && this.keys.has(' '))) ky -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
      const jx = this.joystick?.value.x ?? 0;
      const jy = this.joystick?.value.y ?? 0;
      const mx = kx || jx;
      const my = ky || jy;
      const W = this.sceneDef.worldW;
      const H = this.sceneDef.worldH;
      if (this.sceneDef.gravity && !depth) {
        // Gravity physics: run left/right; up (or joystick up) jumps.
        for (const p of this.players) {
          if (p.entity.destroyed) continue;
          if (mx) {
            p.entity.x = Math.max(20, Math.min(W - 20, p.entity.x + mx * p.speed * dt));
            this.face(p.entity, mx);
          }
          const grounded = p.entity.y >= p.groundY - 1;
          if (my < -0.4 && grounded) {
            p.vy = -880;
            audio.blip(1.3);
          }
          p.vy += 2100 * dt;
          p.entity.y = Math.min(p.groundY, p.entity.y + p.vy * dt);
          if (p.entity.y >= p.groundY) p.vy = 0;
        }
      } else {
        if (mx || my) {
          const len = Math.hypot(mx, my) || 1;
          // 2.5D: the horizon is a wall — you walk the ground band, not the
          // sky — and up/down is a slower lane than the run.
          const minY = depth ? DEPTH_MIN_Y : 20;
          const laneY = depth ? DEPTH_LANE_SPEED : 1;
          for (const p of this.players) {
            if (p.entity.destroyed) continue;
            const dx = (mx / len) * p.speed * dt;
            const dy = (my / len) * p.speed * laneY * dt;
            if (mx !== 0) this.face(p.entity, mx);
            if (this.tileMap) {
              // Painted solid tiles (walls, water, trees) block movement.
              const moved = moveWithCollision(this.tileMap, p.entity.x, p.entity.y, 16, 14, dx, dy);
              p.entity.x = Math.max(20, Math.min(W - 20, moved.x));
              p.entity.y = Math.max(minY, Math.min(H - 20, moved.y));
            } else {
              p.entity.x = Math.max(20, Math.min(W - 20, p.entity.x + dx));
              p.entity.y = Math.max(minY, Math.min(H - 20, p.entity.y + dy));
            }
          }
        }
        if (brawlerJump) {
          if (this.keys.has(' ')) this.tryJump();
          this.tickJump(dt);
        }
      }
      for (const p of this.players) {
        if (p.entity.destroyed) continue;
        this.autoClip(p.def, p.z > 0 ? 'jump' : mx || my ? 'walk' : 'idle');
      }
      this.updateMobs(dt);
      this.tickAbilities(dt);
      this.tickCoinPickup();
      for (const cb of this.updaters) cb(dt);
    }
    // Multiplayer: ship my position, render everyone else.
    if (this.net) {
      const me = this.players[0]?.entity;
      this.net.tick(dt, me && !me.destroyed ? { x: me.x, y: me.y } : null);
      this.syncRemotes(dt);
    }
    if (this.sceneDef.view === 'depth') this.applyDepth();
    this.tickCamera(dt);
  }

  cameraX(): number {
    return -this.world.position.x;
  }

  worldSize(): { w: number; h: number } {
    return { w: this.sceneDef.worldW, h: this.sceneDef.worldH };
  }

  /** 2.5D: higher on screen = further away — drawn behind, subtly smaller. */
  private applyDepth(): void {
    this.world.sortableChildren = true;
    const apply = (c: Container, fallbackBase = 1): void => {
      if (c.destroyed) return;
      if (!this.baseScales.has(c)) this.baseScales.set(c, c.scale.x || fallbackBase);
      c.scale.set(this.baseScales.get(c)! * depthScale(c.y));
      c.zIndex = c.y;
    };
    for (const e of this.byName.values()) apply(e);
    for (const { root } of this.remoteViews.values()) apply(root, 1);
  }

  entityCount(): number {
    return this.byName.size;
  }

  /** Entities that are actually rendering at a sane size — regression probe
   *  for the vanish-on-play class of bug. */
  visibleEntityCount(): number {
    let n = 0;
    for (const e of this.byName.values()) {
      if (e.destroyed || !e.visible || e.alpha < 0.05) continue;
      const pop = viewPop.get(e);
      const body = viewBody.get(e);
      const scale =
        Math.abs(e.scale.x) * Math.abs(pop?.scale.x ?? 1) * Math.abs(body?.scale.x ?? 1);
      if (scale > 0.05) n++;
    }
    return n;
  }

  remoteCount(): number {
    return this.remoteViews.size;
  }

  hasTiles(): boolean {
    return !!this.tileMap;
  }

  skillTree(): SkillTree | null {
    return this.skillsTree;
  }

  scoreNow(): number {
    return this.scoreValue;
  }

  isOver(): boolean {
    return this.over;
  }

  mobCount(): number {
    return this.mobStates.size;
  }

  mobHpOf(name: string): number {
    return this.mobStates.get(name)?.hp ?? 0;
  }

  heartsState(): { now: number; max: number } {
    return { now: this.heartsVal, max: this.heartsMax };
  }

  xpNow(): number {
    return this.xpValue;
  }

  levelNow(): number {
    return this.levelValue;
  }

  abilityCount(): number {
    return this.abilityStates.length;
  }

  bossBarVisible(): boolean {
    return !!this.bossBarRoot?.visible;
  }

  shotsFired(): number {
    return this.shotsFiredTotal;
  }

  musicNow(): string | null {
    return audio.music.current();
  }

  coinsNow(): number {
    return this.coinsGet();
  }

  mobEnraged(name: string): boolean {
    return this.mobStates.get(name)?.enraged ?? false;
  }
}

export type { SkillTreeDef };
