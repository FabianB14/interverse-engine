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
import { defaultEntity } from './model.js';
import type { EntityDef, ProjectDef, SceneDef, TapSound } from './model.js';

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
}

/** Live play-through of a project scene: behaviors, taps, stories, script. */
export class PlayScene extends Scene {
  private byName = new Map<string, Entity>();
  private updaters: ((dt: number) => void)[] = [];
  private box: DialogueBox | null = null;

  constructor(
    private readonly project: ProjectDef,
    private readonly sceneDef: SceneDef,
    private readonly onGoto: (scene: SceneDef) => void,
    private readonly onScriptError: (err: unknown) => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    const bg = new Graphics()
      .rect(0, 0, this.game.designWidth, this.game.designHeight)
      .fill(this.sceneDef.background);
    this.stage.addChildAt(bg, 0);
    for (const def of this.sceneDef.entities) this.spawnDef(def);
    // Verium chip when the project is wired into Interverse.
    if (this.project.interverse) {
      const chip = new Text({
        text: `⬡ ${verium.balance()}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fontWeight: '800', fill: 0x8affc1 },
      });
      chip.position.set(16, 12);
      this.stage.addChild(chip);
      this.updaters.push(() => (chip.text = `⬡ ${verium.balance()}`));
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

  makeApi(): ScriptApi {
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
    };
  }

  protected override onUpdate(dt: number): void {
    for (const cb of this.updaters) cb(dt);
  }

  entityCount(): number {
    return this.byName.size;
  }
}
