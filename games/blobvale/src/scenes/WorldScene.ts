import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  Entity,
  Scene,
  Timer,
  Tween,
  easings,
  VirtualJoystick,
  Wobble,
  audio,
  blobCharacter,
  buildTileMapView,
  forestDeep,
  moveWithCollision,
  tileMapFromRows,
} from '@interverse/engine';
import type { TileMapData } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { drawPanel } from '@interverse/ui';
import { classById, shadeFor } from '../classes.js';
import { verium } from '@interverse/engine';
import { accessoryView } from '../accessories.js';
import { playVoice } from '../voice.js';
import {
  ABILITIES,
  BOSS,
  BOSSES,
  CLASS_MODS,
  CLERIC_HEAL,
  CAMP_VARIANTS,
  MOB,
  MOB_VARIANTS,
  MODS,
  RESPAWN_SECONDS,
  STAT_CARDS,
  STATUS,
  STATUS_KINDS,
  VERIUM_PER_BOSS,
  VERIUM_PER_MOB,
  bossHpFor,
  cardLabel,
  damageAtLevel,
  maxHpAtLevel,
  xpForLevel,
} from '../combat.js';
import type { MobState, MobVariant, MobVariantDef, StatusKind } from '../combat.js';
import { TILE_SIZE, ZONES, valeLegend, valeRows } from '../map.js';
import { makeText } from '../text.js';
import { MenuScene } from './MenuScene.js';
import type { RosterState } from './LobbyScene.js';

const SEND_INTERVAL = 0.1; // 10Hz position updates
const QUICK_CHAT = ['Help!', 'Follow me!', 'Over here!', 'Nice!', 'Wait!', '❤️', '😂', '⚔️'];

interface PosMessage {
  type: 'pos';
  x: number;
  y: number;
}

/** Mob wire state: k = boss kind, vr = variant, f/p/b/sh = status flags. */
interface MobSnap {
  x: number;
  y: number;
  hp: number;
  max: number;
  k?: number;
  vr?: MobVariant;
  f?: number;
  p?: number;
  b?: number;
  sh?: number;
}

interface SnapMessage {
  type: 'snap';
  players: Record<string, { x: number; y: number }>;
  mobs?: Record<string, MobSnap>;
  stats?: Record<string, PlayerStats>;
  /** Current zone index, so late joiners repaint to match. */
  zone?: number;
  /** Portal to the next level (appears once the zone boss falls). */
  portal?: { x: number; y: number } | null;
}

interface ZoneMsg {
  type: 'zone';
  index: number;
}

interface CastMessage {
  type: 'cast';
}

interface FxMessage {
  type: 'fx';
  kind:
    | 'slash'
    | 'arrow'
    | 'fire'
    | 'heal'
    | 'smite'
    | 'dash'
    | 'hit'
    | 'die'
    | 'levelup'
    | 'down'
    | 'bomb'
    | 'boom'
    | 'radial'
    | 'freeze'
    | 'telegraph'
    | 'frostbolt'
    | 'chill'
    | 'roar'
    | 'poison'
    | 'burn'
    | 'shock'
    | 'mobshot';
  x: number;
  y: number;
  id?: string;
  amount?: number;
  tx?: number;
  ty?: number;
  /** Radius for telegraph/bomb rings; boss kind for roar. */
  r?: number;
  k?: number;
  /** Verium dropped (on `die`). */
  coin?: number;
}

interface ChatMessage {
  type: 'chat';
  msg: number;
  id?: string;
}

interface RosterMsg {
  type: 'roster';
  order: string[];
  names: Record<string, string>;
  classes: Record<string, string>;
  looks?: Record<string, number>;
  accs?: Record<string, number>;
  voices?: Record<string, number>;
}

interface ClassMsg {
  type: 'class';
  cls: string;
}

interface PlayerStats {
  hp: number;
  max: number;
  lvl: number;
  xp: number;
  dmgMul?: number;
  cdMul?: number;
  /** Owned move-changing mods (M4): bomb / freeze / radial. */
  mods?: string[];
}

interface OfferMsg {
  type: 'offer';
  cards: string[];
}

interface UpgradeMsg {
  type: 'upgrade';
  pick: string;
}

type WorldMessage =
  | PosMessage
  | SnapMessage
  | ChatMessage
  | RosterMsg
  | ClassMsg
  | CastMessage
  | FxMessage
  | OfferMsg
  | UpgradeMsg
  | ZoneMsg;

interface RemotePlayer {
  entity: Entity;
  targetX: number;
  targetY: number;
  bubble: Container | null;
  bubbleUntil: number;
}

/**
 * Milestone 1: the shared overworld. Everyone walks one map; positions sync
 * through the host at 10Hz with client-side smoothing; quick-chat bubbles.
 * Combat/mobs/levels arrive in Milestone 2.
 */
export class WorldScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private tileView!: Container;
  private zone = 0;
  private portal: { x: number; y: number } | null = null;
  private portalView: Entity | null = null;
  private uiLayer!: Container;
  private camera!: Camera;
  private me!: Entity;
  private meBody!: Container;
  private joystick!: VirtualJoystick;
  private remotes = new Map<string, RemotePlayer>();
  private hostPositions: Record<string, { x: number; y: number }> = {};
  private sendIn = 0;
  private lastSent = { x: 0, y: 0 };
  private walkPhase = 0;
  private t = 0;
  private chatOpen: Container | null = null;
  private myBubble: { c: Container; until: number } | null = null;
  private statusText!: Text;
  private snapsSeen = 0;
  private chatsSeen = 0;
  private spawnPoint = { x: 800, y: 1200 };
  // Combat (M2)
  private hostMobs = new Map<number, MobState>();
  private mobRespawns: { at: number; homeX: number; homeY: number }[] = [];
  private stats: Record<string, PlayerStats> = {};
  private upgradeOverlay: {
    root: Entity;
    buttons: UIButton[];
    cards: string[];
    expanded: boolean;
  } | null = null;
  /** Pending level-up offers; [0] is the one the docked card is showing. */
  private offerQueue: string[][] = [];
  private mobViews = new Map<
    string,
    {
      e: Entity;
      bar: Graphics;
      body: Container;
      targetX: number;
      targetY: number;
      hp: number;
      kind: number;
    }
  >();
  private cooldownLeft = 0;
  private castBtn!: UIButton;
  private castZone!: Container;
  private castsDone = 0;
  private boomsSeen = 0;
  private chilledUntil = 0;
  private downUntil = 0;
  private hudText!: Text;
  private hpBar!: Graphics;
  private myBar!: Graphics;
  private partyPanel!: Container;
  private partyRows = new Map<string, { body: Container; bar: Graphics; nameT: Text }>();
  private nextMobId = 1;
  private killsSeen = 0;
  private veriumEarned = 0;
  private chatBtnRef: UIButton | null = null;
  private codeHud: Text | null = null;

  protected override onResize(w: number, h: number): void {
    this.layoutUi(w, h);
  }

  private layoutUi(W: number, H: number): void {
    // Comfort: the whole right half of the screen casts (buttons still win).
    this.castZone.hitArea = new Rectangle(W / 2, 0, W / 2, H);
    this.joystick.position.set(170, H - 190);
    this.chatBtnRef?.position.set(W - 110, H - 290);
    this.castBtn.position.set(W - 120, H - 130);
    this.codeHud?.position.set(W / 2, 40);
    this.statusText.position.set(W / 2, H / 2);
    this.camera.setViewSize(W, H);
    if (this.chatOpen) this.closeChat();
    // Keep the docked level-up card glued to the (new) left edge.
    if (this.upgradeOverlay) this.renderOffer(this.upgradeOverlay.expanded);
  }

  constructor(
    private readonly session: Session,
    private readonly roster: RosterState,
  ) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const session = this.session;

    this.map = tileMapFromRows(valeRows, TILE_SIZE, valeLegend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.tileView = buildTileMapView(this.map, ZONES[this.zone]!.painters);
    this.mapLayer.addChildAt(this.tileView, 0);
    this.applyZoneBackdrop();

    const spawn = this.map.objects.find((o) => o.name === 'spawn') ?? { x: 800, y: 1200 };

    // My adventurer (spread players around the spawn by roster index).
    const myIndex = Math.max(0, this.roster.order.indexOf(session.id));
    const mine = this.makeAdventurer(session.id, true);
    this.me = mine.entity;
    this.meBody = mine.body;
    this.me.position.set(spawn.x + (myIndex - 2) * 70, spawn.y + (myIndex % 2) * 60);
    this.add(this.me, this.mapLayer);
    this.lastSent = { x: this.me.x, y: this.me.y };
    this.hostPositions[session.id] = { x: this.me.x, y: this.me.y };

    // Everyone else.
    this.spawnPoint = { x: spawn.x, y: spawn.y };
    this.roster.order.forEach((id, i) => {
      if (id === session.id) return;
      this.spawnRemote(id, i);
    });

    this.camera = new Camera(this.mapLayer, W, H, { deadzoneWidth: 120, deadzoneHeight: 160 });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.me);

    // Cast-anywhere zone sits at the bottom of the UI layer so real buttons
    // (chat, cast, overlays) hit-test first.
    this.castZone = new Container();
    this.castZone.eventMode = 'static';
    this.castZone.hitArea = new Rectangle(W / 2, 0, W / 2, H);
    this.castZone.on('pointerdown', () => {
      // The level-up card is docked on the LEFT edge and its buttons hit-test
      // first, so a right-side tap should still attack while an offer is up.
      if (!this.chatOpen) this.tryCast();
    });
    this.uiLayer.addChild(this.castZone);

    this.joystick = new VirtualJoystick({ radius: 100 });
    this.joystick.position.set(170, H - 190);
    this.add(this.joystick, this.uiLayer);

    const chatBtn = new UIButton('💬', {
      width: 110,
      height: 110,
      fontSize: 44,
      fill: forestDeep.accent,
      onTap: () => this.toggleChat(),
    });
    this.chatBtnRef = chatBtn;
    chatBtn.position.set(W - 110, H - 290);
    this.add(chatBtn, this.uiLayer);

    const myAbility = ABILITIES[this.roster.classes[session.id] ?? 'knight'];
    this.castBtn = new UIButton(myAbility?.label ?? '⚔️', {
      width: 150,
      height: 150,
      fontSize: 60,
      fill: 0xffffff,
      onTap: () => this.tryCast(),
    });
    this.castBtn.position.set(W - 120, H - 130);
    this.add(this.castBtn, this.uiLayer);

    // My HP bar rides under my blob; HUD text top-left.
    this.myBar = new Graphics();
    this.myBar.position.set(0, 62);
    this.me.addChild(this.myBar);
    this.hudText = makeText('', 24, { color: forestDeep.ink, weight: '800' });
    this.hudText.anchor.set(0, 0.5);
    this.hudText.position.set(16, 76);
    this.uiLayer.addChild(this.hudText);
    this.hpBar = new Graphics();
    this.hpBar.position.set(16, 96);
    this.uiLayer.addChild(this.hpBar);

    // Party panel: a little portrait + health bar for every adventurer.
    this.partyPanel = new Container();
    this.partyPanel.position.set(16, 122);
    this.uiLayer.addChild(this.partyPanel);
    this.buildPartyPanel();

    for (const id of this.roster.order) {
      this.stats[id] = { hp: maxHpAtLevel(1), max: maxHpAtLevel(1), lvl: 1, xp: 0 };
    }
    if (session.isHost) {
      for (const camp of this.map.objects.filter((o) => o.name === 'camp')) {
        CAMP_VARIANTS.forEach((v) => this.hostSpawnMob(camp.x, camp.y, v));
      }
      const lair = this.map.objects.find((o) => o.name === 'boss');
      if (lair) this.hostSpawnBoss(lair.x, lair.y + 60, this.zone);
    }

    const hud = makeText(
      `${session.code}  ·  ${classById(this.roster.classes[session.id]).name}`,
      24,
      {
        color: forestDeep.inkSoft,
        weight: 'bold',
      },
    );
    hud.position.set(W / 2, 40);
    this.codeHud = hud;
    this.uiLayer.addChild(hud);

    this.statusText = makeText('', 30, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.statusText.position.set(W / 2, H / 2);
    this.uiLayer.addChild(this.statusText);

    window.__blobvale = {
      scene: () => 'world',
      code: () => session.code,
      playerCount: () => this.roster.order.length,
      names: () => this.roster.order.map((id) => this.roster.names[id] ?? '?'),
      classes: () => ({ ...this.roster.classes }),
      myPos: () => ({ x: this.me.x, y: this.me.y }),
      remotePos: (id: string) => {
        const r = this.remotes.get(id);
        return r ? { x: r.entity.x, y: r.entity.y } : null;
      },
      remoteIds: () => [...this.remotes.keys()],
      snapsSeen: () => this.snapsSeen,
      chatsSeen: () => this.chatsSeen,
      sendChat: (i: number) => this.sendChat(i),
      cast: () => this.tryCast(),
      mobCount: () => (this.session.isHost ? this.hostMobs.size : this.mobViews.size),
      myStats: () => this.stats[this.session.id] ?? null,
      kills: () => this.killsSeen,
      verium: () => verium.balance(),
      veriumEarned: () => this.veriumEarned,
      partySize: () => this.partyRows.size,
      mobInfo: () =>
        this.session.isHost
          ? [...this.hostMobs.values()].map((m) => ({
              v: m.variant ?? 'melee',
              fz: (m.frozenUntil ?? 0) > this.t,
              ci: (m.ccImmuneUntil ?? 0) > this.t,
              po: (m.poisonUntil ?? 0) > this.t,
              bu: (m.burnUntil ?? 0) > this.t,
              sh: (m.shockUntil ?? 0) > this.t,
            }))
          : [],
      zapNearest: (kind: StatusKind) => {
        if (!this.session.isHost) return null;
        let nearest: MobState | null = null;
        let bestD = Infinity;
        for (const m of this.hostMobs.values()) {
          const d = Math.hypot(m.x - this.me.x, m.y - this.me.y);
          if (d < bestD) {
            bestD = d;
            nearest = m;
          }
        }
        return nearest ? this.applyStatus(nearest, kind) : null;
      },
      upgradeOpen: () => this.upgradeOverlay !== null,
      pickUpgrade: (i: number) => {
        const card = this.upgradeOverlay?.cards[i];
        if (card) this.pickUpgrade(card);
      },
      dmgMul: () => this.stats[this.session.id]?.dmgMul ?? 1,
      casts: () => this.castsDone,
      booms: () => this.boomsSeen,
      giveMod: (id: string) => {
        if (this.session.isHost) this.applyUpgrade(this.session.id, id);
      },
      zone: () => this.zone,
      portalOpen: () => this.portal !== null || this.portalView !== null,
      killBoss: () => {
        if (!this.session.isHost) return;
        const b = this.hostMobs.get(BOSS.ID);
        if (b) this.hostHitMob(b, b.hp);
      },
      enterPortal: () => {
        if (this.session.isHost && this.portal) this.me.position.set(this.portal.x, this.portal.y);
      },
      bossHp: () => {
        if (this.session.isHost) return this.hostMobs.get(BOSS.ID)?.hp ?? null;
        const v = this.mobViews.get(String(BOSS.ID));
        return v ? v.hp : null;
      },
      warp: (x: number, y: number) => {
        this.me.position.set(x, y);
      },
      revive: () => {
        if (!this.session.isHost) return;
        this.downUntil = 0;
        for (const st of Object.values(this.stats)) st.hp = st.max;
      },
      joystickScreen: () => {
        const p = this.joystick.getGlobalPosition();
        return { x: p.x, y: p.y };
      },
    };

    session.onMessage((from, data) => this.onNet(from, data as WorldMessage));
    if (session.isHost) {
      // Late joiners: greet them in their lobby; they enter once they pick
      // a class (their 'class' message is handled in onNet).
      session.onPlayerJoin((p) => {
        this.roster.names[p.id] = p.name;
        session.sendTo(p.id, { type: 'inprogress' });
        session.sendTo(p.id, { type: 'roster', ...this.roster });
        audio.chime();
      });
    }
    session.onPlayerLeave((id) => {
      const r = this.remotes.get(id);
      if (r) {
        this.remove(r.entity);
        this.remotes.delete(id);
      }
      delete this.hostPositions[id];
    });
    session.onClose((reason) => {
      this.statusText.text = `Disconnected: ${reason} — returning to menu…`;
      const back = new Entity();
      back.addBehavior(
        new Timer(2.5, () => {
          window.history.replaceState(null, '', window.location.pathname);
          this.game.scenes.replace(new MenuScene());
        }),
      );
      this.add(back);
    });
  }

  protected override onExit(): void {
    delete window.__blobvale;
  }

  private spawnRemote(id: string, index: number): void {
    if (this.remotes.has(id) || id === this.session.id) return;
    const made = this.makeAdventurer(id, false);
    const e = made.entity;
    e.position.set(this.spawnPoint.x + (index - 2) * 70, this.spawnPoint.y + (index % 2) * 60);
    this.add(e, this.mapLayer);
    this.remotes.set(id, { entity: e, targetX: e.x, targetY: e.y, bubble: null, bubbleUntil: 0 });
    this.hostPositions[id] = { x: e.x, y: e.y };
  }

  private makeAdventurer(id: string, isMe: boolean): { entity: Entity; body: Container } {
    const cls = classById(this.roster.classes[id]);
    const e = new Entity();
    const char = blobCharacter({
      radius: 30,
      color: shadeFor(cls.color, this.roster.looks?.[id] ?? 2),
      seed: 5 + this.roster.order.indexOf(id),
      strokeWidth: isMe ? 5 : 3,
    });
    char.body.addChild(cls.accessory(30));
    char.body.addChild(accessoryView(this.roster.accs?.[id], 30));
    e.addChild(char.view);
    if (!isMe) {
      e.addBehavior(new Wobble({ target: char.body, amount: 0.03, speed: 2.4 }));
    }
    const label = makeText(this.roster.names[id] ?? '?', 18, {
      color: isMe ? forestDeep.accent : forestDeep.ink,
      weight: 'bold',
    });
    label.position.set(0, 48);
    e.addChild(label);
    return { entity: e, body: char.body };
  }

  // ----------------------------------------------------------- networking

  private onNet(from: string, msg: WorldMessage): void {
    if (msg?.type === 'pos' && this.session.isHost) {
      this.hostPositions[from] = { x: msg.x, y: msg.y };
      return;
    }
    if (msg?.type === 'snap' && !this.session.isHost) {
      this.snapsSeen += 1;
      for (const [id, p] of Object.entries(msg.players)) {
        if (id === this.session.id) continue;
        const r = this.remotes.get(id);
        if (r) {
          r.targetX = p.x;
          r.targetY = p.y;
        }
      }
      if (msg.stats) this.stats = msg.stats;
      // Late joiners (or anyone out of sync) repaint to the host's zone.
      if (msg.zone !== undefined && msg.zone !== this.zone) {
        this.loadZone(msg.zone);
        this.me.position.set(this.spawnPoint.x, this.spawnPoint.y);
      }
      if (msg.mobs) this.syncMobViews(msg.mobs);
      this.syncPortal(msg.portal ?? null);
      return;
    }
    if (msg?.type === 'zone' && !this.session.isHost) {
      this.loadZone(msg.index);
      this.me.position.set(this.spawnPoint.x, this.spawnPoint.y);
      return;
    }
    if (msg?.type === 'cast' && this.session.isHost) {
      this.resolveCast(from);
      return;
    }
    if (msg?.type === 'fx' && !this.session.isHost) {
      this.playFx(msg);
      return;
    }
    if (msg?.type === 'class' && this.session.isHost) {
      // A late joiner picked a class -> add them to the world for everyone.
      if (!this.roster.order.includes(from)) this.roster.order.push(from);
      this.roster.classes[from] = msg.cls;
      // Without stats the host ignores their casts and damage — the old
      // "late-joining cleric does nothing" bug.
      this.stats[from] ??= { hp: maxHpAtLevel(1), max: maxHpAtLevel(1), lvl: 1, xp: 0 };
      this.spawnRemote(from, this.roster.order.indexOf(from));
      this.buildPartyPanel();
      this.session.broadcast({ type: 'roster', ...this.roster });
      this.session.sendTo(from, { type: 'start', roster: this.roster });
      return;
    }
    if (msg?.type === 'roster' && !this.session.isHost) {
      msg.order.forEach((id, i) => {
        this.roster.names[id] = msg.names[id] ?? '?';
        const newCls = msg.classes[id];
        const newLook = msg.looks?.[id];
        const newAcc = msg.accs?.[id];
        const newVoice = msg.voices?.[id];
        const lookChanged = newLook !== undefined && (this.roster.looks?.[id] ?? 2) !== newLook;
        const accChanged = newAcc !== undefined && (this.roster.accs?.[id] ?? 0) !== newAcc;
        const clsChanged =
          (newCls !== undefined && this.roster.classes[id] !== newCls) || lookChanged || accChanged;
        if (newCls !== undefined) this.roster.classes[id] = newCls;
        if (newLook !== undefined) (this.roster.looks ??= {})[id] = newLook;
        if (newAcc !== undefined) (this.roster.accs ??= {})[id] = newAcc;
        if (newVoice !== undefined) (this.roster.voices ??= {})[id] = newVoice;
        if (!this.roster.order.includes(id)) this.roster.order.push(id);
        if (id === this.session.id) return;
        const existing = this.remotes.get(id);
        if (!existing) {
          this.spawnRemote(id, i);
        } else if (clsChanged) {
          // Class arrived late or changed — rebuild the character in place.
          const x = existing.entity.x;
          const y = existing.entity.y;
          this.remove(existing.entity);
          this.remotes.delete(id);
          this.spawnRemote(id, i);
          const rebuilt = this.remotes.get(id);
          if (rebuilt) {
            rebuilt.entity.position.set(x, y);
            rebuilt.targetX = x;
            rebuilt.targetY = y;
          }
        }
      });
      this.buildPartyPanel();
      return;
    }
    if (msg?.type === 'offer' && !this.session.isHost) {
      this.showOffer(msg.cards);
      return;
    }
    if (msg?.type === 'upgrade' && this.session.isHost) {
      this.applyUpgrade(from, msg.pick);
      return;
    }
    if (msg?.type === 'chat') {
      const speaker = msg.id ?? from;
      if (this.session.isHost) {
        // Stamp and fan out, then show locally.
        this.session.broadcast({ type: 'chat', msg: msg.msg, id: speaker });
      }
      if (speaker !== this.session.id) this.showBubbleFor(speaker, msg.msg);
    }
  }

  private sendChat(i: number): void {
    const text = QUICK_CHAT[i];
    if (text === undefined) return;
    playVoice(this.roster.voices?.[this.session.id]);
    this.chatsSeen += 1;
    this.showMyBubble(text);
    if (this.session.isHost) {
      this.session.broadcast({ type: 'chat', msg: i, id: this.session.id });
    } else {
      this.session.send({ type: 'chat', msg: i });
    }
    this.closeChat();
  }

  // ------------------------------------------------------------- chat UI

  private toggleChat(): void {
    if (this.chatOpen) {
      this.closeChat();
      return;
    }
    audio.blip();
    const W = this.game.viewWidth;
    const panel = new Container();
    const bg = new Graphics();
    drawPanel(bg, 620, 250, { fill: 0x243a2a, stroke: forestDeep.ink, radius: 24 });
    panel.addChild(bg);
    QUICK_CHAT.forEach((phrase, i) => {
      const btn = new UIButton(phrase, {
        width: 280,
        height: 90,
        fontSize: 26,
        fill: forestDeep.accent,
        textColor: 0x1c2418,
        onTap: () => this.sendChat(i),
      });
      const col = i % 2;
      const row = Math.floor(i / 2);
      btn.position.set(160 + col * 300, 45 + row * 55);
      btn.scale.set(0.55);
      panel.addChild(btn);
    });
    panel.position.set((W - 620) / 2, this.game.viewHeight - 480);
    this.uiLayer.addChild(panel);
    this.chatOpen = panel;
  }

  private closeChat(): void {
    if (!this.chatOpen) return;
    this.chatOpen.parent?.removeChild(this.chatOpen);
    this.chatOpen.destroy({ children: true });
    this.chatOpen = null;
  }

  private makeBubble(text: string): Container {
    const c = new Container();
    const label = makeText(text, 24, { color: 0x1c2418, weight: '800' });
    const w = Math.max(90, label.width + 36);
    const bg = new Graphics()
      .roundRect(-w / 2, -66, w, 48, 22)
      .fill(0xf2ffe9)
      .poly([-8, -20, 8, -20, 0, -6])
      .fill(0xf2ffe9);
    label.position.set(0, -42);
    c.addChild(bg, label);
    return c;
  }

  private showMyBubble(text: string): void {
    if (this.myBubble) {
      this.myBubble.c.parent?.removeChild(this.myBubble.c);
      this.myBubble.c.destroy({ children: true });
    }
    const c = this.makeBubble(text);
    c.position.set(0, -40);
    this.me.addChild(c);
    this.myBubble = { c, until: this.t + 2.5 };
  }

  private showBubbleFor(id: string, msgIndex: number): void {
    const r = this.remotes.get(id);
    const text = QUICK_CHAT[msgIndex];
    if (!r || text === undefined) return;
    this.chatsSeen += 1;
    playVoice(this.roster.voices?.[id]);
    if (r.bubble) {
      r.bubble.parent?.removeChild(r.bubble);
      r.bubble.destroy({ children: true });
    }
    const c = this.makeBubble(text);
    c.position.set(0, -40);
    r.entity.addChild(c);
    r.bubble = c;
    r.bubbleUntil = this.t + 2.5;
  }

  // --------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    this.t += dt;
    const cls = classById(this.roster.classes[this.session.id]);

    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    this.castBtn.alpha = this.cooldownLeft > 0 || this.t < this.downUntil ? 0.35 : 1;
    if (this.session.isHost) this.hostSimMobs(dt);
    for (const v of this.mobViews.values()) {
      const k = Math.min(1, dt * 12);
      v.e.x += (v.targetX - v.e.x) * k;
      v.e.y += (v.targetY - v.e.y) * k;
      v.e.update(dt);
    }
    this.updateHud();

    // Move me (frozen briefly while downed).
    const down = this.t < this.downUntil;
    const jx = down ? 0 : this.joystick.value.x;
    const jy = down ? 0 : this.joystick.value.y;
    const moving = Math.hypot(jx, jy) > 0.12;
    if (moving) {
      // Frost Wraith bolts chill: move at about half speed for a moment.
      const speed = cls.speed * (this.t < this.chilledUntil ? MODS.CHILL_FACTOR : 1);
      const moved = moveWithCollision(
        this.map,
        this.me.x,
        this.me.y,
        20,
        14,
        jx * speed * dt,
        jy * speed * dt,
      );
      this.me.position.set(moved.x, moved.y);
      this.walkPhase += dt * 11;
      const s = Math.sin(this.walkPhase) * 0.07;
      this.meBody.scale.set(1 + s, 1 - s);
    } else {
      this.meBody.scale.set(1, 1);
    }

    // Ship my position (10Hz, only when it changed).
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      this.sendIn = SEND_INTERVAL;
      const dx = this.me.x - this.lastSent.x;
      const dy = this.me.y - this.lastSent.y;
      if (Math.hypot(dx, dy) > 1) {
        this.lastSent = { x: this.me.x, y: this.me.y };
        if (this.session.isHost) {
          this.hostPositions[this.session.id] = { x: this.me.x, y: this.me.y };
        } else {
          const msg: PosMessage = { type: 'pos', x: this.me.x, y: this.me.y };
          this.session.send(msg);
        }
      }
      // Host fans the world snapshot out on the same cadence.
      if (this.session.isHost) {
        this.hostPositions[this.session.id] = { x: this.me.x, y: this.me.y };
        const mobs: NonNullable<SnapMessage['mobs']> = {};
        for (const m of this.hostMobs.values()) {
          mobs[String(m.id)] = {
            x: m.x,
            y: m.y,
            hp: m.hp,
            max: m.max,
            ...(m.kind !== undefined ? { k: m.kind } : {}),
            ...(m.variant ? { vr: m.variant } : {}),
            ...(m.frozenUntil !== undefined && this.t < m.frozenUntil ? { f: 1 } : {}),
            ...(m.poisonUntil !== undefined && this.t < m.poisonUntil ? { p: 1 } : {}),
            ...(m.burnUntil !== undefined && this.t < m.burnUntil ? { b: 1 } : {}),
            ...(m.shockUntil !== undefined && this.t < m.shockUntil ? { sh: 1 } : {}),
          };
        }
        const snap: SnapMessage = {
          type: 'snap',
          players: this.hostPositions,
          mobs,
          stats: this.stats,
          zone: this.zone,
          portal: this.portal,
        };
        this.session.broadcast(snap);
        this.syncMobViews(mobs);
        this.syncPortal(this.portal);
        this.hostCheckPortalEntry();
      }
    }

    // Smooth remote players toward their latest known positions.
    for (const r of this.remotes.values()) {
      if (this.session.isHost) {
        const p = this.hostPositions[this.rosterIdOf(r)];
        if (p) {
          r.targetX = p.x;
          r.targetY = p.y;
        }
      }
      const k = Math.min(1, dt * 12);
      r.entity.x += (r.targetX - r.entity.x) * k;
      r.entity.y += (r.targetY - r.entity.y) * k;
      if (r.bubble && this.t > r.bubbleUntil) {
        r.bubble.parent?.removeChild(r.bubble);
        r.bubble.destroy({ children: true });
        r.bubble = null;
      }
    }
    if (this.myBubble && this.t > this.myBubble.until) {
      this.myBubble.c.parent?.removeChild(this.myBubble.c);
      this.myBubble.c.destroy({ children: true });
      this.myBubble = null;
    }

    this.camera.update(dt);
  }

  // ------------------------------------------------------------ combat (M2)

  private tryCast(): void {
    if (this.cooldownLeft > 0 || this.t < this.downUntil) return;
    const def = ABILITIES[this.roster.classes[this.session.id] ?? 'knight'];
    if (!def) return;
    this.cooldownLeft = def.cooldown * (this.stats[this.session.id]?.cdMul ?? 1);
    this.castsDone += 1;
    audio.blip(1.6);
    if (this.session.isHost) {
      this.resolveCast(this.session.id);
    } else {
      this.session.send({ type: 'cast' });
    }
  }

  private hostSpawnMob(homeX: number, homeY: number, variant: MobVariant = 'melee'): void {
    const id = this.nextMobId++;
    const def = MOB_VARIANTS[variant];
    this.hostMobs.set(id, {
      id,
      x: homeX + (Math.random() * 2 - 1) * 60,
      y: homeY + (Math.random() * 2 - 1) * 60,
      hp: def.hp,
      max: def.hp,
      homeX,
      homeY,
      target: null,
      attackIn: 0,
      variant,
    });
  }

  private bossEnraged = false;

  private hostSpawnBoss(x: number, y: number, kind = 0): void {
    const def = BOSSES[kind % BOSSES.length] ?? BOSSES[0];
    if (!def) return;
    this.bossEnraged = false;
    const hp = bossHpFor(def.hp, this.roster.order.length);
    this.hostMobs.set(BOSS.ID, {
      id: BOSS.ID,
      x,
      y,
      hp,
      max: hp,
      homeX: x,
      homeY: y,
      target: null,
      attackIn: 0,
      kind: kind % BOSSES.length,
      specialIn: def.specialEvery,
    });
  }

  // ------------------------------------------------------------- zones (M6)

  private applyZoneBackdrop(): void {
    const bg = ZONES[this.zone]?.palette.bg;
    if (bg !== undefined) {
      try {
        this.game.app.renderer.background.color = bg;
      } catch {
        /* renderer may not expose a settable background — tiles carry it */
      }
    }
  }

  /** Repaint the world to `index`'s look (collision/spawns are shared). */
  private loadZone(index: number): void {
    this.zone = ((index % ZONES.length) + ZONES.length) % ZONES.length;
    const painters = ZONES[this.zone]!.painters;
    const next = buildTileMapView(this.map, painters);
    this.mapLayer.removeChild(this.tileView);
    this.tileView.destroy({ children: true });
    this.tileView = next;
    this.mapLayer.addChildAt(this.tileView, 0);
    this.applyZoneBackdrop();
    if (this.codeHud) {
      this.codeHud.text = `${this.session.code}  ·  ${ZONES[this.zone]!.name}`;
    }
    this.announce(`Entering ${ZONES[this.zone]!.name}!`);
  }

  /** Host: everyone moves to the next level and a fresh boss awaits. */
  private advanceZone(): void {
    const next = (this.zone + 1) % ZONES.length;
    this.portal = null;
    this.syncPortal(null);
    this.hostMobs.clear();
    this.mobRespawns = [];
    this.session.broadcast({ type: 'zone', index: next });
    this.loadZone(next);
    this.me.position.set(this.spawnPoint.x, this.spawnPoint.y);
    this.hostPositions[this.session.id] = { x: this.me.x, y: this.me.y };
    for (const camp of this.map.objects.filter((o) => o.name === 'camp')) {
      CAMP_VARIANTS.forEach((v) => this.hostSpawnMob(camp.x, camp.y, v));
    }
    const lair = this.map.objects.find((o) => o.name === 'boss');
    if (lair) this.hostSpawnBoss(lair.x, lair.y + 60, next);
    audio.chime();
  }

  /** Host: has anyone stepped into the portal to the next level? */
  private hostCheckPortalEntry(): void {
    if (!this.portal) return;
    for (const p of Object.values(this.hostPositions)) {
      if (Math.hypot(p.x - this.portal.x, p.y - this.portal.y) < 70) {
        this.advanceZone();
        return;
      }
    }
  }

  /** Create/move/remove the swirling portal marker (host + clients). */
  private syncPortal(p: { x: number; y: number } | null): void {
    if (p) {
      if (!this.portalView) {
        const e = new Entity();
        const g = new Graphics();
        for (let i = 0; i < 3; i++) {
          g.circle(0, 0, 46 - i * 12).stroke({ color: 0xc77dff, width: 6, alpha: 0.9 - i * 0.2 });
        }
        g.circle(0, 0, 12).fill(0xf2ffe9);
        e.addChild(g);
        const label = makeText('NEXT LEVEL ➜', 22, { color: 0xe0c3ff, weight: '800' });
        label.position.set(0, -70);
        e.addChild(label);
        e.addBehavior(new Wobble({ target: e, amount: 0.14, speed: 3 }));
        this.portalView = e;
        this.add(e, this.mapLayer);
      }
      this.portalView.position.set(p.x, p.y);
    } else if (this.portalView) {
      this.remove(this.portalView);
      this.portalView = null;
    }
  }

  /** Brief center-screen announcement (zone name, etc.). */
  private announce(text: string): void {
    this.statusText.text = text;
    const clear = new Entity();
    clear.addBehavior(new Timer(2.4, () => (this.statusText.text = '')));
    this.add(clear);
  }

  private hostSimMobs(dt: number): void {
    for (const m of this.hostMobs.values()) {
      // Damage-over-time first — a mob can die to poison/burn between hits.
      if (this.tickStatuses(m)) continue;

      const bd = m.kind !== undefined ? BOSSES[m.kind] : undefined;
      const variant: MobVariant = m.variant ?? 'melee';
      const mv = MOB_VARIANTS[variant];
      const baseSpeed = bd ? (this.bossEnraged ? bd.enragedSpeed : bd.speed) : MOB.SPEED;
      const shocked = m.shockUntil !== undefined && this.t < m.shockUntil;
      const speed = baseSpeed * (shocked ? 1 - STATUS.shock.slow : 1);
      const atkRange = bd ? bd.attackRange : mv.range;
      const atkDmg = bd ? bd.attackDamage : mv.dmg;
      const atkEvery = (bd ? bd.attackEvery : mv.every) * (bd && this.bossEnraged ? 0.6 : 1);

      // Frozen solid: no thinking/moving/attacking (DoTs still tick above).
      if (m.frozenUntil !== undefined && this.t < m.frozenUntil) continue;
      // Acquire/drop target.
      let best: string | null = null;
      let bestD = bd ? BOSS.AGGRO_RANGE : MOB.AGGRO_RANGE;
      for (const [pid, p] of Object.entries(this.hostPositions)) {
        if ((this.stats[pid]?.hp ?? 0) <= 0) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bestD) {
          best = pid;
          bestD = d;
        }
      }
      if (Math.hypot(m.x - m.homeX, m.y - m.homeY) > MOB.LEASH_RANGE) best = null;
      // Bosses announce themselves when they pick up fresh aggro.
      if (bd && best && m.target === null && this.t - (m.roaredAt ?? -99) > 8) {
        m.roaredAt = this.t;
        this.broadcastFx({ type: 'fx', kind: 'roar', x: m.x, y: m.y, k: m.kind ?? 0 });
      }
      m.target = best;

      const goal = best
        ? this.hostPositions[best]
        : {
            x: m.homeX + Math.sin(this.t * 0.7 + m.id) * 50,
            y: m.homeY + Math.cos(this.t * 0.5 + m.id) * 50,
          };
      if (goal) {
        const d = Math.hypot(goal.x - m.x, goal.y - m.y) || 1;
        let dirx = (goal.x - m.x) / d;
        let diry = (goal.y - m.y) / d;
        const stop = best ? atkRange * 0.8 : 6;
        let move = false;
        // Ranged mobs kite: back off if a player closes inside half their range.
        if (best && variant === 'ranged' && d < atkRange * 0.5) {
          dirx = -dirx;
          diry = -diry;
          move = true;
        } else if (d > stop) {
          move = true;
        }
        if (move) {
          const moved = moveWithCollision(
            this.map,
            m.x,
            m.y,
            18,
            14,
            dirx * speed * dt,
            diry * speed * dt,
          );
          m.x = moved.x;
          m.y = moved.y;
        }
      }

      m.attackIn -= dt;
      if (best && m.attackIn <= 0) {
        const p = this.hostPositions[best];
        if (p && Math.hypot(p.x - m.x, p.y - m.y) <= atkRange) {
          m.attackIn = atkEvery;
          if (bd) {
            this.hostHurtPlayer(best, atkDmg);
          } else if (variant === 'ranged') {
            this.broadcastFx({ type: 'fx', kind: 'mobshot', x: m.x, y: m.y, tx: p.x, ty: p.y });
            this.hostHurtPlayer(best, atkDmg);
          } else if (variant === 'aoe') {
            this.hostMobSlam(m, mv);
          } else {
            this.hostHurtPlayer(best, atkDmg);
          }
        }
      }
      if (bd && best) this.hostBossSpecial(m, bd, best, dt);
    }
    // Respawns.
    const now = this.t;
    this.mobRespawns = this.mobRespawns.filter((r) => {
      if (now >= r.at) {
        this.hostSpawnMob(r.homeX, r.homeY);
        return false;
      }
      return true;
    });
  }

  /** Boss signature moves: telegraphed slam, chilling bolt, lobbed bomb. */
  private hostBossSpecial(m: MobState, bd: (typeof BOSSES)[number], targetId: string, dt: number) {
    m.specialIn = (m.specialIn ?? bd.specialEvery) - dt;
    if (m.specialIn > 0) return;
    const p = this.hostPositions[targetId];
    if (!p || Math.hypot(p.x - m.x, p.y - m.y) > bd.specialRange) return;
    m.specialIn = bd.specialEvery * (this.bossEnraged ? 0.6 : 1);
    if (bd.special === 'slam') {
      const bx = m.x;
      const by = m.y;
      this.broadcastFx({ type: 'fx', kind: 'telegraph', x: bx, y: by, r: bd.specialRadius });
      const fuse = new Entity();
      fuse.addBehavior(
        new Timer(0.85, () => {
          this.broadcastFx({ type: 'fx', kind: 'boom', x: bx, y: by, r: bd.specialRadius });
          for (const [pid, pp] of Object.entries(this.hostPositions)) {
            if (Math.hypot(pp.x - bx, pp.y - by) <= bd.specialRadius) {
              this.hostHurtPlayer(pid, bd.specialDamage);
            }
          }
        }),
      );
      this.add(fuse);
    } else if (bd.special === 'frostbolt') {
      this.broadcastFx({ type: 'fx', kind: 'frostbolt', x: m.x, y: m.y, tx: p.x, ty: p.y });
      this.hostHurtPlayer(targetId, bd.specialDamage);
      this.broadcastFx({ type: 'fx', kind: 'chill', x: p.x, y: p.y, id: targetId });
    } else {
      // Ember Titan lobs a bomb at where you're standing — move!
      const bx = p.x;
      const by = p.y;
      this.broadcastFx({ type: 'fx', kind: 'bomb', x: bx, y: by, r: bd.specialRadius });
      const fuse = new Entity();
      fuse.addBehavior(
        new Timer(1.0, () => {
          this.broadcastFx({ type: 'fx', kind: 'boom', x: bx, y: by, r: bd.specialRadius });
          for (const [pid, pp] of Object.entries(this.hostPositions)) {
            if (Math.hypot(pp.x - bx, pp.y - by) <= bd.specialRadius) {
              this.hostHurtPlayer(pid, bd.specialDamage);
            }
          }
        }),
      );
      this.add(fuse);
    }
  }

  /** Host-authoritative player damage + down/revive handling. */
  private hostHurtPlayer(pid: string, dmg: number): void {
    const st = this.stats[pid];
    const p = pid === this.session.id ? this.me : this.hostPositions[pid];
    if (!st || !p || st.hp <= 0) return;
    st.hp = Math.max(0, st.hp - dmg);
    this.broadcastFx({ type: 'fx', kind: 'hit', x: p.x, y: p.y, amount: dmg });
    if (st.hp <= 0) {
      this.broadcastFx({ type: 'fx', kind: 'down', x: p.x, y: p.y, id: pid });
      const revive = new Entity();
      revive.addBehavior(
        new Timer(RESPAWN_SECONDS, () => {
          const rst = this.stats[pid];
          if (rst) rst.hp = rst.max;
        }),
      );
      this.add(revive);
    }
  }

  private resolveCast(casterId: string): void {
    const def = ABILITIES[this.roster.classes[casterId] ?? 'knight'];
    const caster = casterId === this.session.id ? this.me : this.hostPositions[casterId];
    const st = this.stats[casterId];
    if (!def || !caster || !st || st.hp <= 0) return;
    const dmg = Math.round(damageAtLevel(def.damage, st.lvl) * (st.dmgMul ?? 1));
    const mods = st.mods ?? [];

    if (def.heals) {
      for (const [pid, p] of Object.entries(this.hostPositions)) {
        const target = this.stats[pid];
        if (!target || target.hp <= 0) continue;
        if (Math.hypot(p.x - caster.x, p.y - caster.y) <= def.splash) {
          target.hp = Math.min(target.max, target.hp + CLERIC_HEAL);
        }
      }
      this.broadcastFx({ type: 'fx', kind: 'heal', x: caster.x, y: caster.y });
    }

    // Nearest living mob in range.
    let target: MobState | null = null;
    let bestD = def.range;
    for (const m of this.hostMobs.values()) {
      const d = Math.hypot(m.x - caster.x, m.y - caster.y);
      if (d < bestD) {
        target = m;
        bestD = d;
      }
    }
    // The attack is always visible — the cleric's smite included.
    this.broadcastFx({
      type: 'fx',
      kind: def.fx,
      x: caster.x,
      y: caster.y,
      tx: target?.x ?? caster.x,
      ty: target?.y ?? caster.y - 60,
    });
    if (!target) return;

    const victims =
      def.splash > 0
        ? [...this.hostMobs.values()].filter(
            (m) => Math.hypot(m.x - target.x, m.y - target.y) <= def.splash,
          )
        : [target];
    this.applyStatuses(victims, mods, target.x, target.y);
    for (const m of victims) this.hostHitMob(m, dmg);

    // Move-changing mods (M4) — extra bursts on top of the base attack.
    if (mods.includes('radial')) {
      const near = [...this.hostMobs.values()].filter(
        (m) => Math.hypot(m.x - caster.x, m.y - caster.y) <= MODS.RADIAL_RADIUS,
      );
      this.broadcastFx({ type: 'fx', kind: 'radial', x: caster.x, y: caster.y });
      const rDmg = Math.max(1, Math.round(dmg * MODS.RADIAL_FACTOR));
      for (const m of near) this.hostHitMob(m, rDmg);
    }
    if (mods.includes('bomb')) {
      const bx = target.x;
      const by = target.y;
      this.broadcastFx({ type: 'fx', kind: 'bomb', x: bx, y: by, r: MODS.BOMB_RADIUS });
      const bDmg = Math.max(1, Math.round(dmg * MODS.BOMB_FACTOR));
      const fuse = new Entity();
      fuse.addBehavior(
        new Timer(MODS.BOMB_FUSE, () => {
          this.broadcastFx({ type: 'fx', kind: 'boom', x: bx, y: by, r: MODS.BOMB_RADIUS });
          const caught = [...this.hostMobs.values()].filter(
            (m) => Math.hypot(m.x - bx, m.y - by) <= MODS.BOMB_RADIUS,
          );
          for (const m of caught) this.hostHitMob(m, bDmg);
        }),
      );
      this.add(fuse);
    }
  }

  /** Damage one mob: hit fx, boss enrage phase, death/respawn/XP. */
  private hostHitMob(m: MobState, dmg: number): void {
    if (!this.hostMobs.has(m.id)) return;
    m.hp -= dmg;
    this.broadcastFx({ type: 'fx', kind: 'hit', x: m.x, y: m.y - 30, amount: dmg });
    if (m.id === BOSS.ID && !this.bossEnraged && m.hp <= m.max / 2 && m.hp > 0) {
      // Phase 2: the boss speeds up and calls minions.
      this.bossEnraged = true;
      for (let i = 0; i < BOSS.MINIONS_ON_ENRAGE; i++) this.hostSpawnMob(m.x, m.y);
      this.broadcastFx({ type: 'fx', kind: 'levelup', x: m.x, y: m.y });
    }
    if (m.hp <= 0) {
      this.hostMobs.delete(m.id);
      const isBoss = m.id === BOSS.ID;
      const bd = m.kind !== undefined ? BOSSES[m.kind] : undefined;
      this.broadcastFx({
        type: 'fx',
        kind: 'die',
        x: m.x,
        y: m.y,
        coin: isBoss ? VERIUM_PER_BOSS : VERIUM_PER_MOB,
      });
      this.hostGrantXp(m.x, m.y, bd ? bd.xp : MOB.XP_PER_KILL);
      if (isBoss) {
        // Boss down: open a portal to the next level instead of respawning.
        this.broadcastFx({ type: 'fx', kind: 'levelup', x: m.x, y: m.y });
        this.portal = { x: m.homeX, y: m.homeY };
      } else {
        this.mobRespawns.push({
          at: this.t + MOB.RESPAWN_SECONDS,
          homeX: m.homeX,
          homeY: m.homeY,
        });
      }
    }
  }

  // ------------------------------------------------------- status effects

  /** Roll each owned status mod's chance against each victim. */
  private applyStatuses(victims: MobState[], mods: string[], fxX: number, fxY: number): void {
    for (const kind of STATUS_KINDS) {
      if (!mods.includes(kind)) continue;
      let landed = false;
      for (const m of victims) {
        if (!this.hostMobs.has(m.id)) continue;
        if (Math.random() > STATUS[kind].chance) continue;
        if (this.applyStatus(m, kind)) landed = true;
      }
      if (landed) this.broadcastFx({ type: 'fx', kind, x: fxX, y: fxY });
    }
  }

  /** Apply one status; returns false if it didn't take (e.g. freeze on CD). */
  private applyStatus(m: MobState, kind: StatusKind): boolean {
    const t = this.t;
    if (kind === 'freeze') {
      // CC cooldown: can't be re-frozen until the immunity window passes.
      if (m.ccImmuneUntil !== undefined && t < m.ccImmuneUntil) return false;
      m.frozenUntil = t + STATUS.freeze.duration;
      m.ccImmuneUntil = t + STATUS.freeze.duration + STATUS.freeze.ccCooldown;
      return true;
    }
    if (kind === 'poison') {
      m.poisonUntil = t + STATUS.poison.duration;
      m.poisonNext = t + STATUS.poison.tick;
      return true;
    }
    if (kind === 'burn') {
      m.burnUntil = t + STATUS.burn.duration;
      m.burnNext = t + STATUS.burn.tick;
      return true;
    }
    m.shockUntil = t + STATUS.shock.duration; // shock
    return true;
  }

  /** Poison/burn ticks; returns true if the mob died from the tick. */
  private tickStatuses(m: MobState): boolean {
    const t = this.t;
    if (
      m.poisonUntil !== undefined &&
      t < m.poisonUntil &&
      m.poisonNext !== undefined &&
      t >= m.poisonNext
    ) {
      m.poisonNext = t + STATUS.poison.tick;
      this.hostHitMob(m, STATUS.poison.dmg);
      if (!this.hostMobs.has(m.id)) return true;
    }
    if (
      m.burnUntil !== undefined &&
      t < m.burnUntil &&
      m.burnNext !== undefined &&
      t >= m.burnNext
    ) {
      m.burnNext = t + STATUS.burn.tick;
      this.hostHitMob(m, STATUS.burn.dmg);
      if (!this.hostMobs.has(m.id)) return true;
    }
    return false;
  }

  /** AoE mob attack: a telegraphed slam that hits everyone in the blast. */
  private hostMobSlam(m: MobState, mv: MobVariantDef): void {
    const bx = m.x;
    const by = m.y;
    const blast = mv.blast ?? 130;
    this.broadcastFx({ type: 'fx', kind: 'telegraph', x: bx, y: by, r: blast });
    const fuse = new Entity();
    fuse.addBehavior(
      new Timer(0.7, () => {
        this.broadcastFx({ type: 'fx', kind: 'boom', x: bx, y: by, r: blast });
        for (const [pid, pp] of Object.entries(this.hostPositions)) {
          if (Math.hypot(pp.x - bx, pp.y - by) <= blast) this.hostHurtPlayer(pid, mv.dmg);
        }
      }),
    );
    this.add(fuse);
  }

  private hostGrantXp(x: number, y: number, amount = MOB.XP_PER_KILL): void {
    for (const [pid, p] of Object.entries(this.hostPositions)) {
      const st = this.stats[pid];
      if (!st || Math.hypot(p.x - x, p.y - y) > MOB.XP_RANGE) continue;
      st.xp += amount;
      while (st.xp >= xpForLevel(st.lvl)) {
        st.xp -= xpForLevel(st.lvl);
        st.lvl += 1;
        st.max = maxHpAtLevel(st.lvl);
        st.hp = st.max;
        this.broadcastFx({ type: 'fx', kind: 'levelup', x: p.x, y: p.y, id: pid });
        // Pool: stat cards + this class's move-changing mods not yet owned.
        const owned = st.mods ?? [];
        const cls = this.roster.classes[pid] ?? 'knight';
        const pool = [
          ...Object.keys(STAT_CARDS),
          ...(CLASS_MODS[cls] ?? []).filter((m) => !owned.includes(m)),
        ];
        const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? 'dmg';
        const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0] ?? 'hp';
        if (pid === this.session.id) {
          this.showOffer([a, b]);
        } else {
          this.session.sendTo(pid, { type: 'offer', cards: [a, b] });
        }
      }
    }
  }

  private broadcastFx(fx: FxMessage): void {
    this.session.broadcast(fx);
    this.playFx(fx);
  }

  private worldFor(id: string | undefined): { x: number; y: number } | null {
    if (!id) return null;
    if (id === this.session.id) return { x: this.me.x, y: this.me.y };
    const r = this.remotes.get(id);
    return r ? { x: r.entity.x, y: r.entity.y } : null;
  }

  private playFx(fx: FxMessage): void {
    const e = new Entity();
    e.position.set(fx.x, fx.y);
    const g = new Graphics();
    e.addChild(g);
    let life = 0.5;
    switch (fx.kind) {
      case 'slash':
        g.arc(0, 0, 90, -0.8, 1.6).stroke({ color: 0xffffff, width: 12, alpha: 0.9 });
        life = 0.25;
        break;
      case 'arrow':
      case 'dash': {
        const tx = (fx.tx ?? fx.x) - fx.x;
        const ty = (fx.ty ?? fx.y) - fx.y;
        g.moveTo(0, 0)
          .lineTo(tx, ty)
          .stroke({ color: fx.kind === 'arrow' ? 0xf2ffe9 : 0xd98a9c, width: 8, alpha: 0.9 });
        life = 0.2;
        break;
      }
      case 'fire':
        e.position.set(fx.tx ?? fx.x, fx.ty ?? fx.y);
        g.circle(0, 0, 90).fill({ color: 0xff8c42, alpha: 0.55 });
        g.circle(0, 0, 45).fill({ color: 0xffd166, alpha: 0.8 });
        audio.buzz();
        life = 0.35;
        break;
      case 'heal':
        g.circle(0, 0, 160).stroke({ color: 0x8affc1, width: 10, alpha: 0.8 });
        audio.chime();
        life = 0.5;
        break;
      case 'smite': {
        // Cleric's holy strike: golden rays crashing onto the target.
        e.position.set(fx.tx ?? fx.x, fx.ty ?? fx.y);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * 70, Math.sin(a) * 70)
            .stroke({ color: 0xffd166, width: 10, alpha: 0.9 });
        }
        g.circle(0, 0, 34).fill({ color: 0xfff3c4, alpha: 0.9 });
        e.addBehavior(new Tween(e.scale, { x: 1.5, y: 1.5 }, 0.3, { ease: easings.outQuad }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.35, { ease: easings.inQuad }));
        audio.pop(1.8);
        life = 0.4;
        break;
      }
      case 'bomb': {
        // Fuse phase: bomb + danger ring where it will blow.
        const r = fx.r ?? 150;
        g.circle(0, 0, r).stroke({ color: 0xff5470, width: 6, alpha: 0.55 });
        g.circle(0, 0, 22).fill(0x2b2b33);
        g.circle(8, -20, 6).fill(0xffd166);
        e.addBehavior(new Wobble({ target: e, amount: 0.12, speed: 14 }));
        audio.blip(0.6);
        life = 1.05;
        break;
      }
      case 'boom': {
        const r = fx.r ?? 150;
        g.circle(0, 0, r).fill({ color: 0xff8c42, alpha: 0.5 });
        g.circle(0, 0, r * 0.55).fill({ color: 0xffd166, alpha: 0.85 });
        g.circle(0, 0, r * 0.25).fill({ color: 0xfff3c4, alpha: 0.95 });
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.4, { ease: easings.outQuad }));
        this.camera.shake(14, 0.35);
        audio.buzz();
        this.boomsSeen += 1;
        life = 0.45;
        break;
      }
      case 'radial': {
        // Burst in all directions around the caster.
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30)
            .lineTo(Math.cos(a) * 110, Math.sin(a) * 110)
            .stroke({ color: 0xf2ffe9, width: 7, alpha: 0.9 });
        }
        e.addBehavior(new Tween(e.scale, { x: 2.1, y: 2.1 }, 0.3, { ease: easings.outQuad }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.3, { ease: easings.outQuad }));
        audio.pop(1.1);
        life = 0.35;
        break;
      }
      case 'freeze': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.poly([
            Math.cos(a) * 16,
            Math.sin(a) * 16,
            Math.cos(a) * 52,
            Math.sin(a) * 52,
            Math.cos(a + 0.5) * 28,
            Math.sin(a + 0.5) * 28,
          ]).fill({ color: 0xbdf0ff, alpha: 0.9 });
        }
        audio.blip(0.5);
        life = 0.6;
        break;
      }
      case 'poison': {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.circle(Math.cos(a) * 22, Math.sin(a) * 22, 9).fill({ color: 0x8fd94f, alpha: 0.85 });
        }
        const skull = makeText('☠️', 26, { color: 0xffffff });
        skull.position.set(0, -8);
        e.addChild(skull);
        e.addBehavior(new Tween(e, { y: fx.y - 40, alpha: 0 }, 0.8, { ease: easings.outQuad }));
        audio.blip(0.7);
        life = 0.8;
        break;
      }
      case 'burn': {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.poly([
            Math.cos(a) * 8,
            Math.sin(a) * 8,
            Math.cos(a) * 34,
            Math.sin(a) * 34 - 10,
            Math.cos(a + 0.4) * 16,
            Math.sin(a + 0.4) * 16,
          ]).fill({ color: i % 2 ? 0xff8c42 : 0xffd166, alpha: 0.9 });
        }
        audio.buzz();
        life = 0.55;
        break;
      }
      case 'shock': {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.4;
          g.moveTo(0, 0)
            .lineTo(Math.cos(a) * 20, Math.sin(a) * 20 - 6)
            .lineTo(Math.cos(a) * 42, Math.sin(a) * 42)
            .stroke({ color: 0xfff08a, width: 5, alpha: 0.95 });
        }
        audio.blip(1.9);
        life = 0.4;
        break;
      }
      case 'mobshot': {
        const tx = (fx.tx ?? fx.x) - fx.x;
        const ty = (fx.ty ?? fx.y) - fx.y;
        g.moveTo(0, 0).lineTo(tx, ty).stroke({ color: 0x9ad8ff, width: 6, alpha: 0.85 });
        g.circle(tx, ty, 12).fill({ color: 0xdff6ff, alpha: 0.9 });
        audio.blip(0.6);
        life = 0.22;
        break;
      }
      case 'telegraph': {
        // Red warning ring: get OUT of the circle.
        const r = fx.r ?? 180;
        g.circle(0, 0, r).stroke({ color: 0xff5470, width: 8, alpha: 0.8 });
        g.circle(0, 0, r).fill({ color: 0xff5470, alpha: 0.16 });
        e.addBehavior(new Wobble({ target: e, amount: 0.05, speed: 16 }));
        audio.buzz();
        life = 0.85;
        break;
      }
      case 'frostbolt': {
        const tx = (fx.tx ?? fx.x) - fx.x;
        const ty = (fx.ty ?? fx.y) - fx.y;
        g.moveTo(0, 0).lineTo(tx, ty).stroke({ color: 0xbdf0ff, width: 10, alpha: 0.9 });
        g.circle(tx, ty, 20).fill({ color: 0xdff6ff, alpha: 0.9 });
        audio.blip(0.4);
        life = 0.25;
        break;
      }
      case 'chill': {
        const flake = makeText('❄️', 34, { color: 0xffffff });
        e.addChild(flake);
        e.addBehavior(new Tween(e, { y: fx.y - 50, alpha: 0 }, 0.8, { ease: easings.outQuad }));
        if (fx.id === this.session.id) this.chilledUntil = this.t + MODS.CHILL_SECONDS;
        life = 0.85;
        break;
      }
      case 'roar': {
        const bd = BOSSES[fx.k ?? 0];
        const cry = makeText(`${bd?.emoji ?? '👹'} ${bd?.name ?? 'BOSS'}!`, 34, {
          color: 0xff5470,
          weight: '800',
        });
        cry.position.set(0, -120);
        e.addChild(cry);
        e.addBehavior(new Tween(e.scale, { x: 1.25, y: 1.25 }, 0.5, { ease: easings.outBack }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 1.1, { ease: easings.inQuad }));
        this.camera.shake(10, 0.3);
        audio.buzz();
        life = 1.15;
        break;
      }
      case 'hit': {
        const n = makeText(`-${fx.amount ?? 0}`, 30, { color: 0xffd166 });
        e.addChild(n);
        e.addBehavior(new Tween(e, { y: fx.y - 60, alpha: 0 }, 0.7, { ease: easings.outQuad }));
        audio.pop(1.3);
        life = 0.75;
        break;
      }
      case 'die': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 30, Math.sin(a) * 30, 8).fill(0x8fbf6b);
        }
        e.addBehavior(new Tween(e.scale, { x: 2, y: 2 }, 0.4, { ease: easings.outQuad }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.4, { ease: easings.outQuad }));
        audio.pop(0.6);
        this.killsSeen += 1;
        // Everyone in the party pockets the Verium from a kill.
        if (fx.coin && fx.coin > 0) {
          verium.add(fx.coin);
          this.veriumEarned += fx.coin;
          const coin = new Entity();
          coin.position.set(fx.x + 24, fx.y - 20);
          coin.addChild(makeText(`+${fx.coin} ⬡`, 24, { color: 0x9ad8ff, weight: '800' }));
          coin.addBehavior(
            new Tween(coin, { y: fx.y - 80, alpha: 0 }, 0.9, { ease: easings.outQuad }),
          );
          coin.addBehavior(new Timer(0.95, () => this.remove(coin)));
          this.add(coin, this.mapLayer);
        }
        life = 0.45;
        break;
      }
      case 'levelup': {
        const who = this.worldFor(fx.id);
        if (who) e.position.set(who.x, who.y);
        g.circle(0, 0, 70).stroke({ color: 0xffd166, width: 8 });
        const lu = makeText('LEVEL UP!', 26, { color: 0xffd166 });
        lu.position.set(0, -80);
        e.addChild(lu);
        e.addBehavior(new Tween(e.scale, { x: 1.6, y: 1.6 }, 0.6, { ease: easings.outBack }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.8, { ease: easings.inQuad }));
        audio.chime();
        life = 0.85;
        break;
      }
      case 'down': {
        const skull = makeText('💫', 40, { color: 0xffffff });
        e.addChild(skull);
        audio.buzz();
        if (fx.id === this.session.id) {
          this.downUntil = this.t + RESPAWN_SECONDS;
          const back = new Entity();
          back.addBehavior(
            new Timer(RESPAWN_SECONDS, () => {
              this.me.position.set(this.spawnPoint.x, this.spawnPoint.y);
            }),
          );
          this.add(back);
        }
        life = 1.2;
        break;
      }
    }
    e.addBehavior(new Timer(life, () => this.remove(e)));
    this.add(e, this.mapLayer);
  }

  /** Code-drawn menace: crown / ice shards / horns per boss kind. */
  private bossAdornment(kind: number, r: number): Graphics {
    const g = new Graphics();
    if (kind === 0) {
      // King Slime: golden crown + angry brows.
      g.poly([
        -r * 0.5,
        -r * 0.85,
        -r * 0.5,
        -r * 1.25,
        -r * 0.25,
        -r * 1.0,
        0,
        -r * 1.3,
        r * 0.25,
        -r * 1.0,
        r * 0.5,
        -r * 1.25,
        r * 0.5,
        -r * 0.85,
      ]).fill(0xffd166);
      g.moveTo(-r * 0.5, -r * 0.42)
        .lineTo(-r * 0.15, -r * 0.28)
        .moveTo(r * 0.5, -r * 0.42)
        .lineTo(r * 0.15, -r * 0.28)
        .stroke({ color: 0x2b2b33, width: Math.max(4, r * 0.09) });
    } else if (kind === 1) {
      // Frost Wraith: jagged ice shards jutting out of the body.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        g.poly([
          Math.cos(a) * r * 0.6,
          Math.sin(a) * r * 0.6,
          Math.cos(a + 0.22) * r * 0.6,
          Math.sin(a + 0.22) * r * 0.6,
          Math.cos(a + 0.11) * r * 1.25,
          Math.sin(a + 0.11) * r * 1.25,
        ]).fill({ color: 0xdff6ff, alpha: 0.85 });
      }
    } else {
      // Ember Titan: dark horns + glowing cracks.
      g.poly([-r * 0.55, -r * 0.7, -r * 0.95, -r * 1.3, -r * 0.25, -r * 0.85]).fill(0x3b2b2b);
      g.poly([r * 0.55, -r * 0.7, r * 0.95, -r * 1.3, r * 0.25, -r * 0.85]).fill(0x3b2b2b);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.9;
        g.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25)
          .lineTo(Math.cos(a + 0.35) * r * 0.75, Math.sin(a + 0.35) * r * 0.75)
          .stroke({ color: 0xffd166, width: Math.max(3, r * 0.07), alpha: 0.9 });
      }
    }
    return g;
  }

  private syncMobViews(mobs: Record<string, MobSnap>): void {
    for (const [id, m] of Object.entries(mobs)) {
      let v = this.mobViews.get(id);
      const isBoss = Number(id) === BOSS.ID;
      const bd = isBoss ? BOSSES[m.k ?? 0] : undefined;
      // Boss kind changed (next boss in the cycle) — rebuild the view.
      if (v && isBoss && v.kind !== (m.k ?? 0)) {
        this.remove(v.e);
        this.mobViews.delete(id);
        v = undefined;
      }
      const mv = MOB_VARIANTS[m.vr ?? 'melee'];
      if (!v) {
        const e = new Entity();
        const radius = bd ? 66 : mv.radius;
        const char = blobCharacter({
          radius,
          color: bd?.color ?? mv.color,
          seed: 100 + Number(id) + (m.k ?? 0),
          shadow: false,
        });
        if (bd) char.body.addChild(this.bossAdornment(m.k ?? 0, radius));
        e.addChild(char.view);
        e.addBehavior(
          new Wobble({ target: char.body, amount: 0.06, speed: 3.2, phase: Number(id) }),
        );
        if (bd) {
          const banner = makeText(`${bd.emoji} ${bd.name}`, 26, {
            color: 0xffd166,
            weight: '800',
          });
          banner.position.set(0, -radius * 2.1);
          e.addChild(banner);
        }
        const bar = new Graphics();
        bar.position.set(0, bd ? -102 : -44);
        e.addChild(bar);
        e.position.set(m.x, m.y);
        this.add(e, this.mapLayer);
        v = { e, bar, body: char.body, targetX: m.x, targetY: m.y, hp: m.hp, kind: m.k ?? 0 };
        this.mobViews.set(id, v);
      }
      v.targetX = m.x;
      v.targetY = m.y;
      v.hp = m.hp;
      // Tint by active status (frozen wins, then burn, poison, shock).
      v.body.tint = m.f ? 0x9adcff : m.b ? 0xffb08a : m.p ? 0xb6f28a : m.sh ? 0xfff08a : 0xffffff;
      const bw = isBoss ? 150 : 52;
      const bh = isBoss ? 12 : 7;
      v.bar.clear();
      v.bar.rect(-bw / 2, 0, bw, bh).fill({ color: 0x000000, alpha: 0.4 });
      v.bar.rect(-bw / 2, 0, bw * Math.max(0, m.hp / m.max), bh).fill(bd ? bd.color : 0xff5470);
    }
    for (const [id, v] of [...this.mobViews]) {
      if (!(id in mobs)) {
        this.remove(v.e);
        this.mobViews.delete(id);
      }
    }
  }

  private updateHud(): void {
    const st = this.stats[this.session.id];
    if (!st) return;
    this.hudText.text = `Lv ${st.lvl}   ${st.hp}/${st.max} HP   ${st.xp}/${xpForLevel(st.lvl)} XP   ⬡ ${verium.balance()}`;
    this.hpBar.clear();
    this.hpBar.rect(0, 0, 220, 10).fill({ color: 0x000000, alpha: 0.4 });
    this.hpBar.rect(0, 0, 220 * Math.max(0, st.hp / st.max), 10).fill(0x8affc1);
    this.myBar.clear();
    this.myBar.rect(-26, 0, 52, 6).fill({ color: 0x000000, alpha: 0.4 });
    this.myBar.rect(-26, 0, 52 * Math.max(0, st.hp / st.max), 6).fill(0x8affc1);
    this.updateParty();
  }

  /** One row per party member: mini portrait + name + live health bar. */
  private buildPartyPanel(): void {
    for (const old of this.partyPanel.removeChildren()) old.destroy({ children: true });
    this.partyRows.clear();
    this.roster.order.forEach((id, i) => {
      const cls = classById(this.roster.classes[id]);
      const row = new Container();
      row.position.set(0, i * 50);
      const char = blobCharacter({
        radius: 15,
        color: shadeFor(cls.color, this.roster.looks?.[id] ?? 2),
        seed: 5 + i,
        shadow: false,
      });
      char.view.position.set(16, 18);
      char.body.addChild(accessoryView(this.roster.accs?.[id], 15));
      row.addChild(char.view);
      const nameT = makeText('', 16, {
        color: id === this.session.id ? forestDeep.accent : forestDeep.ink,
        weight: '800',
      });
      nameT.anchor.set(0, 0.5);
      nameT.position.set(40, 8);
      row.addChild(nameT);
      const bar = new Graphics();
      bar.position.set(40, 24);
      row.addChild(bar);
      this.partyPanel.addChild(row);
      this.partyRows.set(id, { body: char.body, bar, nameT });
    });
  }

  private updateParty(): void {
    for (const [id, row] of this.partyRows) {
      const st = this.stats[id];
      const w = 132;
      row.bar.clear();
      row.bar.rect(0, 0, w, 8).fill({ color: 0x000000, alpha: 0.45 });
      if (st) {
        const down = st.hp <= 0;
        row.bar.rect(0, 0, w * Math.max(0, st.hp / st.max), 8).fill(down ? 0x8a8a9a : 0x8affc1);
        const label = `Lv${st.lvl} ${this.roster.names[id] ?? '?'}${down ? ' 💫' : ''}`;
        if (row.nameT.text !== label) row.nameT.text = label;
        row.body.alpha = down ? 0.4 : 1;
      }
    }
  }

  // -------------------------------------------------- upgrade cards (M3/M4)
  //
  // The offer is a small card docked to the left edge that you can collapse
  // to a pulsing tab and keep playing — level-ups no longer freeze the game.
  // Multiple pending level-ups queue up behind the tab (it shows the count).

  private showOffer(cards: string[]): void {
    this.offerQueue.push(cards.slice(0, 2));
    // First offer opens collapsed (subtle); keep whatever state we were in.
    this.renderOffer(this.upgradeOverlay?.expanded ?? false);
    audio.chime();
  }

  /** (Re)build the docked level-up card in collapsed or expanded form. */
  private renderOffer(expanded: boolean): void {
    this.tearDownOffer();
    const current = this.offerQueue[0];
    if (!current) return;
    const H = this.game.viewHeight;
    const root = new Entity();
    const count = this.offerQueue.length;
    const buttons: UIButton[] = [];

    // The always-visible tab: tap to toggle the cards open/closed.
    const tab = new UIButton(expanded ? `⬆ LEVEL UP  ▸` : `⬆${count > 1 ? ` ×${count}` : ''}`, {
      width: expanded ? 250 : 96,
      height: 64,
      fontSize: expanded ? 22 : 30,
      fill: 0xffd166,
      textColor: 0x1c2418,
      onTap: () => this.renderOffer(!expanded),
    });
    tab.position.set(expanded ? 145 : 68, 0);
    this.add(tab, root);
    buttons.push(tab);

    if (expanded) {
      const myClass = this.roster.classes[this.session.id] ?? 'knight';
      const panel = new Graphics();
      drawPanel(panel, 430, 90 + current.length * 78, {
        fill: 0x243a2a,
        stroke: forestDeep.ink,
        radius: 20,
      });
      panel.position.set(20, 44);
      root.addChild(panel);
      const hint = makeText('choose one', 20, { color: forestDeep.accent });
      hint.position.set(235, 70);
      root.addChild(hint);
      current.forEach((cardId, i) => {
        const btn = new UIButton(cardLabel(myClass, cardId), {
          width: 396,
          height: 66,
          fontSize: 21,
          fill: i === 0 ? 0xffd166 : 0x8affc1,
          textColor: 0x1c2418,
          onTap: () => this.pickUpgrade(cardId),
        });
        btn.position.set(235, 118 + i * 78);
        this.add(btn, root);
        buttons.push(btn);
      });
    }

    root.position.set(0, Math.max(120, H * 0.4));
    this.add(root, this.uiLayer);
    this.upgradeOverlay = { root, buttons, cards: current, expanded };
  }

  /** Remove the docked card's display objects without dropping the queue. */
  private tearDownOffer(): void {
    if (!this.upgradeOverlay) return;
    for (const b of this.upgradeOverlay.buttons) this.remove(b);
    this.remove(this.upgradeOverlay.root);
    this.upgradeOverlay = null;
  }

  private pickUpgrade(cardId: string): void {
    audio.blip(1.5);
    if (this.session.isHost) {
      this.applyUpgrade(this.session.id, cardId);
    } else {
      this.session.send({ type: 'upgrade', pick: cardId });
    }
    const wasExpanded = this.upgradeOverlay?.expanded ?? false;
    this.offerQueue.shift();
    this.tearDownOffer();
    if (this.offerQueue.length) this.renderOffer(wasExpanded);
  }

  /** Host-authoritative upgrade application. */
  private applyUpgrade(pid: string, pick: string): void {
    const st = this.stats[pid];
    if (!st) return;
    if (pick === 'dmg') st.dmgMul = (st.dmgMul ?? 1) * 1.2;
    else if (pick === 'hp') {
      st.max = Math.round(st.max * 1.25);
      st.hp = st.max;
    } else if (pick === 'cd') st.cdMul = (st.cdMul ?? 1) * 0.8;
    else if (!(st.mods ?? []).includes(pick)) {
      // A move-changing mod — owned once, resolved host-side on every cast.
      st.mods = [...(st.mods ?? []), pick];
    }
  }

  private rosterIdOf(r: RemotePlayer): string {
    for (const [id, rp] of this.remotes) if (rp === r) return id;
    return '';
  }
}
