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
import { StudioNet, resolveRelayUrl } from './net.js';
import { slugify } from './publish.js';
import { COLS, ROWS, TILE_SIZE, buildTileLayer, emptyRows, setTileChar, tileCharAt } from './tiles.js';

const SAVE_KEY = 'interverse.studio.project';

class BootScene extends Scene {}

/** Editor scene: static views of the current SceneDef + a selection ring. */
class EditScene extends Scene {
  views = new Map<string, Container>();
  ring = new Graphics();
  private tileLayer: Container | null = null;

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
    bg.on('pointerdown', (ev) => this.editor.canvasDown(ev.globalX, ev.globalY));
    this.stage.addChildAt(bg, 0);
    this.refreshTiles();
    // design-space frame so authors see the phone bounds
    const frame = new Graphics()
      .rect(1, 1, this.game.designWidth - 2, this.game.designHeight - 2)
      .stroke({ color: 0xc77dff, width: 2, alpha: 0.35 });
    this.stage.addChild(frame);
    for (const e of this.def.entities) this.addViewFor(e);
    this.stage.addChild(this.ring);
    this.editor.refreshRing();
  }

  /** Rebuild the painted-tile layer (sits just above the background). */
  refreshTiles(): void {
    // Scene transitions are async — before onEnter the stage is empty and
    // onEnter will call us again, so bail rather than mis-index.
    if (!this.stage.children.length) return;
    this.tileLayer?.destroy({ children: true });
    this.tileLayer = null;
    if (this.def.tiles) {
      this.tileLayer = buildTileLayer(this.def.tiles).view;
      this.tileLayer.eventMode = 'none';
      this.stage.addChildAt(this.tileLayer, Math.min(1, this.stage.children.length));
    }
  }

  /** Live 2.5D preview in the EDITOR: depth-scale + sort while view=depth. */
  protected override onUpdate(): void {
    if (this.def.view !== 'depth') return;
    this.stage.sortableChildren = true;
    for (const def of this.def.entities) {
      const v = this.views.get(def.id);
      if (!v || v.destroyed) continue;
      const depth = Math.max(0.45, Math.min(1.25, 0.35 + (def.y - 380) / 700));
      v.scale.set(def.scale * depth);
      v.zIndex = def.y;
    }
    this.ring.zIndex = 1e9;
  }

  addViewFor(def: EntityDef): void {
    const v = buildView(def, this.editor.project.assets);
    v.eventMode = this.editor.tileChar ? 'none' : 'static';
    v.cursor = 'pointer';
    v.on('pointerdown', (ev) => {
      ev.stopPropagation();
      this.editor.select(def.id);
      this.editor.beginDrag(def, ev.globalX, ev.globalY);
    });
    this.stage.addChild(v);
    this.views.set(def.id, v);
  }

  /** Tile-paint mode: entities must not swallow canvas pointer events. */
  setViewsInteractive(on: boolean): void {
    for (const v of this.views.values()) v.eventMode = on ? 'static' : 'none';
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

    // Drag-to-move + tile painting plumbing (design coords from the world
    // transform).
    const canvas = this.game.app.canvas;
    canvas.addEventListener('pointermove', (ev) => {
      if (this.painting && this.tileChar) {
        const p = this.toDesign(ev.clientX, ev.clientY);
        this.paintAt(p.x, p.y);
        return;
      }
      if (!this.drag) return;
      const p = this.toDesign(ev.clientX, ev.clientY);
      this.drag.def.x = Math.round(p.x - this.drag.dx);
      this.drag.def.y = Math.round(p.y - this.drag.dy);
      const v = this.editScene?.views.get(this.drag.def.id);
      v?.position.set(this.drag.def.x, this.drag.def.y);
      this.refreshRing();
    });
    window.addEventListener('pointerup', () => {
      if (this.painting) {
        this.painting = false;
        this.editScene?.refreshTiles();
        this.touch();
      }
      if (this.drag) {
        this.drag = null;
        this.touch();
      }
    });
  }

  // ------------------------------------------------------------- painting

  /** Active tile character while painting; null = normal select/drag mode. */
  tileChar: string | null = null;
  private painting = false;
  private tileRefreshTimer = 0;

  setTileMode(ch: string | null): void {
    this.tileChar = ch;
    this.painting = false;
    this.editScene?.setViewsInteractive(ch === null);
    if (ch !== null) this.select(null);
  }

  /** Pointer-down on the canvas background: paint, or clear the selection. */
  canvasDown(gx: number, gy: number): void {
    if (this.playing) return;
    if (this.tileChar) {
      this.painting = true;
      const p = this.toDesignFromGlobal(gx, gy);
      this.paintAt(p.x, p.y);
    } else {
      this.select(null);
    }
  }

  paintAt(x: number, y: number): void {
    const ch = this.tileChar;
    if (!ch) return;
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
    this.scene.tiles ??= emptyRows();
    if (tileCharAt(this.scene.tiles, col, row) === ch) return;
    setTileChar(this.scene.tiles, col, row, ch);
    // Throttled rebuild while the stroke is in flight; final on pointerup.
    if (!this.tileRefreshTimer) {
      this.tileRefreshTimer = window.setTimeout(() => {
        this.tileRefreshTimer = 0;
        this.editScene?.refreshTiles();
      }, 80);
    }
  }

  setTile(col: number, row: number, ch: string): void {
    this.scene.tiles ??= emptyRows();
    setTileChar(this.scene.tiles, col, row, ch);
    this.editScene?.refreshTiles();
    this.touch();
  }

  tileAt(col: number, row: number): string {
    return this.scene.tiles ? tileCharAt(this.scene.tiles, col, row) : '.';
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

  net: StudioNet | null = null;
  /** Set by main: opens the host/join/solo lobby overlay. */
  onNeedLobby: () => void = () => {};

  play(): void {
    if (this.project.multiplayer && !this.net) {
      this.onNeedLobby();
      return;
    }
    this.beginPlay();
  }

  /** Play without multiplayer even when the project has it on. */
  playSolo(): void {
    this.beginPlay();
  }

  private beginPlay(): void {
    this.playing = true;
    this.selectedId = null;
    this.openPlayScene(this.scene);
    this.onSelection();
    this.onPlayState();
  }

  private gameTag(): string {
    return `studio-${slugify(this.project.name)}`;
  }

  async hostMultiplayer(): Promise<string> {
    const relay = resolveRelayUrl();
    if (!relay) throw new Error('no relay configured');
    this.net = await StudioNet.host(relay, this.gameTag());
    this.beginPlay();
    return this.net.code;
  }

  async joinMultiplayer(code: string): Promise<void> {
    const relay = resolveRelayUrl();
    if (!relay) throw new Error('no relay configured');
    this.net = await StudioNet.join(code.toUpperCase(), relay, this.gameTag());
    this.beginPlay();
  }

  stop(): void {
    this.net?.leave();
    this.net = null;
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
      this.net,
    );
    this.game.scenes.replace(this.playScene);
  }

  playEntityCount(): number {
    return this.playScene?.entityCount() ?? 0;
  }

  getPlayScene(): PlayScene | null {
    return this.playScene;
  }

  /** Replace the whole project with a parsed object (templates, ?load=). */
  importProject(p: ProjectDef): void {
    this.importJson(JSON.stringify(p));
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
