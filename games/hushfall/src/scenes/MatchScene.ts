import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  Entity,
  Scene,
  Timer,
  Tween,
  VirtualJoystick,
  Wobble,
  blobCharacter,
  buildTileMapView,
  easings,
  moveWithCollision,
  solidAt,
  tileMapFromRows,
  verium,
} from '@interverse/engine';
import type { TileMapData } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { classById } from '../classes.js';
import { NIGHT, setTerror, sting, updateHeartbeat } from '../theme.js';
import { accessoryView } from '../accessories.js';
import { TILE_SIZE, arenaRows, legend, painters } from '../map.js';
import { makeText } from '../text.js';
import { saveLastRoom, clearLastRoom } from '../store.js';
import { MenuScene } from './MenuScene.js';
import type { RosterState } from './LobbyScene.js';

const SEND = 0.1;
const LANTERN_RADIUS = 96;
const LANTERN_SECONDS = 8; // one hider lights a lantern in ~8s (faster in a group)
const ATTACK_RANGE = 170; // the Seeker strikes from a fair reach (longer than melee)
// Fog of war: a small lit disc around you, darkness beyond. Vision is tight by
// default and only grows with an ability (Flashlight / Third Eye).
const FOG_CLEAR = 210; // fully lit within this radius (design units)
const FOG_DARK = 360; // fully dark beyond this radius
const FOG_SPRITE_R = 2000; // fog texture reach (must cover the screen)
const SEEKER_SIGHT_FULL = 190;
const SEEKER_SIGHT_FADE = 320;
const HIDER_SIGHT_FULL = 240;
const HIDER_SIGHT_FADE = 380;
const VISION_BOOST = 2.3; // how much Flashlight / Third Eye widens your vision
const VISION_BOOST_SECS = 6;
// Hiding: a hider inside a hiding spot is invisible to the Seeker (and can't be
// struck) until the Seeker searches — steps within SEARCH_RADIUS of them.
const HIDE_RADIUS = 68;
const SEARCH_RADIUS = 104;
const REVIVE_RADIUS = 86;
const REVIVE_SECONDS = 4;
const BLEED_SECONDS = 30;
const GATE_RADIUS = 90;
const SNARE_RADIUS = 60;
const SNARE_SECONDS = 2.6;
const VANISH_SECONDS = 4.5;
const DECOY_SECONDS = 8;
const BOT_FLEE_DIST = 250;
const BOT_ATTACK_EVERY = 1.2;

interface PosMsg {
  type: 'pos';
  x: number;
  y: number;
}
interface AbilityMsg {
  type: 'ability';
  id: string;
  x: number;
  y: number;
}
interface AttackMsg {
  type: 'attack';
}
interface RevealFx {
  type: 'reveal';
  points: { x: number; y: number }[];
  color: number;
  secs: number;
}
interface Fx {
  type: 'fx';
  kind: 'down' | 'rescue' | 'lantern' | 'gate' | 'escape' | 'snare' | 'decoy' | 'attack' | 'screech' | 'poof';
  x: number;
  y: number;
  id?: string;
}
interface Snap {
  type: 'snap';
  players: Record<string, { x: number; y: number }>;
  lant: number[];
  gate: boolean;
  down: Record<string, number>;
  esc: string[];
  out: string[];
  hidden: string[];
  vanished: string[];
  rooted: string[];
  decoys: { x: number; y: number }[];
  phase: string;
}
interface EndMsg {
  type: 'end';
  result: string;
}
interface ToLobbyMsg {
  type: 'toLobby';
}
interface HelloMsg {
  type: 'hello';
}

type Msg = PosMsg | AbilityMsg | AttackMsg | RevealFx | Fx | Snap | EndMsg | ToLobbyMsg | HelloMsg;

interface Remote {
  entity: Entity;
  body: Container;
  targetX: number;
  targetY: number;
  mark: Graphics;
}

/** Radial darkness texture: transparent core, opaque beyond, cached once. */
let fogTexture: Texture | null = null;
function getFogTexture(): Texture | null {
  if (fogTexture) return fogTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const clear = FOG_CLEAR / FOG_SPRITE_R;
  const dark = FOG_DARK / FOG_SPRITE_R;
  g.addColorStop(0, 'rgba(4,3,10,0)');
  g.addColorStop(clear, 'rgba(4,3,10,0)');
  g.addColorStop((clear + dark) / 2, 'rgba(4,3,10,0.82)');
  g.addColorStop(dark, 'rgba(4,3,10,0.995)');
  g.addColorStop(1, 'rgba(4,3,10,0.995)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  fogTexture = Texture.from(canvas);
  return fogTexture;
}

/** 1 within `full`, 0 beyond `fade`, linear between. */
function sightAlpha(dist: number, full: number, fade: number): number {
  if (dist <= full) return 1;
  if (dist >= fade) return 0;
  return (fade - dist) / (fade - full);
}

export class MatchScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private tileView!: Container;
  private uiLayer!: Container;
  private camera!: Camera;
  private me!: Entity;
  private meBody!: Container;
  private joystick!: VirtualJoystick;
  private remotes = new Map<string, Remote>();
  private hostPositions: Record<string, { x: number; y: number }> = {};
  private sendIn = 0;
  private t = 0;
  private walk = 0;
  private live = true;

  // shared/derived
  private amSeeker = false;
  private seekerId = '';
  private spawn = { x: 0, y: 0 };
  private seekerSpawn = { x: 0, y: 0 };
  private lanternPts: { x: number; y: number }[] = [];
  private hidePts: { x: number; y: number }[] = [];
  private gatePt = { x: 0, y: 0 };

  // host sim state
  private lant: number[] = [];
  private gateOpen = false;
  private down: Record<string, number> = {};
  private reviveProg: Record<string, number> = {};
  private escaped = new Set<string>();
  private out = new Set<string>();
  private vanishUntil: Record<string, number> = {};
  private rootUntil: Record<string, number> = {};
  private traps: { x: number; y: number }[] = [];
  private decoys: { x: number; y: number; until: number }[] = [];
  private phase = 'playing';

  // client mirror
  private snapLant: number[] = [];
  private snapGate = false;
  private snapDown: Record<string, number> = {};
  private snapHidden = new Set<string>();
  private snapVanished = new Set<string>();
  private snapRooted = new Set<string>();

  // bots (host-simulated)
  private botAtkCd = 0;
  private botPaths = new Map<string, { goal: string; path: [number, number][]; idx: number }>();

  // local ability
  private cooldownLeft = 0;
  private boostUntil = 0;
  private boostFactor = 1;
  private visionBoostUntil = 0;
  private fogBaseScale = 1;
  private abilityUses = 0;
  private revealSeen = 0;
  private attackCd = 0;

  // HUD
  private hud!: Text;
  private roleHud!: Text;
  private terrorVignette!: Graphics;
  private fog: Sprite | null = null;
  private abilityBtn!: UIButton;
  private attackBtn: UIButton | null = null;
  private homeBtn!: UIButton;
  private codeHud!: Text;
  private myBar!: Graphics;
  private partyPanel!: Container;
  private decoyViews: Entity[] = [];
  private endShown = false;

  constructor(
    private readonly session: Session,
    private readonly roster: RosterState,
  ) {
    super();
  }

  protected override onResize(w: number, h: number): void {
    this.layoutUi(w, h);
  }

  private layoutUi(W: number, H: number): void {
    this.joystick?.position.set(160, H - 180);
    this.abilityBtn?.position.set(W - 118, H - 130);
    this.attackBtn?.position.set(W - 118, H - 300);
    this.homeBtn?.position.set(W - 46, 44);
    this.codeHud?.position.set(W / 2, 40);
    this.hud?.position.set(16, 74);
    this.roleHud?.position.set(16, 110);
    this.partyPanel?.position.set(16, 150);
    this.terrorVignette?.clear();
    this.terrorVignette?.rect(0, 0, W, H).fill({ color: NIGHT.blood, alpha: 0.5 });
    this.camera?.setViewSize(W, H);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const session = this.session;
    this.seekerId = this.roster.seekerId ?? this.roster.order[0] ?? session.id;
    this.amSeeker = this.seekerId === session.id;
    if (!session.isHost) saveLastRoom(session.code);

    this.map = tileMapFromRows(arenaRows, TILE_SIZE, legend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.tileView = buildTileMapView(this.map, painters);
    this.mapLayer.addChildAt(this.tileView, 0);

    const spawnObj = this.map.objects.find((o) => o.name === 'spawn') ?? { x: 800, y: 1600 };
    const seekObj = this.map.objects.find((o) => o.name === 'seekerspawn') ?? { x: 800, y: 800 };
    const gateObj = this.map.objects.find((o) => o.name === 'gate') ?? { x: 800, y: 120 };
    this.spawn = { x: spawnObj.x, y: spawnObj.y };
    this.seekerSpawn = { x: seekObj.x, y: seekObj.y };
    this.gatePt = { x: gateObj.x, y: gateObj.y };
    this.lanternPts = this.map.objects.filter((o) => o.name === 'lantern').map((o) => ({ x: o.x, y: o.y }));
    this.hidePts = this.map.objects.filter((o) => o.name === 'hide').map((o) => ({ x: o.x, y: o.y }));
    this.lant = this.lanternPts.map(() => 0);
    this.snapLant = this.lanternPts.map(() => 0);

    this.drawObjectives();

    // My blob.
    const myIndex = Math.max(0, this.roster.order.indexOf(session.id));
    const mine = this.makeBlob(session.id, true);
    this.me = mine.entity;
    this.meBody = mine.body;
    const start = this.amSeeker ? this.seekerSpawn : this.spawn;
    this.me.position.set(start.x + (myIndex - 3) * 40, start.y + (myIndex % 2) * 40);
    this.add(this.me, this.mapLayer);
    this.hostPositions[session.id] = { x: this.me.x, y: this.me.y };
    if (!session.isHost) session.send({ type: 'pos', x: this.me.x, y: this.me.y });

    for (const id of this.roster.order) {
      if (id === session.id) continue;
      this.spawnRemote(id);
    }

    this.camera = new Camera(this.mapLayer, W, H, { deadzoneWidth: 100, deadzoneHeight: 140 });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.me);

    this.buildHud();
    this.layoutUi(W, H);
    this.installDebug();

    session.onMessage((from, data) => this.onNet(from, data as Msg));
    session.onPlayerLeave((id) => {
      const r = this.remotes.get(id);
      if (r) {
        this.remove(r.entity);
        this.remotes.delete(id);
      }
      delete this.hostPositions[id];
    });
    if (session.isHost) {
      session.onPlayerJoin((p) => {
        session.sendTo(p.id, { type: 'inprogress' });
      });
    }
    session.onClose((reason) => {
      if (!this.live) return;
      this.roleHud.text = `disconnected: ${reason}`;
      const back = new Entity();
      back.addBehavior(
        new Timer(2.4, () => {
          window.history.replaceState(null, '', window.location.pathname);
          this.game.scenes.replace(new MenuScene());
        }),
      );
      this.add(back);
    });
  }

  protected override onExit(): void {
    delete window.__hushfall;
    setTerror(0);
  }

  // ------------------------------------------------------------- visuals

  private objectiveLayer!: Container;
  private lanternViews: { g: Graphics; ring: Graphics }[] = [];
  private gateView!: Graphics;

  private drawObjectives(): void {
    this.objectiveLayer = new Container();
    this.mapLayer.addChildAt(this.objectiveLayer, 1);
    this.lanternViews = this.lanternPts.map((p) => {
      const g = new Graphics();
      g.position.set(p.x, p.y);
      const ring = new Graphics();
      ring.position.set(p.x, p.y);
      this.objectiveLayer.addChild(ring, g);
      return { g, ring };
    });
    this.gateView = new Graphics();
    this.gateView.position.set(this.gatePt.x, this.gatePt.y);
    this.objectiveLayer.addChild(this.gateView);
    // Hiding spots: big wardrobes/curtained nooks you can duck inside.
    for (const p of this.hidePts) {
      const g = new Graphics();
      g.position.set(p.x, p.y);
      const w = 76;
      const h = 96;
      g.roundRect(-w / 2, -h / 2, w, h, 8).fill(0x2a2036);
      g.roundRect(-w / 2, -h / 2, w, h, 8).stroke({ color: NIGHT.violet, width: 3, alpha: 0.7 });
      // curtain folds
      for (let i = -1; i <= 1; i++) {
        g.roundRect(i * 20 - 8, -h / 2 + 6, 16, h - 12, 6).fill({ color: 0x3a2c4e, alpha: 0.9 });
      }
      g.circle(w / 2 - 14, 0, 4).fill(NIGHT.lantern); // little handle
      this.objectiveLayer.addChildAt(g, 0); // behind lanterns/gate
    }
    this.redrawObjectives();
  }

  private redrawObjectives(): void {
    this.lanternViews.forEach((lv, i) => {
      const p = this.snapLant[i] ?? 0;
      lv.g.clear();
      const lit = p >= 1;
      // post
      lv.g.roundRect(-6, -10, 12, 46, 4).fill(0x2a2740);
      // lamp
      lv.g.circle(0, -26, 18).fill(lit ? NIGHT.lanternLit : 0x4a4460);
      lv.g.circle(0, -26, 18).stroke({ color: lit ? NIGHT.lantern : NIGHT.inkSoft, width: 3 });
      // Lit lanterns blaze; unlit ones give a faint glimmer so they can still
      // be found in the dark.
      lv.g.circle(0, -26, lit ? 36 : 26).fill({ color: NIGHT.lantern, alpha: lit ? 0.2 : 0.07 });
      // progress ring
      lv.ring.clear();
      lv.ring.circle(0, -26, 30).stroke({ color: 0x000000, alpha: 0.4, width: 6 });
      if (p > 0 && !lit) {
        lv.ring
          .arc(0, -26, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p))
          .stroke({ color: NIGHT.lantern, width: 6 });
      }
    });
    this.gateView.clear();
    const open = this.snapGate;
    this.gateView.roundRect(-60, -18, 120, 36, 8).fill(open ? { color: NIGHT.gate, alpha: 0.28 } : { color: 0x14121e, alpha: 0.6 });
    for (let i = -1; i <= 1; i++) {
      this.gateView.roundRect(i * 40 - 6, -40, 12, 80, 4).fill(open ? NIGHT.gate : 0x3a3550);
    }
    if (open) this.gateView.circle(0, 0, GATE_RADIUS).stroke({ color: NIGHT.gate, alpha: 0.3, width: 3 });
  }

  private makeBlob(id: string, isMe: boolean): { entity: Entity; body: Container } {
    const cls = classById(this.roster.classes[id]);
    const isSeeker = this.roster.roles[id] === 'seeker';
    const e = new Entity();
    const char = blobCharacter({
      radius: isSeeker ? 40 : 30,
      color: cls.color,
      seed: 5 + this.roster.order.indexOf(id),
      strokeWidth: isMe ? 5 : 3,
    });
    char.body.addChild(cls.accessory(isSeeker ? 40 : 30));
    char.body.addChild(accessoryView(this.roster.accs?.[id], isSeeker ? 40 : 30));
    e.addChild(char.view);
    if (!isMe) e.addBehavior(new Wobble({ target: char.body, amount: 0.03, speed: 2.2 }));
    const label = makeText(this.roster.names[id] ?? '?', 17, {
      color: isSeeker ? NIGHT.blood : isMe ? NIGHT.gate : NIGHT.ink,
      weight: 'bold',
    });
    label.position.set(0, isSeeker ? 56 : 46);
    e.addChild(label);
    return { entity: e, body: char.body };
  }

  private spawnRemote(id: string): void {
    if (this.remotes.has(id) || id === this.session.id) return;
    const made = this.makeBlob(id, false);
    const isSeeker = this.roster.roles[id] === 'seeker';
    const base = isSeeker ? this.seekerSpawn : this.spawn;
    made.entity.position.set(base.x, base.y);
    const mark = new Graphics();
    made.entity.addChild(mark);
    this.add(made.entity, this.mapLayer);
    this.remotes.set(id, { entity: made.entity, body: made.body, targetX: base.x, targetY: base.y, mark });
    this.hostPositions[id] = { x: base.x, y: base.y };
  }

  // --------------------------------------------------------------- HUD

  private buildHud(): void {
    // Fog of war sits at the very bottom of the UI layer: it darkens the map
    // (and everything in it) beyond a lit disc around you, but never the HUD.
    const tex = getFogTexture();
    if (tex) {
      this.fog = new Sprite(tex);
      this.fog.anchor.set(0.5);
      this.fogBaseScale = FOG_SPRITE_R / 256;
      this.fog.scale.set(this.fogBaseScale);
      this.uiLayer.addChild(this.fog);
    }
    this.terrorVignette = new Graphics();
    this.uiLayer.addChild(this.terrorVignette);

    this.joystick = new VirtualJoystick({ radius: 96 });
    this.add(this.joystick, this.uiLayer);

    const myCls = classById(this.roster.classes[this.session.id]);
    this.abilityBtn = new UIButton(myCls.ability.emoji, {
      width: 140,
      height: 140,
      fontSize: 56,
      fill: this.amSeeker ? NIGHT.violet : NIGHT.ghost,
      textColor: 0x140f1e,
      onTap: () => this.tryAbility(),
    });
    this.add(this.abilityBtn, this.uiLayer);

    if (this.amSeeker) {
      this.attackBtn = new UIButton('🩸', {
        width: 120,
        height: 120,
        fontSize: 52,
        fill: NIGHT.blood,
        textColor: 0xffffff,
        onTap: () => this.tryAttack(),
      });
      this.add(this.attackBtn, this.uiLayer);
    }

    this.homeBtn = new UIButton('🏠', {
      width: 64,
      height: 64,
      fontSize: 28,
      fill: 0x1a1826,
      textColor: NIGHT.ink,
      onTap: () => this.goHome(),
    });
    this.add(this.homeBtn, this.uiLayer);

    this.codeHud = makeText(`${this.session.code}`, 24, { color: NIGHT.inkSoft, weight: 'bold' });
    this.uiLayer.addChild(this.codeHud);
    this.hud = makeText('', 24, { color: NIGHT.lantern, weight: '800' });
    this.hud.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.hud);
    this.roleHud = makeText(this.amSeeker ? '🩸 You are the SEEKER — hunt them down' : `${myCls.emoji} ${myCls.name} — light the lanterns`, 20, {
      color: this.amSeeker ? NIGHT.blood : NIGHT.gate,
      weight: '800',
    });
    this.roleHud.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.roleHud);

    this.myBar = new Graphics();
    this.myBar.position.set(0, 62);
    this.me.addChild(this.myBar);

    this.partyPanel = new Container();
    this.uiLayer.addChild(this.partyPanel);
    this.buildParty();
  }

  private partyRows = new Map<string, { dot: Graphics; label: Text }>();
  private buildParty(): void {
    for (const c of this.partyPanel.removeChildren()) c.destroy({ children: true });
    this.partyRows.clear();
    const hiders = this.roster.order.filter((id) => this.roster.roles[id] !== 'seeker');
    hiders.forEach((id, i) => {
      const row = new Container();
      row.position.set(0, i * 30);
      const dot = new Graphics();
      dot.position.set(8, 8);
      row.addChild(dot);
      const label = makeText(this.roster.names[id] ?? '?', 16, { color: NIGHT.ink, weight: 'bold' });
      label.anchor.set(0, 0.5);
      label.position.set(26, 8);
      row.addChild(label);
      this.partyPanel.addChild(row);
      this.partyRows.set(id, { dot, label });
    });
  }

  // --------------------------------------------------------------- net

  private onNet(from: string, msg: Msg): void {
    if (!msg) return;
    if (msg.type === 'hello' && this.session.isHost) {
      this.session.sendTo(from, { type: 'inprogress' });
      return;
    }
    if (msg.type === 'pos' && this.session.isHost) {
      this.hostPositions[from] = { x: msg.x, y: msg.y };
      return;
    }
    if (msg.type === 'attack' && this.session.isHost) {
      this.hostAttack(from);
      return;
    }
    if (msg.type === 'ability' && this.session.isHost) {
      this.hostAbility(from, msg.id, msg.x, msg.y);
      return;
    }
    if (msg.type === 'snap' && !this.session.isHost) {
      this.applySnap(msg);
      return;
    }
    if (msg.type === 'reveal') {
      this.playReveal(msg.points, msg.color, msg.secs);
      return;
    }
    if (msg.type === 'fx') {
      this.playFx(msg);
      return;
    }
    if (msg.type === 'end') {
      this.showEnd(msg.result);
      return;
    }
    if (msg.type === 'toLobby' && !this.session.isHost) {
      this.returnToLobby();
      return;
    }
  }

  private applySnap(s: Snap): void {
    for (const [id, p] of Object.entries(s.players)) {
      if (id === this.session.id) continue;
      const r = this.remotes.get(id);
      if (r) {
        r.targetX = p.x;
        r.targetY = p.y;
      }
    }
    this.snapLant = s.lant;
    this.snapGate = s.gate;
    this.snapDown = s.down;
    this.snapHidden = new Set(s.hidden);
    this.snapVanished = new Set(s.vanished);
    this.snapRooted = new Set(s.rooted);
    this.escaped = new Set(s.esc);
    this.out = new Set(s.out);
    this.phase = s.phase;
    this.syncDecoys(s.decoys);
    this.redrawObjectives();
    if (s.phase !== 'playing' && !this.endShown) this.showEnd(s.phase);
  }

  // ---------------------------------------------------------- host sim

  private hostAttack(seekerId: string): void {
    if (seekerId !== this.seekerId) return;
    const sp = this.hostPositions[seekerId];
    if (!sp) return;
    let target: string | null = null;
    let best = ATTACK_RANGE;
    for (const id of this.activeHiders()) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      const d = Math.hypot(p.x - sp.x, p.y - sp.y);
      // Vanished hiders can't be struck; hidden ones only once searched.
      if ((this.vanishUntil[id] ?? 0) > this.t) continue;
      if (this.isConcealed(id) && d > SEARCH_RADIUS) continue;
      if (d < best) {
        best = d;
        target = id;
      }
    }
    this.broadcastFx({ type: 'fx', kind: 'attack', x: sp.x, y: sp.y });
    if (target) {
      const p = this.hostPositions[target]!;
      this.down[target] = BLEED_SECONDS;
      this.reviveProg[target] = 0;
      this.broadcastFx({ type: 'fx', kind: 'down', x: p.x, y: p.y, id: target });
    }
  }

  private hostAbility(from: string, id: string, x: number, y: number): void {
    switch (id) {
      case 'screech': {
        if (from !== this.seekerId) return;
        const pts = this.visibleHiderPoints();
        this.reveal(pts, NIGHT.blood, 4);
        this.broadcastFx({ type: 'fx', kind: 'screech', x, y });
        break;
      }
      case 'ping': {
        const sp = this.hostPositions[this.seekerId];
        if (sp) this.reveal([{ x: sp.x, y: sp.y }], NIGHT.ghost, 4);
        break;
      }
      case 'sense': {
        const pts = this.lanternPts.filter((_, i) => (this.lant[i] ?? 0) < 1);
        const sp = this.hostPositions[this.seekerId];
        if (sp) pts.push({ x: sp.x, y: sp.y });
        this.reveal(pts, NIGHT.lantern, 6);
        break;
      }
      case 'snare':
        this.traps.push({ x, y });
        this.broadcastFx({ type: 'fx', kind: 'snare', x, y });
        break;
      case 'vanish':
        this.vanishUntil[from] = this.t + VANISH_SECONDS;
        this.broadcastFx({ type: 'fx', kind: 'poof', x, y, id: from });
        break;
      case 'decoy':
        this.decoys.push({ x, y, until: this.t + DECOY_SECONDS });
        this.broadcastFx({ type: 'fx', kind: 'decoy', x, y });
        break;
      case 'overcharge': {
        let li = -1;
        let bd = Infinity;
        this.lanternPts.forEach((p, i) => {
          if ((this.lant[i] ?? 1) >= 1) return;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) {
            bd = d;
            li = i;
          }
        });
        if (li >= 0) {
          this.lant[li] = Math.min(1, (this.lant[li] ?? 0) + 0.5);
          const p = this.lanternPts[li]!;
          this.broadcastFx({ type: 'fx', kind: 'lantern', x: p.x, y: p.y });
        }
        break;
      }
      case 'mend': {
        let tid: string | null = null;
        let bd = 200;
        for (const did of Object.keys(this.down)) {
          const p = this.hostPositions[did];
          if (!p) continue;
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd) {
            bd = d;
            tid = did;
          }
        }
        if (tid) {
          delete this.down[tid];
          this.reviveProg[tid] = 0;
          const p = this.hostPositions[tid]!;
          this.broadcastFx({ type: 'fx', kind: 'rescue', x: p.x, y: p.y, id: tid });
        }
        break;
      }
    }
  }

  private activeHiders(): string[] {
    return this.roster.order.filter(
      (id) => this.roster.roles[id] !== 'seeker' && !this.escaped.has(id) && !this.out.has(id),
    );
  }

  private visibleHiderPoints(): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    for (const id of this.activeHiders()) {
      if ((this.vanishUntil[id] ?? 0) > this.t) continue;
      if (this.isConcealed(id)) continue;
      const p = this.hostPositions[id];
      if (p) pts.push({ x: p.x, y: p.y });
    }
    return pts;
  }

  private isConcealed(id: string): boolean {
    const p = this.hostPositions[id];
    if (!p) return false;
    return this.hidePts.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < HIDE_RADIUS);
  }

  private hostSim(dt: number): void {
    const active = this.activeHiders();
    // Lanterns.
    for (const id of active) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      const cls = classById(this.roster.classes[id]);
      const rate = (cls.id === 'engineer' ? 2 : 1) / LANTERN_SECONDS;
      this.lanternPts.forEach((lp, i) => {
        if ((this.lant[i] ?? 1) >= 1) return;
        if (Math.hypot(lp.x - p.x, lp.y - p.y) < LANTERN_RADIUS) {
          const before = this.lant[i] ?? 0;
          this.lant[i] = Math.min(1, before + rate * dt);
          if (before < 1 && this.lant[i]! >= 1) {
            const q = this.lanternPts[i]!;
            this.broadcastFx({ type: 'fx', kind: 'lantern', x: q.x, y: q.y });
          }
        }
      });
    }
    const litAll = this.lant.every((v) => v >= 1);
    if (litAll && !this.gateOpen) {
      this.gateOpen = true;
      this.broadcastFx({ type: 'fx', kind: 'gate', x: this.gatePt.x, y: this.gatePt.y });
    }
    // Snares.
    for (const id of active) {
      if (this.down[id] !== undefined) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      for (let i = this.traps.length - 1; i >= 0; i--) {
        const tr = this.traps[i]!;
        if (Math.hypot(tr.x - p.x, tr.y - p.y) < SNARE_RADIUS) {
          this.rootUntil[id] = this.t + SNARE_SECONDS;
          this.traps.splice(i, 1);
          this.broadcastFx({ type: 'fx', kind: 'snare', x: p.x, y: p.y, id });
        }
      }
    }
    // Revives + bleed.
    for (const did of Object.keys(this.down)) {
      const dp = this.hostPositions[did];
      if (!dp) continue;
      let helper = false;
      for (const hid of active) {
        if (hid === did || this.down[hid] !== undefined) continue;
        const hp = this.hostPositions[hid];
        if (!hp) continue;
        if (Math.hypot(hp.x - dp.x, hp.y - dp.y) < REVIVE_RADIUS) {
          const cls = classById(this.roster.classes[hid]);
          this.reviveProg[did] = (this.reviveProg[did] ?? 0) + (dt * (cls.id === 'medic' ? 2 : 1)) / REVIVE_SECONDS;
          helper = true;
        }
      }
      if (helper && (this.reviveProg[did] ?? 0) >= 1) {
        delete this.down[did];
        this.reviveProg[did] = 0;
        this.broadcastFx({ type: 'fx', kind: 'rescue', x: dp.x, y: dp.y, id: did });
      } else {
        this.down[did] = Math.max(0, (this.down[did] ?? 0) - dt);
        if (this.down[did]! <= 0) {
          delete this.down[did];
          this.out.add(did);
        }
      }
    }
    // Escape.
    if (this.gateOpen) {
      for (const id of active) {
        if (this.down[id] !== undefined) continue;
        const p = this.hostPositions[id];
        if (p && Math.hypot(p.x - this.gatePt.x, p.y - this.gatePt.y) < GATE_RADIUS) {
          this.escaped.add(id);
          this.broadcastFx({ type: 'fx', kind: 'escape', x: p.x, y: p.y, id });
        }
      }
    }
    // Expire decoys.
    this.decoys = this.decoys.filter((d) => d.until > this.t);
    // End check.
    if (this.phase === 'playing') {
      const stillIn = this.activeHiders().length;
      if (stillIn === 0) {
        this.phase = this.escaped.size > 0 ? 'hiders-win' : 'seeker-wins';
        this.session.broadcast({ type: 'end', result: this.phase });
        this.showEnd(this.phase);
      }
    }
  }

  /** Host: drive the AI bots (fill-in players). Everything else — lantern
   *  progress, revives, escapes, bleed — already resolves by position, so a
   *  bot only needs to steer; standing on a lantern lights it like anyone. */
  private hostSimBots(dt: number): void {
    this.botAtkCd = Math.max(0, this.botAtkCd - dt);
    const seekerPos = this.hostPositions[this.seekerId];
    for (const id of this.roster.order) {
      if (!id.startsWith('bot')) continue;
      if (this.escaped.has(id) || this.out.has(id)) continue;
      const p = this.hostPositions[id];
      if (!p) continue;
      if ((this.rootUntil[id] ?? 0) > this.t) continue; // snared
      const cls = classById(this.roster.classes[id]);
      const isSeeker = this.roster.roles[id] === 'seeker';
      let gx = p.x;
      let gy = p.y;
      let speed = cls.speed * 0.9;
      let stop = 40;

      if (isSeeker) {
        speed = cls.speed * 0.82; // a touch slower so humans can juke
        stop = ATTACK_RANGE * 0.55;
        let tgt: { x: number; y: number } | null = null;
        let best = 1e9;
        for (const hid of this.activeHiders()) {
          if ((this.vanishUntil[hid] ?? 0) > this.t) continue;
          const hp = this.hostPositions[hid];
          if (!hp) continue;
          const d = Math.hypot(hp.x - p.x, hp.y - p.y);
          if (d < best) {
            best = d;
            tgt = hp;
          }
        }
        if (tgt) {
          gx = tgt.x;
          gy = tgt.y;
          if (best < ATTACK_RANGE * 0.9 && this.botAtkCd <= 0) {
            this.botAtkCd = BOT_ATTACK_EVERY;
            this.hostAttack(id);
          }
        } else {
          const lp = this.lanternPts[0];
          if (lp) {
            gx = lp.x;
            gy = lp.y;
          }
        }
      } else {
        if (this.down[id] !== undefined) continue; // downed — wait for a rescue
        // A stable per-bot index so each bot prefers different spots and they
        // fan out instead of all chasing the single nearest objective.
        const bi = parseInt(id.slice(3), 10) || 0;
        const fleeing = !!seekerPos && Math.hypot(seekerPos.x - p.x, seekerPos.y - p.y) < BOT_FLEE_DIST;
        if (fleeing && seekerPos) {
          // Scatter: each bot bolts for a *different* nearby hiding spot rather
          // than every bot piling onto the single closest one.
          const cand = this.hidePts
            .map((q) => ({ q, d: Math.hypot(q.x - p.x, q.y - p.y) }))
            .filter((o) => o.d < 440)
            .sort((a, b) => a.d - b.d);
          if (cand.length) {
            const hs = cand[bi % Math.min(cand.length, 3)]!.q;
            gx = hs.x;
            gy = hs.y;
            stop = 16;
          } else {
            // No cover — flee at a bot-specific angle away from the Seeker so
            // they don't all run the same line.
            const ax = p.x - seekerPos.x;
            const ay = p.y - seekerPos.y;
            const a0 = Math.atan2(ay, ax) + (((bi % 3) - 1) * Math.PI) / 5;
            gx = p.x + Math.cos(a0) * 220;
            gy = p.y + Math.sin(a0) * 220;
          }
          speed = cls.speed;
        } else if (this.gateOpen) {
          gx = this.gatePt.x;
          gy = this.gatePt.y;
        } else {
          // Divide up the objectives: each bot walks its *own* rotation of the
          // lantern list (starting at its index), taking the first still-unlit
          // one. So bot0 favours lantern0, bot1 lantern1, … and they spread
          // across the manor instead of swarming the nearest lantern together.
          const n = this.lanternPts.length;
          const unlit: number[] = [];
          for (let i = 0; i < n; i++) if ((this.lant[i] ?? 1) < 1) unlit.push(i);
          if (unlit.length) {
            const rank = (i: number): number => (i - bi + n) % n;
            const li = unlit.slice().sort((a, b) => rank(a) - rank(b))[0]!;
            gx = this.lanternPts[li]!.x;
            gy = this.lanternPts[li]!.y;
          } else {
            gx = this.gatePt.x;
            gy = this.gatePt.y;
          }
          // Help up a nearby downed ally if the coast is reasonably clear.
          for (const did of Object.keys(this.down)) {
            const dp = this.hostPositions[did];
            if (dp && Math.hypot(dp.x - p.x, dp.y - p.y) < 260) {
              gx = dp.x;
              gy = dp.y;
            }
          }
        }
      }

      // Steer along a BFS path so bots route through doorways instead of
      // pressing into walls. Fall back to a straight line if no path exists.
      let wx = gx;
      let wy = gy;
      let wstop = stop;
      const gc = Math.floor(gx / TILE_SIZE);
      const gr = Math.floor(gy / TILE_SIZE);
      const gk = `${gc},${gr}`;
      let info = this.botPaths.get(id);
      if (!info || info.goal !== gk) {
        info = { goal: gk, path: this.bfsPath(p.x, p.y, gx, gy), idx: 1 };
        this.botPaths.set(id, info);
      }
      if (info.path.length > info.idx) {
        const [c, r] = info.path[info.idx]!;
        wx = c * TILE_SIZE + TILE_SIZE / 2;
        wy = r * TILE_SIZE + TILE_SIZE / 2;
        if (Math.hypot(wx - p.x, wy - p.y) < TILE_SIZE * 0.6) info.idx++;
        if (info.idx < info.path.length - 1) wstop = 6; // keep moving between nodes
      }
      const d = Math.hypot(wx - p.x, wy - p.y) || 1;
      if (d > wstop) {
        const moved = moveWithCollision(
          this.map,
          p.x,
          p.y,
          16,
          14,
          ((wx - p.x) / d) * speed * dt,
          ((wy - p.y) / d) * speed * dt,
        );
        p.x = moved.x;
        p.y = moved.y;
      }
    }
  }

  /** BFS over walkable tiles → a tile path from (fx,fy) to (tx,ty). Returns
   *  just the start tile if the target is unreachable/solid. */
  private bfsPath(fx: number, fy: number, tx: number, ty: number): [number, number][] {
    const tw = this.map.width;
    const th = this.map.height;
    const fc = Math.max(0, Math.min(tw - 1, Math.floor(fx / TILE_SIZE)));
    const fr = Math.max(0, Math.min(th - 1, Math.floor(fy / TILE_SIZE)));
    const tc = Math.max(0, Math.min(tw - 1, Math.floor(tx / TILE_SIZE)));
    const tr = Math.max(0, Math.min(th - 1, Math.floor(ty / TILE_SIZE)));
    const start: [number, number] = [fc, fr];
    if ((fc === tc && fr === tr) || solidAt(this.map, tc, tr)) return [start];
    const prev = new Map<number, number>();
    const seen = new Set<number>([fr * tw + fc]);
    const queue: [number, number][] = [start];
    let head = 0;
    let found = false;
    while (head < queue.length) {
      const [c, r] = queue[head++]!;
      if (c === tc && r === tr) {
        found = true;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
        if (solidAt(this.map, nc, nr)) continue;
        const k = nr * tw + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        prev.set(k, r * tw + c);
        queue.push([nc, nr]);
      }
    }
    if (!found) return [start];
    const path: [number, number][] = [];
    let cur: number | undefined = tr * tw + tc;
    while (cur !== undefined) {
      path.push([cur % tw, Math.floor(cur / tw)]);
      cur = prev.get(cur);
    }
    path.reverse();
    return path;
  }

  private reveal(points: { x: number; y: number }[], color: number, secs: number): void {
    this.session.broadcast({ type: 'reveal', points, color, secs });
    this.playReveal(points, color, secs);
  }

  private broadcastFx(fx: Fx): void {
    this.session.broadcast(fx);
    this.playFx(fx);
  }

  // -------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    const myCls = classById(this.roster.classes[this.session.id]);

    if (this.session.isHost) {
      this.hostSim(dt);
      this.hostSimBots(dt);
    }

    const iAmDown = this.snapDown[this.session.id] !== undefined || this.down[this.session.id] !== undefined;
    const iAmRooted = this.snapRooted.has(this.session.id) || (this.rootUntil[this.session.id] ?? 0) > this.t;
    const iAmOut = this.out.has(this.session.id);
    const iAmEscaped = this.escaped.has(this.session.id);
    const frozen = iAmDown || iAmRooted || iAmOut || iAmEscaped || this.phase !== 'playing';

    // Movement.
    if (this.t < this.boostUntil) {
      /* boost active */
    } else this.boostFactor = 1;
    const jx = frozen ? 0 : this.joystick.value.x;
    const jy = frozen ? 0 : this.joystick.value.y;
    if (Math.hypot(jx, jy) > 0.12) {
      const speed = myCls.speed * this.boostFactor;
      const moved = moveWithCollision(this.map, this.me.x, this.me.y, 18, 14, jx * speed * dt, jy * speed * dt);
      this.me.position.set(moved.x, moved.y);
      this.walk += dt * 11;
      const s = Math.sin(this.walk) * 0.07;
      this.meBody.scale.set(1 + s, 1 - s);
    } else this.meBody.scale.set(1, 1);

    // Ship position every tick (not just on movement): stationary hiders must
    // still be visible to the host for hiding, rescue, escape and attacks.
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      this.sendIn = SEND;
      if (this.session.isHost) {
        this.hostPositions[this.session.id] = { x: this.me.x, y: this.me.y };
        this.broadcastSnap();
      } else {
        this.session.send({ type: 'pos', x: this.me.x, y: this.me.y });
      }
    }

    // Remote smoothing + seeker fog.
    for (const [id, r] of this.remotes) {
      if (this.session.isHost) {
        const p = this.hostPositions[id];
        if (p) {
          r.targetX = p.x;
          r.targetY = p.y;
        }
      }
      const k = Math.min(1, dt * 12);
      r.entity.x += (r.targetX - r.entity.x) * k;
      r.entity.y += (r.targetY - r.entity.y) * k;
      this.styleRemote(id, r);
    }

    this.updateHud();
    this.updateTerror(dt);
    this.camera.update(dt);
    // Keep the lit disc centred on me and grow it while a vision ability runs.
    if (this.fog) {
      this.fog.position.set(this.me.x + this.mapLayer.x, this.me.y + this.mapLayer.y);
      const target = this.t < this.visionBoostUntil ? VISION_BOOST : 1;
      const cur = this.fog.scale.x / this.fogBaseScale;
      const next = cur + (target - cur) * Math.min(1, dt * 6);
      this.fog.scale.set(this.fogBaseScale * next);
    }
  }

  private styleRemote(id: string, r: Remote): void {
    const isSeeker = this.roster.roles[id] === 'seeker';
    const downed = this.snapDown[id] !== undefined || this.down[id] !== undefined;
    const gone = this.escaped.has(id) || this.out.has(id);
    r.entity.visible = !gone;
    // Fog of war: anyone beyond your sight radius is hidden; they fade in as
    // they cross into view. Sight widens while your vision ability is active.
    const boost = this.t < this.visionBoostUntil ? VISION_BOOST : 1;
    const full = (this.amSeeker ? SEEKER_SIGHT_FULL : HIDER_SIGHT_FULL) * boost;
    const fade = (this.amSeeker ? SEEKER_SIGHT_FADE : HIDER_SIGHT_FADE) * boost;
    const dist = Math.hypot(r.entity.x - this.me.x, r.entity.y - this.me.y);
    let distAlpha = sightAlpha(dist, full, fade);
    // A hider in a hiding spot is invisible to the Seeker until searched — the
    // Seeker must step within SEARCH_RADIUS of them to reveal them.
    if (this.amSeeker && !isSeeker && this.snapHidden.has(id) && dist > SEARCH_RADIUS) distAlpha = 0;
    r.entity.alpha = distAlpha;
    // Vanish (Ghost) hides fully from the Seeker.
    let alpha = 1;
    if (this.amSeeker && !isSeeker && this.snapVanished.has(id)) alpha = 0;
    r.body.alpha = downed ? 0.4 : alpha;
    r.mark.clear();
    if (downed) {
      // downed marker + revive ring so allies can find them
      r.mark.circle(0, 0, 26).stroke({ color: NIGHT.blood, width: 4, alpha: 0.9 });
      r.mark.moveTo(-10, -10).lineTo(10, 10).moveTo(10, -10).lineTo(-10, 10).stroke({ color: NIGHT.blood, width: 4 });
    }
  }

  private broadcastSnap(): void {
    const players: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(this.hostPositions)) players[id] = { x: p.x, y: p.y };
    const hidden = this.activeHiders().filter((id) => this.isConcealed(id));
    const vanished = Object.keys(this.vanishUntil).filter((id) => (this.vanishUntil[id] ?? 0) > this.t);
    const rooted = Object.keys(this.rootUntil).filter((id) => (this.rootUntil[id] ?? 0) > this.t);
    const snap: Snap = {
      type: 'snap',
      players,
      lant: this.lant,
      gate: this.gateOpen,
      down: this.down,
      esc: [...this.escaped],
      out: [...this.out],
      hidden,
      vanished,
      rooted,
      decoys: this.decoys.map((d) => ({ x: d.x, y: d.y })),
      phase: this.phase,
    };
    this.session.broadcast(snap);
    // Host mirrors its own snap-derived view.
    this.snapLant = this.lant;
    this.snapGate = this.gateOpen;
    this.snapDown = this.down;
    this.snapHidden = new Set(hidden);
    this.snapVanished = new Set(vanished);
    this.snapRooted = new Set(rooted);
    this.syncDecoys(snap.decoys);
    this.redrawObjectives();
  }

  private updateHud(): void {
    const lit = this.snapLant.filter((v) => v >= 1).length;
    const total = this.snapLant.length;
    this.hud.text = this.snapGate ? '🚪 GATE OPEN — escape!' : `🕯️ Lanterns ${lit}/${total}`;
    const iAmDown = this.snapDown[this.session.id] !== undefined;
    if (iAmDown) {
      this.roleHud.text = '💀 DOWNED — hold on, someone can save you';
      this.roleHud.style.fill = NIGHT.blood;
    }
    this.myBar.clear();
    if (iAmDown) {
      const bleed = this.snapDown[this.session.id] ?? 0;
      this.myBar.rect(-26, 0, 52, 6).fill({ color: 0x000000, alpha: 0.4 });
      this.myBar.rect(-26, 0, 52 * Math.max(0, bleed / BLEED_SECONDS), 6).fill(NIGHT.blood);
    }
    this.abilityBtn.alpha = this.cooldownLeft > 0 ? 0.4 : 1;
    if (this.attackBtn) this.attackBtn.alpha = this.attackCd > 0 ? 0.4 : 1;
    // Party statuses.
    for (const [id, row] of this.partyRows) {
      const downed = this.snapDown[id] !== undefined;
      const esc = this.escaped.has(id);
      const gone = this.out.has(id);
      const color = esc ? NIGHT.gate : gone ? 0x556070 : downed ? NIGHT.blood : NIGHT.ghost;
      row.dot.clear();
      row.dot.circle(0, 0, 8).fill(color);
      const suffix = esc ? ' ✓escaped' : gone ? ' ✗out' : downed ? ' 💀' : '';
      const base = this.roster.names[id] ?? '?';
      if (row.label.text !== base + suffix) row.label.text = base + suffix;
    }
  }

  private updateTerror(dt: number): void {
    if (this.amSeeker || this.phase !== 'playing') {
      setTerror(0);
      this.terrorVignette.alpha = 0;
      updateHeartbeat(dt);
      return;
    }
    const sp = this.hostPositions[this.seekerId] ?? this.remotes.get(this.seekerId)?.entity;
    let level = 0;
    if (sp) {
      const d = Math.hypot((sp.x ?? 0) - this.me.x, (sp.y ?? 0) - this.me.y);
      level = Math.max(0, Math.min(1, (620 - d) / 500));
    }
    setTerror(level);
    this.terrorVignette.alpha = level * 0.5;
    updateHeartbeat(dt);
  }

  // ------------------------------------------------------------ decoys/fx

  private syncDecoys(list: { x: number; y: number }[]): void {
    while (this.decoyViews.length > list.length) {
      const v = this.decoyViews.pop();
      if (v) this.remove(v);
    }
    while (this.decoyViews.length < list.length) {
      const e = new Entity();
      const ch = blobCharacter({ radius: 28, color: NIGHT.violet, seed: 99, shadow: false });
      e.addChild(ch.view);
      e.alpha = 0.7;
      this.add(e, this.mapLayer);
      this.decoyViews.push(e);
    }
    list.forEach((d, i) => this.decoyViews[i]?.position.set(d.x, d.y));
  }

  private playReveal(points: { x: number; y: number }[], color: number, secs: number): void {
    this.revealSeen += 1;
    for (const p of points) {
      const e = new Entity();
      e.position.set(p.x, p.y);
      const g = new Graphics().circle(0, 0, 40).stroke({ color, width: 6, alpha: 0.9 }).circle(0, 0, 8).fill(color);
      e.addChild(g);
      e.addBehavior(new Wobble({ target: e, amount: 0.14, speed: 4 }));
      e.addBehavior(new Timer(secs, () => this.remove(e)));
      this.add(e, this.mapLayer);
    }
  }

  private playFx(fx: Fx): void {
    const e = new Entity();
    e.position.set(fx.x, fx.y);
    const g = new Graphics();
    e.addChild(g);
    let life = 0.5;
    switch (fx.kind) {
      case 'attack':
        g.arc(0, 0, ATTACK_RANGE * 0.8, -0.9, 1.5).stroke({ color: NIGHT.blood, width: 14, alpha: 0.85 });
        g.arc(0, 0, ATTACK_RANGE * 0.55, -0.7, 1.3).stroke({ color: 0xff8fa8, width: 8, alpha: 0.7 });
        sting('blip');
        life = 0.24;
        break;
      case 'down':
        g.circle(0, 0, 40).fill({ color: NIGHT.blood, alpha: 0.4 });
        sting('down');
        this.camera?.shake(12, 0.3);
        life = 0.5;
        break;
      case 'rescue':
        g.circle(0, 0, 44).stroke({ color: NIGHT.gate, width: 8, alpha: 0.9 });
        sting('rescue');
        life = 0.5;
        break;
      case 'lantern':
        g.circle(0, -26, 46).fill({ color: NIGHT.lantern, alpha: 0.35 });
        sting('lantern');
        life = 0.4;
        break;
      case 'gate':
        g.circle(0, 0, 80).stroke({ color: NIGHT.gate, width: 10, alpha: 0.9 });
        sting('gate');
        this.camera?.shake(10, 0.4);
        life = 0.6;
        break;
      case 'escape':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 30, Math.sin(a) * 30, 6).fill(NIGHT.gate);
        }
        sting('escape');
        life = 0.5;
        break;
      case 'snare':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.moveTo(0, 0).lineTo(Math.cos(a) * SNARE_RADIUS, Math.sin(a) * SNARE_RADIUS).stroke({ color: NIGHT.violet, width: 3, alpha: 0.7 });
        }
        life = fx.id ? 0.4 : DECOY_SECONDS; // a laid trap lingers faintly
        break;
      case 'decoy':
        g.circle(0, 0, 30).fill({ color: NIGHT.violet, alpha: 0.3 });
        sting('blip');
        life = 0.4;
        break;
      case 'screech':
        g.circle(0, 0, 60).stroke({ color: NIGHT.blood, width: 8, alpha: 0.8 });
        sting('screech');
        this.camera?.shake(8, 0.3);
        life = 0.5;
        break;
      case 'poof':
        g.circle(0, 0, 30).fill({ color: NIGHT.ghost, alpha: 0.4 });
        life = 0.4;
        break;
    }
    e.addBehavior(new Tween(e, { alpha: 0 }, life, { ease: easings.outQuad }));
    e.addBehavior(new Timer(life, () => this.remove(e)));
    this.add(e, this.mapLayer);
  }

  // ---------------------------------------------------------- abilities

  private tryAttack(): void {
    if (!this.amSeeker || this.attackCd > 0 || this.phase !== 'playing') return;
    this.attackCd = 0.9;
    sting('blip');
    if (this.session.isHost) this.hostAttack(this.session.id);
    else this.session.send({ type: 'attack' });
  }

  private tryAbility(): void {
    if (this.cooldownLeft > 0 || this.phase !== 'playing') return;
    const cls = classById(this.roster.classes[this.session.id]);
    const iAmDown = this.snapDown[this.session.id] !== undefined;
    if (iAmDown) return;
    this.cooldownLeft = cls.ability.cooldown;
    this.abilityUses += 1;
    sting('blip');
    const id = cls.ability.id;
    if (id === 'dash' || id === 'lunge') {
      this.boostUntil = this.t + (id === 'lunge' ? 0.5 : 1.1);
      this.boostFactor = id === 'lunge' ? 2.6 : 1.8;
      return;
    }
    if (id === 'flashlight' || id === 'thirdeye') {
      // Client-local: widen your own vision for a while.
      this.visionBoostUntil = this.t + VISION_BOOST_SECS;
      sting('lantern');
      return;
    }
    if (this.session.isHost) this.hostAbility(this.session.id, id, this.me.x, this.me.y);
    else this.session.send({ type: 'ability', id, x: this.me.x, y: this.me.y });
  }

  // ---------------------------------------------------------------- end

  private endRoot: Container | null = null;
  private showEnd(result: string): void {
    if (this.endShown) return;
    this.endShown = true;
    this.phase = result;
    clearLastRoom();
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const hidersWin = result === 'hiders-win';
    const iWon = this.amSeeker ? !hidersWin : hidersWin && this.escaped.has(this.session.id);
    // Verium payout.
    let reward = 0;
    if (this.amSeeker) reward = hidersWin ? 30 : 80;
    else reward = this.escaped.has(this.session.id) ? 60 : 12;
    verium.add(reward);
    sting(iWon ? 'escape' : 'lose');

    this.endRoot = new Container();
    const bg = new Graphics().rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.9 });
    bg.eventMode = 'static';
    this.endRoot.addChild(bg);
    const title = makeText(
      this.amSeeker ? (hidersWin ? 'THEY ESCAPED' : 'HUNT SUCCESSFUL') : hidersWin ? 'YOU SURVIVED' : 'THE DARK WINS',
      64,
      { color: iWon ? NIGHT.gate : NIGHT.blood },
    );
    title.position.set(W / 2, H * 0.32);
    this.endRoot.addChild(title);
    const sub = makeText(
      `${this.escaped.size} escaped · ${this.out.size} lost\n+${reward} ⬡ Verium`,
      30,
      { color: NIGHT.ink, weight: 'bold', wrapWidth: 640 },
    );
    sub.position.set(W / 2, H * 0.46);
    this.endRoot.addChild(sub);

    if (this.session.isHost) {
      const btn = new UIButton('BACK TO LOBBY', {
        width: 460,
        height: 96,
        fontSize: 34,
        fill: NIGHT.gate,
        textColor: 0x0c1a12,
        onTap: () => {
          this.session.broadcast({ type: 'toLobby' });
          this.returnToLobby();
        },
      });
      btn.position.set(W / 2, H * 0.66);
      this.add(btn, this.uiLayer);
      this.endRoot.addChild(btn);
    } else {
      const wait = makeText('waiting for the host…', 26, { color: NIGHT.inkSoft, weight: 'bold' });
      wait.position.set(W / 2, H * 0.66);
      this.endRoot.addChild(wait);
    }
    this.uiLayer.addChild(this.endRoot);
  }

  private returnToLobby(): void {
    if (!this.live) return;
    this.live = false;
    // A fresh lobby on the same session — roles/ready reset, cosmetics kept.
    void import('./LobbyScene.js').then(({ LobbyScene }) => {
      this.game.scenes.replace(new LobbyScene(this.session));
    });
  }

  private goHome(): void {
    if (this.game.scenes.isTransitioning) return;
    this.live = false;
    clearLastRoom();
    sting('blip');
    this.session.leave();
    window.history.replaceState(null, '', window.location.pathname);
    this.game.scenes.replace(new MenuScene());
  }

  /** Flood-fill from the hider spawn: are the gate, Seeker spawn and every
   *  lantern actually reachable? Guards against a bad building generation. */
  private reachabilityOk(): boolean {
    const tw = this.map.width;
    const th = this.map.height;
    const tile = (x: number, y: number): [number, number] => [
      Math.floor(x / TILE_SIZE),
      Math.floor(y / TILE_SIZE),
    ];
    const [sc, sr] = tile(this.spawn.x, this.spawn.y);
    const seen = new Set<number>([sr * tw + sc]);
    const stack: [number, number][] = [[sc, sr]];
    while (stack.length) {
      const [c, r] = stack.pop()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
        if (solidAt(this.map, nc, nr)) continue;
        const k = nr * tw + nc;
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nc, nr]);
      }
    }
    const reach = (x: number, y: number): boolean => {
      const [c, r] = tile(x, y);
      return seen.has(r * tw + c);
    };
    return (
      reach(this.gatePt.x, this.gatePt.y) &&
      reach(this.seekerSpawn.x, this.seekerSpawn.y) &&
      this.lanternPts.every((p) => reach(p.x, p.y))
    );
  }

  // --------------------------------------------------------------- debug

  private installDebug(): void {
    window.__hushfall = {
      scene: () => 'match',
      code: () => this.session.code,
      playerCount: () => this.roster.order.length,
      phase: () => this.phase,
      myRole: () => (this.amSeeker ? 'seeker' : 'hider'),
      seekerId: () => this.seekerId,
      myPos: () => ({ x: this.me.x, y: this.me.y }),
      warp: (x: number, y: number) => {
        this.me.position.set(x, y);
      },
      litCount: () => this.snapLant.filter((v) => v >= 1).length,
      lanternCount: () => this.snapLant.length,
      gateOpen: () => this.snapGate,
      attack: () => this.tryAttack(),
      ability: () => this.tryAbility(),
      downedCount: () => Object.keys(this.snapDown).length,
      escapedCount: () => this.escaped.size,
      aliveCount: () => this.activeHiders().length,
      amDowned: () => this.snapDown[this.session.id] !== undefined,
      seekerPos: () => {
        const p = this.hostPositions[this.seekerId] ?? this.remotes.get(this.seekerId)?.entity;
        return p ? { x: p.x, y: p.y } : null;
      },
      lanternPos: (i: number) => this.lanternPts[i] ?? null,
      gatePos: () => ({ ...this.gatePt }),
      spawnPos: () => (this.amSeeker ? { ...this.seekerSpawn } : { ...this.spawn }),
      forceLightAll: () => {
        if (!this.session.isHost) return;
        this.lant = this.lanternPts.map(() => 1);
        this.gateOpen = true;
      },
      revealSeen: () => this.revealSeen,
      abilityUses: () => this.abilityUses,
      botCount: () => this.roster.order.filter((id) => id.startsWith('bot')).length,
      botPos: () => {
        const id = this.roster.order.find((x) => x.startsWith('bot'));
        const p = id ? this.hostPositions[id] : null;
        return p ? { x: p.x, y: p.y } : null;
      },
      botPositions: () =>
        this.roster.order
          .filter((x) => x.startsWith('bot'))
          .map((id) => {
            const p = this.hostPositions[id];
            return p ? { x: p.x, y: p.y } : null;
          })
          .filter((p): p is { x: number; y: number } => !!p),
      botGoals: () =>
        this.roster.order
          .filter((x) => x.startsWith('bot'))
          .map((id) => this.botPaths.get(id)?.goal ?? ''),
      hidePos: (i: number) => this.hidePts[i] ?? null,
      hideCount: () => this.hidePts.length,
      hiddenIds: () => this.activeHiders().filter((id) => this.isConcealed(id)),
      visionActive: () => this.t < this.visionBoostUntil,
      reachOk: () => this.reachabilityOk(),
    };
  }
}
