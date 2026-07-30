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
  darken,
  easings,
  lighten,
  makeTappable,
  moveWithCollision,
  verium,
} from '@interverse/engine';
import type { DialogueData, Game, TileMapData } from '@interverse/engine';
import { DialogueBox } from '@interverse/ui';
import { fetchChainBalance } from '@interverse/platform';
import { drawIcon } from './icons.js';
import { defaultEntity } from './model.js';
import type { EntityDef, ProjectDef, SceneDef, TapSound } from './model.js';
import { SkillTree } from './skills.js';
import type { SkillTreeDef } from './skills.js';
import type { StudioNet } from './net.js';
import { anyTiles, buildTileLayer } from './tiles.js';

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
        text: def.text || ' ',
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
      const w = Math.max(160, def.text.length * def.fontSize * 0.62 + 60);
      const h = Math.max(84, def.fontSize + 44);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(def.color);
      body.addChild(g);
      const t = new Text({
        text: def.text || ' ',
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
            const sp = new AnimatedSprite(frames.length ? frames : [tex]);
            sp.anchor.set(0.5);
            sp.animationSpeed = Math.max(0.5, def.fps || 8) / 60;
            sp.play();
            body.addChildAt(sp, 0);
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
  const lines = def.lines.length ? def.lines : ['…'];
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
  /** Player hearts HUD; contact with mobs costs hearts, 0 = game over.
   *  (Auto-enabled at 3 when a player + mobs share a scene.) */
  hearts: (n: number) => void;
  /** XP + level HUD; mob defeats grant their XP, each level-up awards a
   *  skill point into api.skills. */
  levels: (opts?: { xpPerLevel?: number }) => void;
  xp: { add: (n: number) => void; get: () => number };
  level: () => number;
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
  private players: { entity: Entity; speed: number; groundY: number; vy: number }[] = [];
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
    }
    // The camera crops the board to the current view (adaptive: a rotated
    // device sees a wide ~720-tall window) and follows the player.
    this.camera = new Camera(this.world, this.game.viewWidth, this.game.viewHeight, {
      deadzoneWidth: 120,
      deadzoneHeight: 160,
    });
    this.camera.setBounds(0, 0, this.sceneDef.worldW, this.sceneDef.worldH);
    for (const def of this.sceneDef.entities) this.spawnDef(def);
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
    return e;
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
    if (m.hp <= 0) this.defeatMob(m);
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
      need = this.xpNeed();
    }
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
      if (vx || vy) {
        m.e.x = Math.max(20, Math.min(W - 20, m.e.x + vx * m.def.moveSpeed * dt));
        m.e.y = Math.max(minY, Math.min(H - 20, m.e.y + vy * m.def.moveSpeed * dt));
      }
      // touching the player costs a heart (with i-frames + knockback)
      if (me && !me.destroyed && this.heartsMax > 0 && this.hurtT <= 0) {
        if (Math.hypot(me.x - m.e.x, me.y - m.e.y) < m.def.radius * m.def.scale + 30) {
          this.hurtPlayer(m.def.damage, m.e);
        }
      }
    }
    this.updateBossBar();
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
        const nodes: DialogueData['nodes'] = {};
        lines.forEach((text, i) => {
          nodes[`n${i}`] = {
            speaker,
            text,
            ...(i < lines.length - 1 ? { next: `n${i + 1}` } : {}),
          };
        });
        this.openStory({ start: 'n0', nodes });
      },
      player: (name, speed = 300) => {
        const e = this.byName.get(name);
        if (!e) return undefined;
        this.players.push({ entity: e, speed, groundY: e.y, vy: 0 });
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
      hearts: (n) => this.enableHearts(n),
      levels: (opts) => this.enableLevels(opts),
      xp: { add: (n) => this.addXp(n), get: () => this.xpValue },
      level: () => this.levelValue,
      gameOver: (message = 'GAME OVER') => this.endGame(message),
    };
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
      const sub = new Text({
        text: `score ${this.scoreValue}`,
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
    if (!this.over) {
      let kx = 0;
      let ky = 0;
      if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w') || this.keys.has(' ')) ky -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
      const jx = this.joystick?.value.x ?? 0;
      const jy = this.joystick?.value.y ?? 0;
      const mx = kx || jx;
      const my = ky || jy;
      const W = this.sceneDef.worldW;
      const H = this.sceneDef.worldH;
      if (this.sceneDef.gravity) {
        // Gravity physics: run left/right; up (or joystick up) jumps.
        for (const p of this.players) {
          if (p.entity.destroyed) continue;
          if (mx) p.entity.x = Math.max(20, Math.min(W - 20, p.entity.x + mx * p.speed * dt));
          const grounded = p.entity.y >= p.groundY - 1;
          if (my < -0.4 && grounded) {
            p.vy = -880;
            audio.blip(1.3);
          }
          p.vy += 2100 * dt;
          p.entity.y = Math.min(p.groundY, p.entity.y + p.vy * dt);
          if (p.entity.y >= p.groundY) p.vy = 0;
        }
      } else if (mx || my) {
        const len = Math.hypot(mx, my) || 1;
        // 2.5D: the horizon is a wall — you walk the ground band, not the sky —
        // and up/down is a slower lane than the run (Castle Crashers feel).
        const depth = this.sceneDef.view === 'depth';
        const minY = depth ? DEPTH_MIN_Y : 20;
        const laneY = depth ? DEPTH_LANE_SPEED : 1;
        for (const p of this.players) {
          if (p.entity.destroyed) continue;
          const dx = (mx / len) * p.speed * dt;
          const dy = (my / len) * p.speed * laneY * dt;
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
      this.updateMobs(dt);
      this.tickAbilities(dt);
      for (const cb of this.updaters) cb(dt);
    }
    // Multiplayer: ship my position, render everyone else.
    if (this.net) {
      const me = this.players[0]?.entity;
      this.net.tick(dt, me && !me.destroyed ? { x: me.x, y: me.y } : null);
      this.syncRemotes(dt);
    }
    if (this.sceneDef.view === 'depth') this.applyDepth();
    this.camera?.update(dt);
    this.centerWorld();
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
}

export type { SkillTreeDef };
