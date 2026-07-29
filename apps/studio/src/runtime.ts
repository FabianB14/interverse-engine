/**
 * Project runtime — turns EntityDefs into live engine display objects.
 * The editor uses buildView() for static WYSIWYG; PlayScene runs the real
 * thing: behaviors, tap sounds, NPC dialogue, and the scene script.
 */
import { Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  DialogueRunner,
  Entity,
  Scene,
  VirtualJoystick,
  Wobble,
  audio,
  blobCharacter,
  darken,
  lighten,
  makeTappable,
  popIn,
  verium,
} from '@interverse/engine';
import type { DialogueData, Game } from '@interverse/engine';
import { DialogueBox } from '@interverse/ui';
import { fetchChainBalance } from '@interverse/platform';
import { defaultEntity } from './model.js';
import type { EntityDef, ProjectDef, SceneDef, TapSound } from './model.js';
import { SkillTree } from './skills.js';
import type { SkillTreeDef } from './skills.js';
import type { StudioNet } from './net.js';

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

/** Build the visual for a def. Static — no behaviors, no interactivity. */
export function buildView(def: EntityDef, assets: Record<string, string>): Entity {
  const e = new Entity();
  const g = new Graphics();
  switch (def.kind) {
    case 'blob':
    case 'npc': {
      const char = blobCharacter({ radius: def.radius, color: def.color, seed: def.seed });
      e.addChild(char.view);
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
        e.addChild(g);
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
      e.addChild(g);
      break;
    }
    case 'lantern': {
      g.roundRect(-6, -10, 12, 46, 4).fill(0x2a2740);
      g.circle(0, -26, 18).fill(lighten(def.color, 0.25));
      g.circle(0, -26, 18).stroke({ color: def.color, width: 3 });
      g.circle(0, -26, 34).fill({ color: def.color, alpha: 0.18 });
      e.addChild(g);
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
      e.addChild(g);
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
      e.addChild(t);
      break;
    }
    case 'button': {
      const w = Math.max(160, def.text.length * def.fontSize * 0.62 + 60);
      const h = Math.max(84, def.fontSize + 44);
      g.roundRect(-w / 2, -h / 2, w, h, h / 2).fill(def.color);
      e.addChild(g);
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
      e.addChild(t);
      break;
    }
    case 'image': {
      const url = assets[def.assetId];
      if (url) {
        assetTexture(url, (tex) => {
          const sp = new Sprite(tex);
          sp.anchor.set(0.5);
          e.addChildAt(sp, 0);
        });
      } else {
        g.roundRect(-40, -40, 80, 80, 8).fill({ color: 0xffffff, alpha: 0.1 });
        g.roundRect(-40, -40, 80, 80, 8).stroke({ color: 0x9a97b8, width: 2 });
        e.addChild(g);
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

/** Live play-through of a project scene: behaviors, taps, stories, script. */
export class PlayScene extends Scene {
  private byName = new Map<string, Entity>();
  private updaters: ((dt: number) => void)[] = [];
  private box: DialogueBox | null = null;
  private keys = new Set<string>();
  private players: { entity: Entity; speed: number }[] = [];
  private joystick: VirtualJoystick | null = null;
  private scoreValue = 0;
  private scoreText: Text | null = null;
  private skillsTree: SkillTree | null = null;
  private over = false;
  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key.toLowerCase());
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
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 17, fontWeight: '700', fill: 0xe6e4f0 },
        });
        label.anchor.set(0.5);
        label.position.set(0, 46);
        root.addChild(label);
        root.position.set(r.x, r.y);
        this.add(root);
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
    const bg = new Graphics()
      .rect(0, 0, this.game.designWidth, this.game.designHeight)
      .fill(this.sceneDef.background);
    this.stage.addChildAt(bg, 0);
    for (const def of this.sceneDef.entities) this.spawnDef(def);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    // Verium chip when the project is wired into Interverse — shows the local
    // wallet, plus the on-chain IVX balance when a platform is configured.
    if (this.project.interverse) {
      const chip = new Text({
        text: `⬡ ${verium.balance()}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '800', fill: 0x8affc1 },
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

  spawnDef(def: EntityDef): Entity {
    const e = buildView(def, this.project.assets);
    this.add(e);
    this.byName.set(def.name, e);
    if (def.wobble) e.addBehavior(new Wobble({ target: e, amount: 0.04, speed: 2.2 }));
    if (def.popIn) popIn(e, { duration: 0.4 });
    if (def.tapSound || def.kind === 'npc' || def.kind === 'button') {
      makeTappable(e, () => {
        playSound(def.tapSound);
        if (def.kind === 'npc') this.openStory(dialogueFor(def));
      });
    }
    return e;
  }

  private openStory(data: DialogueData): void {
    if (!this.box) {
      this.box = new DialogueBox();
      this.box.position.set(
        (this.game.designWidth - 656) / 2,
        this.game.designHeight - 330,
      );
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
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 34, fontWeight: '800', fill: 0xffd166 },
    });
    this.scoreText.anchor.set(1, 0);
    this.scoreText.position.set(this.game.designWidth - 16, 12);
    this.stage.addChild(this.scoreText);
  }

  makeApi(): ScriptApi {
    if (!this.skillsTree) this.skillsTree = new SkillTree(this, this.project.name);
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
          nodes[`n${i}`] = { speaker, text, ...(i < lines.length - 1 ? { next: `n${i + 1}` } : {}) };
        });
        this.openStory({ start: 'n0', nodes });
      },
      player: (name, speed = 300) => {
        const e = this.byName.get(name);
        if (!e) return undefined;
        this.players.push({ entity: e, speed });
        if (!this.joystick) {
          this.joystick = new VirtualJoystick({ radius: 90 });
          this.joystick.position.set(150, this.game.designHeight - 170);
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
      gameOver: (message = 'GAME OVER') => {
        if (this.over) return;
        this.over = true;
        const W = this.game.designWidth;
        const H = this.game.designHeight;
        const root = new Entity();
        const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.85 });
        bg.eventMode = 'static';
        root.addChild(bg);
        const title = new Text({
          text: message,
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 62, fontWeight: '800', fill: 0xffd166, align: 'center' },
        });
        title.anchor.set(0.5);
        title.position.set(W / 2, H * 0.4);
        root.addChild(title);
        const sub = new Text({
          text: `score ${this.scoreValue}`,
          style: { fontFamily: 'system-ui, sans-serif', fontSize: 32, fontWeight: '700', fill: 0xe6e4f0 },
        });
        sub.anchor.set(0.5);
        sub.position.set(W / 2, H * 0.5);
        root.addChild(sub);
        this.add(root);
      },
    };
  }

  protected override onUpdate(dt: number): void {
    if (this.scoreText) this.scoreText.text = String(this.scoreValue);
    // Player movement: arrows/WASD + the touch joystick, clamped to design.
    if (!this.over) {
      let kx = 0;
      let ky = 0;
      if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w')) ky -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
      const jx = this.joystick?.value.x ?? 0;
      const jy = this.joystick?.value.y ?? 0;
      const mx = kx || jx;
      const my = ky || jy;
      if (mx || my) {
        const len = Math.hypot(mx, my) || 1;
        for (const p of this.players) {
          if (p.entity.destroyed) continue;
          p.entity.x = Math.max(20, Math.min(this.game.designWidth - 20, p.entity.x + (mx / len) * p.speed * dt));
          p.entity.y = Math.max(20, Math.min(this.game.designHeight - 20, p.entity.y + (my / len) * p.speed * dt));
        }
      }
      for (const cb of this.updaters) cb(dt);
    }
    // Multiplayer: ship my position, render everyone else.
    if (this.net) {
      const me = this.players[0]?.entity;
      this.net.tick(dt, me && !me.destroyed ? { x: me.x, y: me.y } : null);
      this.syncRemotes(dt);
    }
  }

  entityCount(): number {
    return this.byName.size;
  }

  remoteCount(): number {
    return this.remoteViews.size;
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
}

export type { SkillTreeDef };
