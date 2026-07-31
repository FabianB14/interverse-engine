/**
 * The Studio controller: owns the project, the engine canvas (true WYSIWYG —
 * the center pane IS the engine), selection/drag editing, scene switching,
 * play mode, and persistence. Panels (inspector, code, story, chat) talk to
 * the world through this class.
 */
import { History } from './history.js';
import {
  CLIPBOARD_KEY, alignDefs, cloneForPaste, distributeDefs, isMarquee, toggleIn, withinMarquee,
} from './clipboard.js';
import type { AlignEdge } from './clipboard.js';
import { Container, Graphics, Text } from 'pixi.js';
import { Scene, createGame, darken, lighten } from '@interverse/engine';
import type { Game } from '@interverse/engine';
import type { EntityDef, EntityKind, ProjectDef, SceneDef } from './model.js';
import { defaultEntity, defaultProject, defaultScene, freshId, parseProject } from './model.js';
import { DEPTH_MIN_Y, PlayScene, buildView, depthScale } from './runtime.js';
import { StudioNet, resolveRelayUrl } from './net.js';
import { generateRows } from './gen.js';
import type { GeneratorKind } from './gen.js';
import { slugify } from './publish.js';
import {
  TILE_LAYERS,
  TILE_SIZE,
  anyTiles,
  buildTileLayer,
  colsFor,
  emptyRows,
  isTileLayerId,
  normalizeRows,
  rowsFor,
  setTileChar,
  tileCharAt,
  tileLayerSpec,
} from './tiles.js';
import type { TileLayerId } from './tiles.js';

/** A rectangle in design/world space. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SAVE_KEY = 'interverse.studio.project';
const LIB_INDEX = 'interverse.studio.library';

class BootScene extends Scene {}

/** Editor scene: static views of the current SceneDef + a selection ring. */
class EditScene extends Scene {
  views = new Map<string, Container>();
  ring = new Graphics();
  world = new Container();
  private tileLayers = new Map<TileLayerId, Container>();
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
    // Scene transitions are async — before onEnter there's no game attached
    // yet; onEnter calls us again once there is.
    if (!(this as unknown as { game?: unknown }).game) return;
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

  /** Rebuild the painted tile layers. Behind and main sit just above the
   *  background; the "in front" layer goes on top of the actors — dimmed,
   *  because in the EDITOR you still have to be able to see what you are
   *  moving underneath it. */
  refreshTiles(): void {
    // Scene transitions are async — before onEnter the stage is empty and
    // onEnter will call us again, so bail rather than mis-index.
    if (!this.world.children.length) return;
    for (const c of this.tileLayers.values()) c.destroy({ children: true });
    this.tileLayers.clear();
    for (const spec of TILE_LAYERS) {
      const rows = this.def[spec.key];
      if (!rows || !anyTiles(rows)) continue;
      const view = buildTileLayer(rows).view;
      view.eventMode = 'none';
      if (spec.id === 'over') {
        view.alpha = 0.65;
        view.zIndex = 2e9;
        this.world.addChild(view);
      } else {
        this.world.addChildAt(view, Math.min(spec.id === 'back' ? 1 : 2, this.world.children.length));
      }
      this.tileLayers.set(spec.id, view);
    }
    this.bringRingToFront();
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
      this.editor.pickEntity(def, ev.globalX, ev.globalY);
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

  /** Keep the highlight above the art it highlights. It must stay a child of
   *  `world` — the stage does not scroll, so a ring parked there detaches
   *  from its actor the moment you pan. */
  bringRingToFront(): void {
    this.ring.zIndex = 3e9;
    this.world.addChild(this.ring);
  }

  syncView(def: EntityDef): void {
    // Cheap + correct: rebuild the one view (defs are tiny).
    this.removeViewFor(def.id);
    this.addViewFor(def);
    this.bringRingToFront();
  }
}

export class StudioEditor {
  project: ProjectDef;
  sceneId: string;
  /** The selection. `selectedId` stays as "the one the inspector edits" —
   *  the last one clicked — so every existing single-select path keeps
   *  working while multi-select rides alongside it. */
  selectedIds: string[] = [];
  playing = false;
  game!: Game;

  private editScene: EditScene | null = null;
  private playScene: PlayScene | null = null;
  /** A drag carries the WHOLE selection: dx/dy is the grab offset for the
   *  actor under the pointer, and `others` their offsets relative to it. */
  private drag: { def: EntityDef; dx: number; dy: number; others: { def: EntityDef; ox: number; oy: number }[] } | null = null;
  /** Marquee in progress (design coords). */
  marquee: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  private saveTimer = 0;

  /** Panels subscribe to refresh themselves. */
  onChanged: () => void = () => {};
  /** Fired when the undo/redo buttons need refreshing. */
  onHistory: () => void = () => {};
  readonly history = new History();
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
    // Baseline for undo: the state before the author touches anything.
    this.history.reset(this.exportJson());

    // Drag-to-move + tile painting plumbing (design coords from the world
    // transform).
    const canvas = this.game.app.canvas;
    canvas.addEventListener('pointermove', (ev) => {
      if (this.painting && this.tileChar) {
        const p = this.toDesign(ev.clientX, ev.clientY);
        this.paintAt(p.x, p.y);
        return;
      }
      if (this.marquee) {
        this.marquee.b = this.toDesign(ev.clientX, ev.clientY);
        this.refreshRing();
        return;
      }
      if (!this.drag) return;
      const p = this.toDesign(ev.clientX, ev.clientY);
      this.editLabel = 'move';
      this.drag.def.x = Math.round(p.x - this.drag.dx);
      this.drag.def.y = Math.round(p.y - this.drag.dy);
      this.editScene?.views.get(this.drag.def.id)?.position.set(this.drag.def.x, this.drag.def.y);
      // Everything else in the selection rides along, keeping its spacing.
      for (const o of this.drag.others) {
        o.def.x = Math.round(this.drag.def.x + o.ox);
        o.def.y = Math.round(this.drag.def.y + o.oy);
        this.editScene?.views.get(o.def.id)?.position.set(o.def.x, o.def.y);
      }
      this.refreshRing();
    });
    window.addEventListener('pointerup', () => {
      if (this.marquee) {
        const { a, b } = this.marquee;
        this.marquee = null;
        if (isMarquee(a, b)) {
          const hit = withinMarquee(this.scene.entities, a, b);
          this.selectMany(this.marqueeAdditive ? [...this.selectedIds, ...hit] : hit);
        } else if (!this.marqueeAdditive) {
          this.select(null);
        }
        this.refreshRing();
      }
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
    const scene = this.scene as unknown as Record<string, string[] | undefined>;
    for (const spec of TILE_LAYERS) {
      if (scene[spec.key]) scene[spec.key] = normalizeRows(scene[spec.key], colsFor(w), rowsFor(h));
    }
    this.panX = 0;
    this.panY = 0;
    this.openEditScene();
    this.touch();
  }

  // ------------------------------------------------------------- painting

  /** Active tile character while painting; null = normal select/drag mode. */
  tileChar: string | null = null;
  /** 🥞 Which layer the brush writes to. */
  paintLayer: TileLayerId = 'main';

  setPaintLayer(id: string): TileLayerId {
    if (isTileLayerId(id)) this.paintLayer = id;
    return this.paintLayer;
  }

  /** The rows for a layer, created on demand — a layer nobody paints on
   *  never exists, and so never bloats a saved game. */
  private layerRows(id: TileLayerId = this.paintLayer): string[] {
    const key = tileLayerSpec(id).key;
    const scene = this.scene as unknown as Record<string, string[] | undefined>;
    scene[key] ??= emptyRows(colsFor(this.scene.worldW), rowsFor(this.scene.worldH));
    return scene[key]!;
  }

  /** Read-only peek that does NOT create the layer. */
  private layerRowsIfAny(id: TileLayerId): string[] | undefined {
    return (this.scene as unknown as Record<string, string[] | undefined>)[tileLayerSpec(id).key];
  }
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
      // Empty ground: start a marquee. It only becomes a marquee once the
      // pointer actually travels, so a plain click still just deselects.
      const p = this.toDesignFromGlobal(gx, gy);
      this.marquee = { a: p, b: p };
      this.marqueeAdditive = this.additiveKey;
    }
  }

  /** Held ctrl/shift at the moment of the gesture — set by main.ts, which
   *  owns the DOM events that know about modifier keys. */
  additiveKey = false;
  private marqueeAdditive = false;

  paintAt(x: number, y: number): void {
    const ch = this.tileChar;
    if (!ch) return;
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    const cols = colsFor(this.scene.worldW);
    const rows = rowsFor(this.scene.worldH);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    const target = this.layerRows();
    if (tileCharAt(target, col, row) === ch) return;
    setTileChar(target, col, row, ch);
    // Throttled rebuild while the stroke is in flight; final on pointerup.
    if (!this.tileRefreshTimer) {
      this.tileRefreshTimer = window.setTimeout(() => {
        this.tileRefreshTimer = 0;
        this.editScene?.refreshTiles();
      }, 80);
    }
  }

  /** 🎲 Procedural generation into this level's paint layer. */
  generateTiles(kind: GeneratorKind): void {
    this.editLabel = 'generate tiles';
    const scene = this.scene as unknown as Record<string, string[] | undefined>;
    scene[tileLayerSpec(this.paintLayer).key] = generateRows(
      kind,
      colsFor(this.scene.worldW),
      rowsFor(this.scene.worldH),
    );
    this.editScene?.refreshTiles();
    this.touch();
  }

  setTile(col: number, row: number, ch: string, layer?: string): void {
    this.editLabel = 'paint';
    setTileChar(this.layerRows(layer && isTileLayerId(layer) ? layer : this.paintLayer), col, row, ch);
    this.editScene?.refreshTiles();
    this.touch();
  }

  tileAt(col: number, row: number, layer?: string): string {
    const rows = this.layerRowsIfAny(layer && isTileLayerId(layer) ? layer : this.paintLayer);
    return rows ? tileCharAt(rows, col, row) : '.';
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
    this.selectedIds = [];
    this.panX = 0;
    this.panY = 0;
    if (this.playing) this.openPlayScene(this.scene);
    else this.openEditScene();
    this.onSelection();
    this.onChanged();
  }

  addScene(name: string): SceneDef {
    this.editLabel = 'add level';
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
    this.selectedIds = [];
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

  /** Which 💾 save slot the current run belongs to. api.goto builds a whole
   *  new PlayScene, so the slot has to live out here to survive a level
   *  change — otherwise every doorway would drop you back into slot 1. */
  private activeSlot = 1;

  private openPlayScene(def: SceneDef): void {
    this.editScene = null;
    const scene = new PlayScene(
      this.project,
      def,
      (next) => {
        this.activeSlot = scene.activeSlot;
        this.sceneId = next.id;
        this.openPlayScene(next);
        this.onChanged();
      },
      (err) => this.onScriptError(err),
      this.net,
    );
    scene.activeSlot = this.activeSlot;
    // The relay URL and game tag live out here, so rejoining does too.
    scene.onLinkLost = () => {
      const relay = resolveRelayUrl();
      if (relay && this.net) void this.net.reconnect(relay, this.gameTag());
    };
    scene.onSlotChange = (n) => {
      this.activeSlot = n;
    };
    this.playScene = scene;
    this.game.scenes.replace(scene);
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
    this.editLabel = 'add actor';
    const def = defaultEntity(kind, x, y);
    // Unique, friendly name: blob, blob 2, blob 3...
    const names = new Set(this.scene.entities.map((e) => e.name));
    let name = def.name;
    for (let n = 2; names.has(name); n++) name = `${def.kind} ${n}`;
    def.name = name;
    this.scene.entities.push(def);
    this.editScene?.addViewFor(def);
    this.editScene?.bringRingToFront();
    this.select(def.id);
    this.touch();
    return def;
  }

  removeEntity(id: string): void {
    this.editLabel = 'delete actor';
    if (!this.dropEntity(id)) return;
    if (this.selectedIds.includes(id)) this.select(null);
    this.touch();
  }

  /** Remove without recording — so deleting a whole selection is ONE undo,
   *  not one per actor. */
  private dropEntity(id: string): boolean {
    const i = this.scene.entities.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.scene.entities.splice(i, 1);
    this.editScene?.removeViewFor(id);
    return true;
  }

  updateEntity(def: EntityDef): void {
    this.editLabel = 'edit actor';
    this.editScene?.syncView(def);
    this.refreshRing();
    this.touch();
  }

  entityByName(name: string): EntityDef | undefined {
    return this.scene.entities.find((e) => e.name === name);
  }

  get selectedId(): string | null {
    return this.selectedIds[this.selectedIds.length - 1] ?? null;
  }

  get selected(): EntityDef | null {
    return this.scene.entities.find((e) => e.id === this.selectedId) ?? null;
  }

  /** Every selected actor, in scene order. */
  get selection(): EntityDef[] {
    const ids = new Set(this.selectedIds);
    return this.scene.entities.filter((e) => ids.has(e.id));
  }

  /** `additive` is ctrl/shift-click: toggle rather than replace. */
  select(id: string | null, additive = false): void {
    if (id === null) this.selectedIds = [];
    else if (additive) this.selectedIds = toggleIn(this.selectedIds, id);
    else this.selectedIds = [id];
    this.refreshRing();
    this.onSelection();
  }

  selectMany(ids: readonly string[]): void {
    this.selectedIds = [...new Set(ids)];
    this.refreshRing();
    this.onSelection();
  }

  selectAll(): void {
    this.selectMany(this.scene.entities.map((e) => e.id));
  }

  /** Copy the selection. Kept in localStorage too, so it survives a reload
   *  and can be pasted into a project open in another tab. */
  copy(): number {
    const defs = this.selection;
    if (!defs.length) return 0;
    this.clip = structuredClone(defs);
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(this.clip));
    } catch {
      /* quota — the in-memory copy still works */
    }
    return defs.length;
  }

  cut(): number {
    const n = this.copy();
    if (n) this.deleteSelected();
    return n;
  }

  private clipboard(): EntityDef[] {
    if (this.clip.length) return this.clip;
    try {
      const raw = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? '[]') as EntityDef[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /** Paste into the CURRENT level — which may not be the one they were
   *  copied from, and is the main reason paste exists. */
  paste(at?: { x: number; y: number }): number {
    const defs = this.clipboard();
    if (!defs.length) return 0;
    this.editLabel = 'paste';
    const made = cloneForPaste(defs, this.scene, at ? { at } : {});
    for (const d of made) {
      this.scene.entities.push(d);
      this.editScene?.addViewFor(d);
    }
    this.editScene?.bringRingToFront();
    this.selectMany(made.map((d) => d.id));
    this.touch();
    return made.length;
  }

  duplicate(): number {
    const defs = this.selection;
    if (!defs.length) return 0;
    this.editLabel = 'duplicate';
    const made = cloneForPaste(defs, this.scene);
    for (const d of made) {
      this.scene.entities.push(d);
      this.editScene?.addViewFor(d);
    }
    this.editScene?.bringRingToFront();
    this.selectMany(made.map((d) => d.id));
    this.touch();
    return made.length;
  }

  deleteSelected(): number {
    const ids = [...this.selectedIds];
    if (!ids.length) return 0;
    this.editLabel = ids.length > 1 ? `delete ${ids.length} actors` : 'delete actor';
    let n = 0;
    for (const id of ids) if (this.dropEntity(id)) n++;
    this.selectMany([]);
    this.touch();
    return n;
  }

  /** Arrow-key nudge, and the align/distribute tools. */
  nudge(dx: number, dy: number): number {
    const defs = this.selection;
    if (!defs.length) return 0;
    this.editLabel = 'move';
    for (const d of defs) {
      d.x = Math.max(20, Math.min(this.scene.worldW - 20, d.x + dx));
      d.y = Math.max(20, Math.min(this.scene.worldH - 20, d.y + dy));
      this.editScene?.views.get(d.id)?.position.set(d.x, d.y);
    }
    this.refreshRing();
    this.touch();
    return defs.length;
  }

  align(edge: AlignEdge): number {
    const defs = this.selection;
    this.editLabel = 'align';
    const n = alignDefs(defs, edge);
    if (n) this.afterBulkMove(defs);
    return n;
  }

  distribute(): number {
    const defs = this.selection;
    this.editLabel = 'align';
    const n = distributeDefs(defs);
    if (n) this.afterBulkMove(defs);
    return n;
  }

  /** Move one actor to a point and carry the rest of the selection with it —
   *  the same thing a canvas drag does, reachable without a pointer. */
  dragSelectionTo(def: EntityDef, x: number, y: number): void {
    const others = this.selection
      .filter((d) => d.id !== def.id)
      .map((d) => ({ def: d, ox: d.x - def.x, oy: d.y - def.y }));
    this.editLabel = 'move';
    def.x = Math.round(x);
    def.y = Math.round(y);
    for (const o of others) {
      o.def.x = Math.round(def.x + o.ox);
      o.def.y = Math.round(def.y + o.oy);
    }
    this.afterBulkMove([def, ...others.map((o) => o.def)]);
  }

  private afterBulkMove(defs: EntityDef[]): void {
    for (const d of defs) this.editScene?.views.get(d.id)?.position.set(d.x, d.y);
    this.refreshRing();
    this.touch();
  }

  private clip: EntityDef[] = [];

  /**
   * Pointer-down on an actor. Three cases, and getting the middle one wrong
   * is what makes multi-select feel broken elsewhere: clicking an actor that
   * is ALREADY part of a group must not collapse the group, or you can never
   * drag the group you just made.
   */
  pickEntity(def: EntityDef, gx: number, gy: number): void {
    if (this.playing) return;
    if (this.additiveKey) {
      this.select(def.id, true);
      // Ctrl-clicking a selected actor removes it — there is nothing to drag.
      if (!this.selectedIds.includes(def.id)) return;
    } else if (!this.selectedIds.includes(def.id)) {
      this.select(def.id);
    } else {
      // Already in the selection: promote it to primary (the one the
      // inspector edits) and keep everyone else.
      this.selectedIds = [...this.selectedIds.filter((i) => i !== def.id), def.id];
      this.refreshRing();
      this.onSelection();
    }
    this.beginDrag(def, gx, gy);
  }

  beginDrag(def: EntityDef, gx: number, gy: number): void {
    if (this.playing) return;
    const p = this.toDesignFromGlobal(gx, gy);
    const others = this.selection
      .filter((d) => d.id !== def.id)
      .map((d) => ({ def: d, ox: d.x - def.x, oy: d.y - def.y }));
    this.drag = { def, dx: p.x - def.x, dy: p.y - def.y, others };
  }

  refreshRing(): void {
    const ring = this.editScene?.ring;
    if (!ring) return;
    ring.clear();
    const sel = this.selection;
    for (const def of sel) {
      const v = this.editScene?.views.get(def.id);
      if (!v) continue;
      const b = v.getLocalBounds();
      // Read the scale off the VIEW, not the def: a 2.5D level scales actors
      // by their depth, so a ring sized from def.scale alone floats off the
      // art it is supposed to be hugging.
      const sx = v.scale.x || def.scale;
      const sy = v.scale.y || def.scale;
      // The last-clicked one is brighter: it is what the inspector edits.
      const primary = def.id === this.selectedId;
      ring
        .roundRect(
          def.x + b.x * sx - 6,
          def.y + b.y * sy - 6,
          b.width * sx + 12,
          b.height * sy + 12,
          10,
        )
        .stroke({ color: 0xc77dff, width: primary ? 3 : 2, alpha: primary ? 0.9 : 0.5 });
    }
    // The marquee, while one is being dragged.
    if (this.marquee) {
      const { a, b } = this.marquee;
      ring
        .rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y))
        .stroke({ color: 0x8affc1, width: 2, alpha: 0.8 });
    }
  }

  /** The ring's box and the primary actor's box, both in WORLD space, so a
   *  test can assert the highlight is actually around the art. */
  selectionBoxes(): { ring: Box; view: Box } | null {
    const def = this.selected;
    const ring = this.editScene?.ring;
    const v = def ? this.editScene?.views.get(def.id) : null;
    if (!def || !ring || !v) return null;
    const r = ring.getLocalBounds();
    const lb = v.getLocalBounds();
    const box = (x: number, y: number, w: number, h: number): Box => ({
      x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
    });
    return {
      ring: box(r.x, r.y, r.width, r.height),
      view: box(
        def.x + lb.x * v.scale.x,
        def.y + lb.y * v.scale.y,
        lb.width * v.scale.x,
        lb.height * v.scale.y,
      ),
    };
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

  /** Label for the next recorded change — set it right before a touch() to
   *  say what the undo button should offer ('move', 'rename', 'paint'…). */
  editLabel = 'edit';

  touch(): void {
    this.history.record(this.exportJson(), this.editLabel);
    this.onHistory();
    this.onChanged();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  /** Run an edit under a label, so undo describes it properly. */
  edit(label: string, fn: () => void): void {
    const was = this.editLabel;
    this.editLabel = label;
    try {
      fn();
    } finally {
      this.editLabel = was;
    }
  }

  undo(): boolean {
    const json = this.history.undo();
    if (json === null) return false;
    this.history.apply(() => this.importJson(json));
    this.onHistory();
    return true;
  }

  redo(): boolean {
    const json = this.history.redo();
    if (json === null) return false;
    this.history.apply(() => this.importJson(json));
    this.onHistory();
    return true;
  }

  historyState(): { canUndo: boolean; canRedo: boolean; undoLabel: string; redoLabel: string } {
    return {
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      undoLabel: this.history.undoLabel(),
      redoLabel: this.history.redoLabel(),
    };
  }

  historyDepth(): { past: number; future: number } {
    return this.history.depth();
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

  // ------------------------------------------------------ project library

  /** Named save slots for whole games ("My games") — one per project name,
   *  kept in localStorage alongside the rolling autosave. */
  libraryList(): { id: string; name: string; updated: number }[] {
    try {
      return JSON.parse(localStorage.getItem(LIB_INDEX) ?? '[]') as {
        id: string;
        name: string;
        updated: number;
      }[];
    } catch {
      return [];
    }
  }

  saveToLibrary(): string {
    const id = slugify(this.project.name) || 'game';
    localStorage.setItem(`${LIB_INDEX}.${id}`, JSON.stringify(this.project));
    const list = this.libraryList().filter((e) => e.id !== id);
    list.unshift({ id, name: this.project.name, updated: Date.now() });
    localStorage.setItem(LIB_INDEX, JSON.stringify(list));
    this.saveNow();
    return id;
  }

  openFromLibrary(id: string): boolean {
    const raw = localStorage.getItem(`${LIB_INDEX}.${id}`);
    if (!raw) return false;
    try {
      this.importJson(raw);
      return true;
    } catch {
      return false;
    }
  }

  deleteFromLibrary(id: string): void {
    localStorage.removeItem(`${LIB_INDEX}.${id}`);
    localStorage.setItem(LIB_INDEX, JSON.stringify(this.libraryList().filter((e) => e.id !== id)));
  }

  importJson(json: string): void {
    // Undo restores the whole project, so without this it would also throw
    // you back to the first level — taking back an edit should not move you.
    // A genuinely different project has no scene with this id, so loading a
    // template still lands on its start scene.
    const keep = this.sceneId;
    this.project = parseProject(json);
    this.sceneId = this.project.scenes.some((s) => s.id === keep) ? keep : this.project.startScene;
    this.selectedIds = [];
    this.openEditScene();
    // Loading a template or a file is a big step you should be able to take
    // back — but a restore driven BY undo must not record itself.
    if (!this.history.isApplying) {
      this.history.record(this.exportJson(), this.editLabel === 'edit' ? 'load project' : this.editLabel);
      this.onHistory();
    }
    this.onChanged();
    this.onSelection();
    this.saveNow();
  }

  addAsset(dataUrl: string): string {
    this.editLabel = 'import art';
    const id = freshId('a');
    this.project.assets[id] = dataUrl;
    this.touch();
    return id;
  }
}
