import { Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent, Text } from 'pixi.js';
import {
  Entity,
  Scene,
  Timer,
  Tween,
  Wobble,
  audio,
  blobCharacter,
  easings,
  partyPop,
  pickColor,
} from '@interverse/engine';
import type { Session } from '@interverse/net';
import { makeText } from '../text.js';
import { MenuScene } from './MenuScene.js';

interface TapMessage {
  type: 'tap';
  x: number; // design-space coords — every phone shares the 720x1280 space
  y: number;
  id: string;
}

interface RosterMessage {
  type: 'roster';
  order: string[];
  names: Record<string, string>;
}

type PartyMessage = TapMessage | RosterMessage;

export class PartyScene extends Scene {
  private tapCount = 0;
  private order: string[] = [];
  private names: Record<string, string> = {};
  private countText!: Text;
  private rosterRow!: Entity;
  private statusText!: Text;

  constructor(private readonly session: Session) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;
    const session = this.session;

    window.__taps = {
      scene: () => 'party',
      code: () => session.code,
      playerCount: () => this.order.length,
      taps: () => this.tapCount,
    };

    const codeLabel = makeText('ROOM CODE', 26, { color: partyPop.inkSoft, weight: 'bold' });
    codeLabel.position.set(W / 2, 70);
    this.stage.addChild(codeLabel);

    const code = makeText(session.code, 96, { color: partyPop.accent, letterSpacing: 18 });
    code.position.set(W / 2, 140);
    this.stage.addChild(code);

    this.countText = makeText('', 30, { color: partyPop.ink, weight: 'bold' });
    this.countText.position.set(W / 2, 210);
    this.stage.addChild(this.countText);

    this.rosterRow = new Entity();
    this.rosterRow.position.set(W / 2, 290);
    this.add(this.rosterRow);

    const hint = makeText('tap anywhere — everyone sees it', 30, {
      color: partyPop.inkSoft,
      weight: 'bold',
    });
    hint.position.set(W / 2, H - 80);
    this.stage.addChild(hint);

    this.statusText = makeText('', 30, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.statusText.position.set(W / 2, H / 2);
    this.stage.addChild(this.statusText);

    // Whole screen is the tap surface.
    this.stage.eventMode = 'static';
    this.stage.hitArea = new Rectangle(0, 0, W, H);
    this.stage.on('pointerdown', (e: FederatedPointerEvent) => {
      const p = e.getLocalPosition(this.stage);
      this.localTap(p.x, p.y);
    });

    // Initial roster: host knows itself; joiners got the list on join.
    this.order = session.players.map((p) => p.id);
    for (const p of session.players) this.names[p.id] = p.name;
    this.refreshRoster();

    if (session.isHost) {
      session.onPlayerJoin((p) => {
        this.order.push(p.id);
        this.names[p.id] = p.name;
        this.shareRoster();
        this.refreshRoster();
        audio.chime();
      });
      session.onPlayerLeave((id) => {
        this.order = this.order.filter((x) => x !== id);
        this.shareRoster();
        this.refreshRoster();
      });
      session.onMessage((from, data) => {
        const msg = data as PartyMessage;
        if (msg?.type === 'tap') {
          // Host is authoritative: stamp the sender and fan out.
          const stamped: TapMessage = { type: 'tap', x: msg.x, y: msg.y, id: from };
          session.broadcast(stamped);
          this.spawnRipple(stamped);
        }
      });
    } else {
      session.onPlayerJoin((p) => {
        this.names[p.id] = p.name;
      });
      session.onMessage((_from, data) => {
        const msg = data as PartyMessage;
        if (msg?.type === 'roster') {
          this.order = msg.order;
          this.names = msg.names;
          this.refreshRoster();
        } else if (msg?.type === 'tap' && msg.id !== session.id) {
          this.spawnRipple(msg);
        }
      });
    }

    session.onClose((reason) => {
      this.statusText.text = `Disconnected: ${reason}\nreturning to menu…`;
      this.stage.eventMode = 'none';
      const back = new Entity();
      back.addBehavior(
        new Timer(2.2, () => {
          window.history.replaceState(null, '', window.location.pathname);
          this.game.scenes.replace(new MenuScene());
        }),
      );
      this.add(back);
    });
  }

  protected override onExit(): void {
    delete window.__taps;
  }

  private colorFor(id: string): number {
    const i = this.order.indexOf(id);
    if (i < 0) return 0xffffff;
    return partyPop.colors[i % partyPop.colors.length] ?? pickColor(partyPop.colors);
  }

  private localTap(x: number, y: number): void {
    if (y < 340) return; // keep the header area tap-free
    const msg: TapMessage = { type: 'tap', x, y, id: this.session.id };
    this.spawnRipple(msg);
    if (this.session.isHost) {
      this.session.broadcast(msg);
    } else {
      this.session.send({ type: 'tap', x, y });
    }
  }

  private spawnRipple(msg: TapMessage): void {
    this.tapCount += 1;
    const color = this.colorFor(msg.id);
    audio.pop(0.9 + Math.random() * 0.4);

    // Expanding ring.
    const ring = new Entity();
    const g = new Graphics().circle(0, 0, 30).stroke({ color, width: 8 });
    ring.addChild(g);
    ring.position.set(msg.x, msg.y);
    ring.addBehavior(new Tween(ring.scale, { x: 3.2, y: 3.2 }, 0.5, { ease: easings.outCubic }));
    ring.addBehavior(new Tween(ring, { alpha: 0 }, 0.5, { ease: easings.outQuad }));
    ring.addBehavior(new Timer(0.55, () => this.remove(ring)));
    this.add(ring);

    // A little blob that pops in and fades.
    const blob = new Entity();
    const char = blobCharacter({
      radius: 34,
      color,
      seed: 1 + Math.floor(Math.random() * 999),
      shadow: false,
    });
    blob.addChild(char.view);
    blob.position.set(msg.x, msg.y);
    blob.scale.set(0.01);
    blob.addBehavior(new Tween(blob.scale, { x: 1, y: 1 }, 0.3, { ease: easings.outBack }));
    blob.addBehavior(new Tween(blob, { alpha: 0 }, 0.4, { ease: easings.inQuad, delay: 0.45 }));
    blob.addBehavior(new Timer(0.9, () => this.remove(blob)));
    this.add(blob);
  }

  private shareRoster(): void {
    const msg: RosterMessage = { type: 'roster', order: this.order, names: this.names };
    this.session.broadcast(msg);
  }

  private refreshRoster(): void {
    this.countText.text = `${this.order.length} player${this.order.length === 1 ? '' : 's'} in the room`;
    for (const old of this.rosterRow.removeChildren()) old.destroy({ children: true });
    const chipGap = 96;
    const total = (this.order.length - 1) * chipGap;
    this.order.forEach((id, i) => {
      const chip = new Entity();
      const char = blobCharacter({
        radius: 32,
        color: this.colorFor(id),
        seed: 3 + i,
        shadow: false,
      });
      chip.addChild(char.view);
      chip.addBehavior(new Wobble({ target: char.body, amount: 0.05, speed: 2 + i * 0.3 }));
      chip.position.set(-total / 2 + i * chipGap, 0);
      const name = makeText(this.names[id] ?? '?', 20, {
        color: partyPop.inkSoft,
        weight: 'bold',
      });
      name.position.set(0, 52);
      chip.addChild(name);
      this.rosterRow.addChild(chip);
      // Chips are children of rosterRow (not scene entities) — tick their
      // wobble from the row so they stay animated.
      chip.update(0);
    });
  }

  protected override onUpdate(dt: number): void {
    for (const chip of this.rosterRow.children) {
      if (chip instanceof Entity) chip.update(dt);
    }
  }
}
