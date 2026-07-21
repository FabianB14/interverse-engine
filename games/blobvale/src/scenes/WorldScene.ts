import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  Entity,
  Scene,
  Timer,
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
}

interface ChatMessage {
  type: 'chat';
  msg: number;
  id?: string;
}

type WorldMessage = PosMessage | SnapMessage | ChatMessage;

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

  constructor(
    private readonly session: Session,
    private readonly roster: RosterState,
  ) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;
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
    this.roster.order.forEach((id, i) => {
      if (id === session.id) return;
      const made = this.makeAdventurer(id, false);
      const e = made.entity;
      e.position.set(spawn.x + (i - 2) * 70, spawn.y + (i % 2) * 60);
      this.add(e, this.mapLayer);
      this.remotes.set(id, {
        entity: e,
        targetX: e.x,
        targetY: e.y,
        bubble: null,
        bubbleUntil: 0,
      });
      this.hostPositions[id] = { x: e.x, y: e.y };
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
    chatBtn.position.set(W - 110, H - 170);
    this.add(chatBtn, this.uiLayer);

    const hud = makeText(
      `${session.code}  ·  ${classById(this.roster.classes[session.id]).name}`,
      24,
      {
        color: forestDeep.inkSoft,
        weight: 'bold',
      },
    );
    hud.position.set(W / 2, 40);
    this.uiLayer.addChild(hud);

    this.statusText = makeText('', 30, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.statusText.position.set(W / 2, H / 2);
    this.uiLayer.addChild(this.statusText);

    window.__blobvale = {
      scene: () => 'world',
      code: () => session.code,
      playerCount: () => this.roster.order.length,
      myPos: () => ({ x: this.me.x, y: this.me.y }),
      remotePos: (id: string) => {
        const r = this.remotes.get(id);
        return r ? { x: r.entity.x, y: r.entity.y } : null;
      },
      remoteIds: () => [...this.remotes.keys()],
      snapsSeen: () => this.snapsSeen,
      chatsSeen: () => this.chatsSeen,
      sendChat: (i: number) => this.sendChat(i),
      joystickScreen: () => {
        const p = this.joystick.getGlobalPosition();
        return { x: p.x, y: p.y };
      },
    };

    session.onMessage((from, data) => this.onNet(from, data as WorldMessage));
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
    const W = this.game.designWidth;
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
    panel.position.set((W - 620) / 2, this.game.designHeight - 480);
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

    // Move me.
    const jx = this.joystick.value.x;
    const jy = this.joystick.value.y;
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
        const snap: SnapMessage = { type: 'snap', players: this.hostPositions };
        this.session.broadcast(snap);
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

  private rosterIdOf(r: RemotePlayer): string {
    for (const [id, rp] of this.remotes) if (rp === r) return id;
    return '';
  }
}
