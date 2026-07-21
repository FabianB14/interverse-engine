import { Container, Graphics } from 'pixi.js';
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
import { classById } from '../classes.js';
import {
  ABILITIES,
  BOSS,
  CLERIC_HEAL,
  MOB,
  RESPAWN_SECONDS,
  damageAtLevel,
  maxHpAtLevel,
  xpForLevel,
} from '../combat.js';
import type { MobState } from '../combat.js';
import { TILE_SIZE, valeLegend, valePainters, valeRows } from '../map.js';
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

interface SnapMessage {
  type: 'snap';
  players: Record<string, { x: number; y: number }>;
  mobs?: Record<string, { x: number; y: number; hp: number; max: number }>;
  stats?: Record<string, { hp: number; max: number; lvl: number; xp: number }>;
}

interface CastMessage {
  type: 'cast';
}

interface FxMessage {
  type: 'fx';
  kind: 'slash' | 'arrow' | 'fire' | 'heal' | 'dash' | 'hit' | 'die' | 'levelup' | 'down';
  x: number;
  y: number;
  id?: string;
  amount?: number;
  tx?: number;
  ty?: number;
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
}

interface ClassMsg {
  type: 'class';
  cls: string;
}

type WorldMessage =
  PosMessage | SnapMessage | ChatMessage | RosterMsg | ClassMsg | CastMessage | FxMessage;

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
  private mobRespawns: { at: number; homeX: number; homeY: number; boss?: boolean }[] = [];
  private stats: Record<string, { hp: number; max: number; lvl: number; xp: number }> = {};
  private mobViews = new Map<
    string,
    { e: Entity; bar: Graphics; body: Container; targetX: number; targetY: number; hp: number }
  >();
  private cooldownLeft = 0;
  private castBtn!: UIButton;
  private downUntil = 0;
  private hudText!: Text;
  private hpBar!: Graphics;
  private myBar!: Graphics;
  private nextMobId = 1;
  private killsSeen = 0;
  private chatBtnRef: UIButton | null = null;
  private codeHud: Text | null = null;

  protected override onResize(w: number, h: number): void {
    this.layoutUi(w, h);
  }

  private layoutUi(W: number, H: number): void {
    this.joystick.position.set(170, H - 190);
    this.chatBtnRef?.position.set(W - 110, H - 290);
    this.castBtn.position.set(W - 120, H - 130);
    this.codeHud?.position.set(W / 2, 40);
    this.statusText.position.set(W / 2, H / 2);
    this.camera.setViewSize(W, H);
    if (this.chatOpen) this.closeChat();
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
    this.mapLayer.addChild(buildTileMapView(this.map, valePainters));

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

    for (const id of this.roster.order) {
      this.stats[id] = { hp: maxHpAtLevel(1), max: maxHpAtLevel(1), lvl: 1, xp: 0 };
    }
    if (session.isHost) {
      for (const camp of this.map.objects.filter((o) => o.name === 'camp')) {
        for (let i = 0; i < MOB.PER_CAMP; i++) this.hostSpawnMob(camp.x, camp.y);
      }
      const lair = this.map.objects.find((o) => o.name === 'boss');
      if (lair) this.hostSpawnBoss(lair.x, lair.y + 60);
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
      bossHp: () => {
        if (this.session.isHost) return this.hostMobs.get(BOSS.ID)?.hp ?? null;
        const v = this.mobViews.get(String(BOSS.ID));
        return v ? v.hp : null;
      },
      warp: (x: number, y: number) => this.me.position.set(x, y),
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
      color: cls.color,
      seed: 5 + this.roster.order.indexOf(id),
      strokeWidth: isMe ? 5 : 3,
    });
    char.body.addChild(cls.accessory(30));
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
      if (msg.mobs) this.syncMobViews(msg.mobs);
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
      this.spawnRemote(from, this.roster.order.indexOf(from));
      this.session.broadcast({ type: 'roster', ...this.roster });
      this.session.sendTo(from, { type: 'start', roster: this.roster });
      return;
    }
    if (msg?.type === 'roster' && !this.session.isHost) {
      msg.order.forEach((id, i) => {
        this.roster.names[id] = msg.names[id] ?? '?';
        const newCls = msg.classes[id];
        const clsChanged = newCls !== undefined && this.roster.classes[id] !== newCls;
        if (newCls !== undefined) this.roster.classes[id] = newCls;
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
    audio.blip(1.4);
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
    audio.blip(0.9);
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
      const moved = moveWithCollision(
        this.map,
        this.me.x,
        this.me.y,
        20,
        14,
        jx * cls.speed * dt,
        jy * cls.speed * dt,
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
          mobs[String(m.id)] = { x: m.x, y: m.y, hp: m.hp, max: m.max };
        }
        const snap: SnapMessage = {
          type: 'snap',
          players: this.hostPositions,
          mobs,
          stats: this.stats,
        };
        this.session.broadcast(snap);
        this.syncMobViews(mobs);
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
    this.cooldownLeft = def.cooldown;
    audio.blip(1.6);
    if (this.session.isHost) {
      this.resolveCast(this.session.id);
    } else {
      this.session.send({ type: 'cast' });
    }
  }

  private hostSpawnMob(homeX: number, homeY: number): void {
    const id = this.nextMobId++;
    this.hostMobs.set(id, {
      id,
      x: homeX + (Math.random() * 2 - 1) * 60,
      y: homeY + (Math.random() * 2 - 1) * 60,
      hp: MOB.MAX_HP,
      max: MOB.MAX_HP,
      homeX,
      homeY,
      target: null,
      attackIn: 0,
    });
  }

  private bossEnraged = false;

  private hostSpawnBoss(x: number, y: number): void {
    this.bossEnraged = false;
    this.hostMobs.set(BOSS.ID, {
      id: BOSS.ID,
      x,
      y,
      hp: BOSS.MAX_HP,
      max: BOSS.MAX_HP,
      homeX: x,
      homeY: y,
      target: null,
      attackIn: 0,
    });
  }

  private hostSimMobs(dt: number): void {
    for (const m of this.hostMobs.values()) {
      const isBoss = m.id === BOSS.ID;
      const speed = isBoss ? (this.bossEnraged ? BOSS.ENRAGED_SPEED : BOSS.SPEED) : MOB.SPEED;
      const atkRange = isBoss ? BOSS.ATTACK_RANGE : MOB.ATTACK_RANGE;
      const atkDmg = isBoss ? BOSS.ATTACK_DAMAGE : MOB.ATTACK_DAMAGE;
      const atkEvery = isBoss
        ? this.bossEnraged
          ? BOSS.ENRAGED_EVERY
          : BOSS.ATTACK_EVERY
        : MOB.ATTACK_EVERY;
      // Acquire/drop target.
      let best: string | null = null;
      let bestD = isBoss ? BOSS.AGGRO_RANGE : MOB.AGGRO_RANGE;
      for (const [pid, p] of Object.entries(this.hostPositions)) {
        if ((this.stats[pid]?.hp ?? 0) <= 0) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (d < bestD) {
          best = pid;
          bestD = d;
        }
      }
      if (Math.hypot(m.x - m.homeX, m.y - m.homeY) > MOB.LEASH_RANGE) best = null;
      m.target = best;

      const goal = best
        ? this.hostPositions[best]
        : {
            x: m.homeX + Math.sin(this.t * 0.7 + m.id) * 50,
            y: m.homeY + Math.cos(this.t * 0.5 + m.id) * 50,
          };
      if (goal) {
        const d = Math.hypot(goal.x - m.x, goal.y - m.y);
        const stop = best ? atkRange * 0.8 : 6;
        if (d > stop) {
          const moved = moveWithCollision(
            this.map,
            m.x,
            m.y,
            18,
            14,
            ((goal.x - m.x) / d) * speed * dt,
            ((goal.y - m.y) / d) * speed * dt,
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
          const st = this.stats[best];
          if (st && st.hp > 0) {
            st.hp = Math.max(0, st.hp - atkDmg);
            this.broadcastFx({
              type: 'fx',
              kind: 'hit',
              x: p.x,
              y: p.y,
              amount: atkDmg,
            });
            if (st.hp <= 0) {
              this.broadcastFx({ type: 'fx', kind: 'down', x: p.x, y: p.y, id: best });
              const downedId = best;
              const revive = new Entity();
              revive.addBehavior(
                new Timer(RESPAWN_SECONDS, () => {
                  const rst = this.stats[downedId];
                  if (rst) rst.hp = rst.max;
                }),
              );
              this.add(revive);
            }
          }
        }
      }
    }
    // Respawns.
    const now = this.t;
    this.mobRespawns = this.mobRespawns.filter((r) => {
      if (now >= r.at) {
        if (r.boss) this.hostSpawnBoss(r.homeX, r.homeY);
        else this.hostSpawnMob(r.homeX, r.homeY);
        return false;
      }
      return true;
    });
  }

  private resolveCast(casterId: string): void {
    const def = ABILITIES[this.roster.classes[casterId] ?? 'knight'];
    const caster = casterId === this.session.id ? this.me : this.hostPositions[casterId];
    const st = this.stats[casterId];
    if (!def || !caster || !st || st.hp <= 0) return;
    const dmg = damageAtLevel(def.damage, st.lvl);

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
    if (!def.heals) {
      this.broadcastFx({
        type: 'fx',
        kind: def.fx,
        x: caster.x,
        y: caster.y,
        tx: target?.x ?? caster.x,
        ty: target?.y ?? caster.y - 60,
      });
    }
    if (!target) return;

    const victims =
      def.splash > 0
        ? [...this.hostMobs.values()].filter(
            (m) => Math.hypot(m.x - target.x, m.y - target.y) <= def.splash,
          )
        : [target];
    for (const m of victims) {
      m.hp -= dmg;
      this.broadcastFx({ type: 'fx', kind: 'hit', x: m.x, y: m.y - 30, amount: dmg });
      if (m.id === BOSS.ID && !this.bossEnraged && m.hp <= m.max / 2 && m.hp > 0) {
        // Phase 2: the boss speeds up and calls two minions.
        this.bossEnraged = true;
        for (let i = 0; i < BOSS.MINIONS_ON_ENRAGE; i++) this.hostSpawnMob(m.x, m.y);
        this.broadcastFx({ type: 'fx', kind: 'levelup', x: m.x, y: m.y });
      }
      if (m.hp <= 0) {
        this.hostMobs.delete(m.id);
        const isBoss = m.id === BOSS.ID;
        this.mobRespawns.push({
          at: this.t + (isBoss ? BOSS.RESPAWN_SECONDS : MOB.RESPAWN_SECONDS),
          homeX: m.homeX,
          homeY: m.homeY,
          ...(isBoss ? { boss: true } : {}),
        });
        this.broadcastFx({ type: 'fx', kind: 'die', x: m.x, y: m.y });
        this.hostGrantXp(m.x, m.y, isBoss ? BOSS.XP : MOB.XP_PER_KILL);
      }
    }
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
      case 'hit': {
        const n = makeText(`-${fx.amount ?? 0}`, 30, { color: 0xffd166 });
        e.addChild(n);
        e.addBehavior(new Tween(e, { y: fx.y - 60, alpha: 0 }, 0.7, { ease: easings.outQuad }));
        audio.pop(1.3);
        life = 0.75;
        break;
      }
      case 'die':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.circle(Math.cos(a) * 30, Math.sin(a) * 30, 8).fill(0x8fbf6b);
        }
        e.addBehavior(new Tween(e.scale, { x: 2, y: 2 }, 0.4, { ease: easings.outQuad }));
        e.addBehavior(new Tween(e, { alpha: 0 }, 0.4, { ease: easings.outQuad }));
        audio.pop(0.6);
        this.killsSeen += 1;
        life = 0.45;
        break;
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

  private syncMobViews(
    mobs: Record<string, { x: number; y: number; hp: number; max: number }>,
  ): void {
    for (const [id, m] of Object.entries(mobs)) {
      let v = this.mobViews.get(id);
      if (!v) {
        const e = new Entity();
        const char = blobCharacter({
          radius: 26,
          color: 0x8fbf6b,
          seed: 100 + Number(id),
          shadow: false,
        });
        e.addChild(char.view);
        e.addBehavior(
          new Wobble({ target: char.body, amount: 0.06, speed: 3.2, phase: Number(id) }),
        );
        const bar = new Graphics();
        bar.position.set(0, Number(id) === BOSS.ID ? -92 : -44);
        e.addChild(bar);
        e.position.set(m.x, m.y);
        this.add(e, this.mapLayer);
        v = { e, bar, body: char.body, targetX: m.x, targetY: m.y, hp: m.hp };
        this.mobViews.set(id, v);
      }
      v.targetX = m.x;
      v.targetY = m.y;
      v.hp = m.hp;
      const bw = Number(id) === BOSS.ID ? 130 : 52;
      v.bar.clear();
      v.bar
        .rect(-bw / 2, 0, bw, Number(id) === BOSS.ID ? 12 : 7)
        .fill({ color: 0x000000, alpha: 0.4 });
      v.bar
        .rect(-bw / 2, 0, bw * Math.max(0, m.hp / m.max), Number(id) === BOSS.ID ? 12 : 7)
        .fill(Number(id) === BOSS.ID ? 0xc77dff : 0xff5470);
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
    this.hudText.text = `Lv ${st.lvl}   ${st.hp}/${st.max} HP   ${st.xp}/${xpForLevel(st.lvl)} XP`;
    this.hpBar.clear();
    this.hpBar.rect(0, 0, 220, 10).fill({ color: 0x000000, alpha: 0.4 });
    this.hpBar.rect(0, 0, 220 * Math.max(0, st.hp / st.max), 10).fill(0x8affc1);
    this.myBar.clear();
    this.myBar.rect(-26, 0, 52, 6).fill({ color: 0x000000, alpha: 0.4 });
    this.myBar.rect(-26, 0, 52 * Math.max(0, st.hp / st.max), 6).fill(0x8affc1);
  }

  private rosterIdOf(r: RemotePlayer): string {
    for (const [id, rp] of this.remotes) if (rp === r) return id;
    return '';
  }
}
