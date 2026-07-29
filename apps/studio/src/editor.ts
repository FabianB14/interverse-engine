/**
 * The Studio controller: owns the project, the engine canvas (true WYSIWYG —
 * the center pane IS the engine), selection/drag editing, scene switching,
 * play mode, and persistence. Panels (inspector, code, story, chat) talk to
 * the world through this class.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Scene, createGame, darken, lighten } from '@interverse/engine';
import type { Game } from '@interverse/engine';
import type { EntityDef, EntityKind, ProjectDef, SceneDef } from './model.js';
import { defaultEntity, defaultProject, defaultScene, freshId, parseProject } from './model.js';
import { DEPTH_MIN_Y, PlayScene, buildView, depthScale } from './runtime.js';
import { StudioNet, resolveRelayUrl } from './net.js';
import { slugify } from './publish.js';
import {
  TILE_SIZE,
  buildTileLayer,
  colsFor,
  emptyRows,
  normalizeRows,
  rowsFor,
  setTileChar,
  tileCharAt,
} from './tiles.js';

const SAVE_KEY = 'interverse.studio.project';

class BootScene extends Scene {}

/** Editor scene: static views of the current SceneDef + a selection ring. */
class EditScene extends Scene {
  views = new Map<string, Container>();
  ring = new Graphics();
  world = new Container();
  private tileLayer: Container | null = null;
  private frameG = new Graphics();
  private frameLabel: Text | null = null;

  constructor(
    private readonly editor: StudioEditor,
    private readonly def: SceneDef,
  ) {
    super();
  }

  protected override onEnter(): void {
    // Everything sits in a pannable world so levels bigger than one screen
    // can be edited — the wheel/trackpad scrolls around them.
    this.stage.addChildAt(this.world, 0);
    const bg = new Graphics().rect(0, 0, this.def.worldW, this.def.worldH).fill(this.def.background);
    if (this.def.view === 'depth') {
      // Same backdrop/ground split the runtime draws: above the horizon is
      // scenery, the band below is where players walk (Castle Crashers).
      bg.rect(0, 0, this.def.worldW, DEPTH_MIN_Y).fill(lighten(this.def.background, 0.22));
      bg.rect(0, DEPTH_MIN_Y - 3, this.def.worldW, 6).fill({
        color: darken(this.def.background, 0.35),
        alpha: 0.6,
      });
    }
    bg.eventMode = 'static';
    bg.on('pointerdown', (ev) => this.editor.canvasDown(ev.globalX, ev.globalY));
    this.world.addChildAt(bg, 0);
    this.refreshTiles();
    // World frame + one guide line per extra screen of size.
    const frame = new Graphics()
      .rect(1, 1, this.def.worldW - 2, this.def.worldH - 2)
      .stroke({ color: 0xc77dff, width: 2, alpha: 0.35 });
    for (let gx = 720; gx < this.def.worldW; gx += 720) {
      frame.moveTo(gx, 0).lineTo(gx, this.def.worldH).stroke({ color: 0xc77dff, width: 1, alpha: 0.15 });
    }
    for (let gy = 1280; gy < this.def.worldH; gy += 1280) {
      frame.moveTo(0, gy).lineTo(this.def.worldW, gy).stroke({ color: 0xc77dff, width: 1, alpha: 0.15 });
    }
    this.world.addChild(frame);
    for (const e of this.def.entities) this.addViewFor(e);
    this.world.addChild(this.ring);
    this.editor.refreshRing();
    this.applyPan();
    this.frameG.eventMode = 'none';
    this.stage.addChild(this.frameG);
    this.refreshFrame();
  }

  protected override onResize(): void {
    this.refreshFrame();
  }

  /** Screen-fit preview: dim everything a phone wouldn't see and outline the
   *  device frame — 📱 portrait or the rotated (landscape) screen — so you
   *  can check how things fit before playing. Pan to move the window. */
  refreshFrame(): void {
    this.frameG.clear();
    this.frameLabel?.destroy();
    this.frameLabel = null;
    const mode = this.editor.framePreview;
    if (mode === 'off') return;
    const fw = mode === 'landscape' ? 1280 : 720;
    const fh = mode === 'landscape' ? 720 : 1280;
    const vw = this.game.viewWidth;
    const vh = this.game.viewHeight;
    const x = Math.round((vw - fw) / 2);
    const y = Math.round((vh - fh) / 2);
    const dim = (rx: number, ry: number, rw: number, rh: number): void => {
      if (rw > 0 && rh > 0) this.frameG.rect(rx, ry, rw, rh).fill({ color: 0x000000, alpha: 0.45 });
    };
    dim(0, 0, vw, y);
    dim(0, y + fh, vw, vh - (y + fh));
    dim(0, Math.max(0, y), x, Math.min(vh, fh));
    dim(x + fw, Math.max(0, y), vw - (x + fw), Math.min(vh, fh));
    this.frameG.rect(x, y, fw, fh).stroke({ color: 0x8affc1, width: 3, alpha: 0.9 });
    this.frameLabel = new Text({
      text: mode === 'landscape' ? '↔ rotated screen' : '↕ portrait screen',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0x8affc1 },
    });
    this.frameLabel.eventMode = 'none';
    this.frameLabel.position.set(Math.max(10, x) + 12, Math.max(6, y) + 8);
    this.stage.addChild(this.frameLabel);
  }

  applyPan(): void {
    this.world.position.set(-this.editor.panX, -this.editor.panY);
  }

  /** Rebuild the painted-tile layer (sits just above the background). */
  refreshTiles(): void {
    // Scene transitions are async — before onEnter the stage is empty and
    // onEnter will call us again, so bail rather than mis-index.
    if (!this.world.children.length) return;
    this.tileLayer?.destroy({ children: true });
    this.tileLayer = null;
    if (this.def.tiles) {
      this.tileLayer = buildTileLayer(this.def.tiles).view;
      this.tileLayer.eventMode = 'none';
      this.world.addChildAt(this.tileLayer, Math.min(1, this.world.children.length));
    }
  }

  /** Live 2.5D preview in the EDITOR: depth-scale + sort while view=depth. */
  protected override onUpdate(): void {
    if (this.def.view !== 'depth') return;
    this.world.sortableChildren = true;
    for (const def of this.def.entities) {
      const v = this.views.get(def.id);
      if (!v || v.destroyed) continue;
      v.scale.set(def.scale * depthScale(def.y));
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
    this.world.addChild(v);
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
    this.world.addChild(this.ring); // keep the ring on top
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
    // Adaptive: like real mobile games, the view is a WINDOW into the world —
    // a rotated (landscape) device sees a wide ~720-tall crop, portrait sees
    // a tall one. Nobody ever sees the whole board at once on big levels.
    this.game = await createGame({
      width: 720,
      height: 1280,
      background: 0x0b0a12,
      adaptive: true,
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
    // Wheel/trackpad pans around levels bigger than one screen.
    canvas.addEventListener(
      'wheel',
      (ev) => {
        if (this.playing) return;
        ev.preventDefault();
        const scale = this.game.world.scale.x || 1;
        this.panBy(ev.deltaX / scale, ev.deltaY / scale);
      },
      { passive: false },
    );
  }

  // ------------------------------------------------------------ panning

  panX = 0;
  panY = 0;

  /** Editor-only screen-fit preview frame (see EditScene.refreshFrame). */
  framePreview: 'off' | 'landscape' | 'portrait' = 'off';

  setFramePreview(mode: 'off' | 'landscape' | 'portrait'): void {
    this.framePreview = mode;
    this.editScene?.refreshFrame();
  }

  panBy(dx: number, dy: number): void {
    const maxX = Math.max(0, this.scene.worldW - this.game.viewWidth);
    const maxY = Math.max(0, this.scene.worldH - this.game.viewHeight);
    this.panX = Math.max(0, Math.min(maxX, this.panX + dx));
    this.panY = Math.max(0, Math.min(maxY, this.panY + dy));
    this.editScene?.applyPan();
  }

  /** Resize the level (design units); painted tiles are preserved. */
  setWorldSize(w: number, h: number): void {
    this.scene.worldW = w;
    this.scene.worldH = h;
    if (this.scene.tiles) {
      this.scene.tiles = normalizeRows(this.scene.tiles, colsFor(w), rowsFor(h));
    }
    this.panX = 0;
    this.panY = 0;
    this.openEditScene();
    this.touch();
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
    const cols = colsFor(this.scene.worldW);
    const rows = rowsFor(this.scene.worldH);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    this.scene.tiles ??= emptyRows(cols, rows);
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
    this.scene.tiles ??= emptyRows(colsFor(this.scene.worldW), rowsFor(this.scene.worldH));
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
    this.panX = 0;
    this.panY = 0;
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
    // Screen -> design space, then shift by the editor pan into world coords.
    return {
      x: (gx - w.position.x) / w.scale.x + this.panX,
      y: (gy - w.position.y) / w.scale.y + this.panY,
    };
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
