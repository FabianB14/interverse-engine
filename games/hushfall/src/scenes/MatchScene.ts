import { Container, Graphics } from 'pixi.js';
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
const ATTACK_RANGE = 96;
const REVIVE_RADIUS = 86;
const REVIVE_SECONDS = 4;
const BLEED_SECONDS = 30;
const GATE_RADIUS = 90;
const SNARE_RADIUS = 60;
const SNARE_SECONDS = 2.6;
const VANISH_SECONDS = 4.5;
const DECOY_SECONDS = 8;
const BUSH_RADIUS = 46;

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
  private bushPts: { x: number; y: number }[] = [];
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

  // local ability
  private cooldownLeft = 0;
  private boostUntil = 0;
  private boostFactor = 1;
  private abilityUses = 0;
  private revealSeen = 0;
  private attackCd = 0;

  // HUD
  private hud!: Text;
  private roleHud!: Text;
  private terrorVignette!: Graphics;
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
    this.bushPts = this.map.objects.filter((o) => o.name === 'bush').map((o) => ({ x: o.x, y: o.y }));
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
      lv.g.circle(0, -26, 18).fill(lit ? NIGHT.lanternLit : 0x3a3550);
      lv.g.circle(0, -26, 18).stroke({ color: lit ? NIGHT.lantern : NIGHT.inkSoft, width: 3 });
      if (lit) lv.g.circle(0, -26, 34).fill({ color: NIGHT.lantern, alpha: 0.18 });
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
    return this.bushPts.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < BUSH_RADIUS);
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

    if (this.session.isHost) this.hostSim(dt);

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
  }

  private styleRemote(id: string, r: Remote): void {
    const isSeeker = this.roster.roles[id] === 'seeker';
    const downed = this.snapDown[id] !== undefined || this.down[id] !== undefined;
    const gone = this.escaped.has(id) || this.out.has(id);
    r.entity.visible = !gone;
    // Seeker's view: concealed/vanished hiders fade out.
    let alpha = 1;
    if (this.amSeeker && !isSeeker) {
      if (this.snapVanished.has(id)) alpha = 0;
      else if (this.snapHidden.has(id)) alpha = 0.18;
    }
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
        g.arc(0, 0, 70, -0.9, 1.5).stroke({ color: NIGHT.blood, width: 12, alpha: 0.9 });
        sting('blip');
        life = 0.22;
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
    };
  }
}
