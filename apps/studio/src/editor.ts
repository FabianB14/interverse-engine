/**
 * The Studio controller: owns the project, the engine canvas (true WYSIWYG —
 * the center pane IS the engine), selection/drag editing, scene switching,
 * play mode, and persistence. Panels (inspector, code, story, chat) talk to
 * the world through this class.
 */
import { Container, Graphics } from 'pixi.js';
import { Scene, createGame } from '@interverse/engine';
import type { Game } from '@interverse/engine';
import type { EntityDef, EntityKind, ProjectDef, SceneDef } from './model.js';
import { defaultEntity, defaultProject, defaultScene, freshId, parseProject } from './model.js';
import { PlayScene, buildView } from './runtime.js';

const SAVE_KEY = 'interverse.studio.project';

class BootScene extends Scene {}

/** Editor scene: static views of the current SceneDef + a selection ring. */
class EditScene extends Scene {
  views = new Map<string, Container>();
  ring = new Graphics();

  constructor(
    private readonly editor: StudioEditor,
    private readonly def: SceneDef,
  ) {
    super();
  }

  protected override onEnter(): void {
    const bg = new Graphics()
      .rect(0, 0, this.game.designWidth, this.game.designHeight)
      .fill(this.def.background);
    bg.eventMode = 'static';
    bg.on('pointerdown', () => this.editor.select(null));
    this.stage.addChildAt(bg, 0);
    // design-space frame so authors see the phone bounds
    const frame = new Graphics()
      .rect(1, 1, this.game.designWidth - 2, this.game.designHeight - 2)
      .stroke({ color: 0xc77dff, width: 2, alpha: 0.35 });
    this.stage.addChild(frame);
    for (const e of this.def.entities) this.addViewFor(e);
    this.stage.addChild(this.ring);
    this.editor.refreshRing();
  }

  addViewFor(def: EntityDef): void {
    const v = buildView(def, this.editor.project.assets);
    v.eventMode = 'static';
    v.cursor = 'pointer';
    v.on('pointerdown', (ev) => {
      ev.stopPropagation();
      this.editor.select(def.id);
      this.editor.beginDrag(def, ev.globalX, ev.globalY);
    });
    this.stage.addChild(v);
    this.views.set(def.id, v);
  }

  removeViewFor(id: string): void {
    const v = this.views.get(id);
    if (v) {
      v.destroy({ children: true });
      this.views.delete(id);
    }
  }

  syncView(def: EntityDef): void {
    // Cheap + correct: rebuild the one view (defs are tiny).
    this.removeViewFor(def.id);
    this.addViewFor(def);
    this.stage.addChild(this.ring); // keep the ring on top
  }
}

export class StudioEditor {
  project: ProjectDef;
  sceneId: string;
  selectedId: string | null = null;
  playing = false;
  game!: Game;

  private editScene: EditScene | null = null;
  private playScene: PlayScene | null = null;
  private drag: { def: EntityDef; dx: number; dy: number } | null = null;
  private saveTimer = 0;

  /** Panels subscribe to refresh themselves. */
  onChanged: () => void = () => {};
  onSelection: () => void = () => {};
  onPlayState: () => void = () => {};
  onScriptError: (err: unknown) => void = () => {};

  constructor() {
    const saved = localStorage.getItem(SAVE_KEY);
    let project: ProjectDef | null = null;
    if (saved) {
      try {
        project = parseProject(saved);
      } catch {
        project = null;
      }
    }
    this.project = project ?? defaultProject();
    this.sceneId = this.project.startScene;
  }

  async boot(mount: HTMLElement): Promise<void> {
    this.game = await createGame({
      width: 720,
      height: 1280,
      background: 0x0b0a12,
      mount,
      scene: new BootScene(),
    });
    this.openEditScene();

    // Drag-to-move plumbing (design coords derived from the world transform).
    const canvas = this.game.app.canvas;
    canvas.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      const p = this.toDesign(ev.clientX, ev.clientY);
      this.drag.def.x = Math.round(p.x - this.drag.dx);
      this.drag.def.y = Math.round(p.y - this.drag.dy);
      const v = this.editScene?.views.get(this.drag.def.id);
      v?.position.set(this.drag.def.x, this.drag.def.y);
      this.refreshRing();
    });
    window.addEventListener('pointerup', () => {
      if (this.drag) {
        this.drag = null;
        this.touch();
      }
    });
  }

  // ---------------------------------------------------------------- scenes

  get scene(): SceneDef {
    return this.project.scenes.find((s) => s.id === this.sceneId) ?? this.project.scenes[0]!;
  }

  openEditScene(): void {
    this.playing = false;
    this.playScene = null;
    this.editScene = new EditScene(this, this.scene);
    this.game.scenes.replace(this.editScene);
    this.onPlayState();
  }

  switchScene(id: string): void {
    if (!this.project.scenes.some((s) => s.id === id)) return;
    this.sceneId = id;
    this.selectedId = null;
    if (this.playing) this.openPlayScene(this.scene);
    else this.openEditScene();
    this.onSelection();
    this.onChanged();
  }

  addScene(name: string): SceneDef {
    const s = defaultScene(name || `Level ${this.project.scenes.length + 1}`);
    this.project.scenes.push(s);
    this.switchScene(s.id);
    this.touch();
    return s;
  }

  // ----------------------------------------------------------------- play

  play(): void {
    this.playing = true;
    this.selectedId = null;
    this.openPlayScene(this.scene);
    this.onSelection();
    this.onPlayState();
  }

  stop(): void {
    this.openEditScene();
  }

  private openPlayScene(def: SceneDef): void {
    this.editScene = null;
    this.playScene = new PlayScene(
      this.project,
      def,
      (next) => {
        this.sceneId = next.id;
        this.openPlayScene(next);
        this.onChanged();
      },
      (err) => this.onScriptError(err),
    );
    this.game.scenes.replace(this.playScene);
  }

  playEntityCount(): number {
    return this.playScene?.entityCount() ?? 0;
  }

  /** Run code against the LIVE play scene right now (Code tab "Apply"). */
  runScriptNow(code: string): void {
    if (!this.playScene) return;
    try {
      const fn = new Function('api', code) as (api: unknown) => void;
      fn(this.playScene.makeApi());
    } catch (err) {
      this.onScriptError(err);
    }
  }

  // -------------------------------------------------------------- editing

  addEntity(kind: EntityKind, x: number, y: number): EntityDef {
    const def = defaultEntity(kind, x, y);
    // Unique, friendly name: blob, blob 2, blob 3...
    const names = new Set(this.scene.entities.map((e) => e.name));
    let name = def.name;
    for (let n = 2; names.has(name); n++) name = `${def.kind} ${n}`;
    def.name = name;
    this.scene.entities.push(def);
    this.editScene?.addViewFor(def);
    this.editScene?.stage.addChild(this.editScene.ring);
    this.select(def.id);
    this.touch();
    return def;
  }

  removeEntity(id: string): void {
    const i = this.scene.entities.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.scene.entities.splice(i, 1);
    this.editScene?.removeViewFor(id);
    if (this.selectedId === id) this.select(null);
    this.touch();
  }

  updateEntity(def: EntityDef): void {
    this.editScene?.syncView(def);
    this.refreshRing();
    this.touch();
  }

  entityByName(name: string): EntityDef | undefined {
    return this.scene.entities.find((e) => e.name === name);
  }

  get selected(): EntityDef | null {
    return this.scene.entities.find((e) => e.id === this.selectedId) ?? null;
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.refreshRing();
    this.onSelection();
  }

  beginDrag(def: EntityDef, gx: number, gy: number): void {
    if (this.playing) return;
    const p = this.toDesignFromGlobal(gx, gy);
    this.drag = { def, dx: p.x - def.x, dy: p.y - def.y };
  }

  refreshRing(): void {
    const ring = this.editScene?.ring;
    if (!ring) return;
    ring.clear();
    const def = this.selected;
    if (!def) return;
    const v = this.editScene?.views.get(def.id);
    if (!v) return;
    const b = v.getLocalBounds();
    ring
      .roundRect(
        def.x + (b.x - 6) * def.scale,
        def.y + (b.y - 6) * def.scale,
        (b.width + 12) * def.scale,
        (b.height + 12) * def.scale,
        10,
      )
      .stroke({ color: 0xc77dff, width: 3, alpha: 0.9 });
  }

  // ---------------------------------------------------------- coordinates

  /** Client (mouse) coords -> game design coords. */
  toDesign(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.game.app.canvas.getBoundingClientRect();
    return this.toDesignFromGlobal(clientX - rect.left, clientY - rect.top);
  }

  private toDesignFromGlobal(gx: number, gy: number): { x: number; y: number } {
    const w = this.game.world;
    return { x: (gx - w.position.x) / w.scale.x, y: (gy - w.position.y) / w.scale.y };
  }

  // ---------------------------------------------------------- persistence

  touch(): void {
    this.onChanged();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  saveNow(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.project));
    } catch {
      /* storage full (giant images) — export still works */
    }
  }

  exportJson(): string {
    return JSON.stringify(this.project, null, 2);
  }

  importJson(json: string): void {
    this.project = parseProject(json);
    this.sceneId = this.project.startScene;
    this.selectedId = null;
    this.openEditScene();
    this.onChanged();
    this.onSelection();
    this.saveNow();
  }

  addAsset(dataUrl: string): string {
    const id = freshId('a');
    this.project.assets[id] = dataUrl;
    this.touch();
    return id;
  }
}
