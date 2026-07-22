import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  Entity,
  Scene,
  Timer,
  Tween,
  VirtualJoystick,
  audio,
  buildTileMapView,
  darken,
  easings,
  moveWithCollision,
  tileMapFromRows,
  verium,
} from '@interverse/engine';
import type { Session } from '@interverse/net';
import type { TileMapData } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { CROPS, RARITY, cropById } from '../crops.js';
import { invAdd, invAll, invCount, invRemove, invTotal } from '../inventory.js';
import { makeCharacter } from '../character.js';
import type { CharType } from '../character.js';
import { savedAcc, savedName, savedSkin, store } from '../store.js';
import { TILE_SIZE, farmLegend, farmPainters, farmRows } from '../map.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

const PLAYER_SPEED = 250;
const SEND_INTERVAL = 0.1; // 10Hz position sync
const TRADE_RANGE = 200;

interface Remote {
  entity: Entity;
  body: Container;
  label: Text;
  tx: number;
  ty: number;
  host: boolean;
  walk: number;
}

interface PlotSnap {
  c: string | null;
  g: number;
}

/** Item map cropId -> count. */
type Offer = Record<string, number>;

/**
 * A shared farm visit: friends walk around one farm together and trade crops.
 * Host-authoritative — joiners send their position to the host, the host
 * broadcasts everyone's positions. Trades are always between a visitor and the
 * host (the farm's owner), settled by the host.
 */
export class VisitScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private uiLayer!: Container;
  private camera!: Camera;
  private joystick!: VirtualJoystick;
  private player!: Entity;
  private playerBody!: Container;
  private facing = 1;
  private walkPhase = 0;

  private remotes = new Map<string, Remote>();
  private names: Record<string, string> = {};
  private positions: Record<string, { x: number; y: number }> = {};
  private plotViews: { root: Entity; gfx: Graphics; label: Text; x: number; y: number }[] = [];
  private plotObjs: { x: number; y: number }[] = [];

  private veriumText!: Text;
  private basketText!: Text;
  private codeText!: Text;
  private toastText!: Text;
  private homeBtn!: UIButton;
  private tradeBtn!: UIButton;

  // Trade state
  private tradePartner: string | null = null;
  private myOffer: Offer = {};
  private theirOffer: Offer = {};
  private iConfirmed = false;
  private theyConfirmed = false;
  private tradePanel!: Container;
  private tradeGrid!: Container;
  private theirText!: Text;
  private confirmBtn!: UIButton;

  private sendIn = 0;
  private leaving = false;
  private W = 720;
  private H = 1280;

  constructor(private readonly session: Session) {
    super();
  }

  protected override onResize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.layout();
  }

  protected override onEnter(): void {
    this.W = this.game.viewWidth;
    this.H = this.game.viewHeight;
    const session = this.session;

    this.map = tileMapFromRows(farmRows, TILE_SIZE, farmLegend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.mapLayer.addChild(buildTileMapView(this.map, farmPainters));

    // Plots (decorative here; the host fills them from a snapshot).
    this.plotObjs = this.map.objects
      .filter((o) => o.name === 'plot')
      .map((o) => ({ x: o.x, y: o.y }));
    for (const o of this.plotObjs) {
      const root = new Entity();
      root.position.set(o.x, o.y);
      const gfx = new Graphics();
      const label = makeText('', 30);
      root.addChild(gfx, label);
      this.add(root, this.mapLayer);
      this.plotViews.push({ root, gfx, label, x: o.x, y: o.y });
    }
    this.renderPlots(this.hostPlotSnapshot());

    // Local player.
    const spawn = this.map.objects.find((o) => o.name === 'player') ?? { x: 544, y: 672 };
    const charType = store.get<CharType>('charType', 'blob');
    const charColor = store.get<number>('charColor', 0xe07a5f);
    this.player = new Entity();
    const pChar = makeCharacter(charType, charColor, 30, 5, savedAcc(), savedSkin());
    this.playerBody = pChar.body;
    this.player.addChild(pChar.view);
    this.player.position.set(spawn.x + (session.isHost ? 0 : 70), spawn.y);
    this.add(this.player, this.mapLayer);
    this.names[session.id] = savedName() ?? (session.isHost ? 'Host' : 'Visitor');

    this.camera = new Camera(this.mapLayer, this.W, this.H, {
      deadzoneWidth: 140,
      deadzoneHeight: 180,
    });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.player);

    // Seed the roster we already know about.
    for (const p of session.players) {
      this.names[p.id] = p.name;
      if (p.id !== session.id) this.spawnRemote(p.id, p.isHost);
    }

    this.buildHud();
    this.buildTradePanel();
    this.layout();

    // Net wiring.
    session.onPlayerJoin((p) => {
      this.names[p.id] = p.name;
      this.spawnRemote(p.id, p.isHost);
      if (session.isHost) {
        session.sendTo(p.id, { type: 'plots', plots: this.hostPlotSnapshot() });
        this.toast(`${p.name} dropped by! 👋`);
      }
    });
    session.onPlayerLeave((id) => {
      const r = this.remotes.get(id);
      if (r) {
        this.remove(r.entity);
        this.remotes.delete(id);
      }
      delete this.positions[id];
      if (this.tradePartner === id) this.closeTrade();
    });
    session.onMessage((from, data) => this.onNet(from, data));
    session.onClose((reason) => {
      if (this.leaving) return;
      this.toast(`disconnected: ${reason}`);
      const back = new Entity();
      back.addBehavior(new Timer(2, () => this.goTitle()));
      this.add(back, this.uiLayer);
    });

    window.__farm = {
      scene: () => 'visit',
      code: () => this.session.code,
      verium: () => verium.balance(),
      inv: () => invAll(),
      giveItem: (id: string, n: number) => {
        invAdd(id, n);
        this.updateBasket();
      },
      player: () => ({ x: this.player.x, y: this.player.y }),
      teleport: (x: number, y: number) => this.player.position.set(x, y),
      remoteIds: () => [...this.remotes.keys()],
      startTrade: () => this.startTrade(),
      offerItem: (id: string) => this.toggleOfferItem(id),
      confirmTrade: () => this.confirmTrade(),
      tradeOpen: () => this.tradePartner !== null,
      home: () => this.goTitle(),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  // ------------------------------------------------------------- HUD

  private buildHud(): void {
    this.joystick = new VirtualJoystick({
      radius: 90,
      dynamic: true,
      hitWidth: this.W,
      hitHeight: this.H,
    });
    this.joystick.position.set(this.W / 2, this.H / 2);
    this.add(this.joystick, this.uiLayer);

    this.veriumText = makeText('', 28, { color: FARM.coin, weight: '900' });
    this.veriumText.anchor.set(0, 0.5);
    this.basketText = makeText('', 22, { color: FARM.ink, weight: '800' });
    this.basketText.anchor.set(0, 0.5);
    this.codeText = makeText('', 24, { color: FARM.accent, weight: '900' });
    this.toastText = makeText('', 26, { color: FARM.accent, weight: '900' });
    this.uiLayer.addChild(this.veriumText, this.basketText, this.codeText, this.toastText);

    this.homeBtn = new UIButton('🏠', {
      width: 76,
      height: 76,
      fontSize: 34,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.goTitle(),
    });
    this.add(this.homeBtn, this.uiLayer);

    this.tradeBtn = new UIButton('🤝 Trade', {
      width: 200,
      height: 88,
      fontSize: 28,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.startTrade(),
    });
    this.tradeBtn.alpha = 0.4;
    this.add(this.tradeBtn, this.uiLayer);

    this.updateVerium();
    this.updateBasket();
    this.codeText.text = `farm ${this.session.code}`;
  }

  private layout(): void {
    if (this.camera) this.camera.setViewSize(this.W, this.H);
    this.joystick?.position.set(this.W / 2, this.H / 2);
    this.joystick?.setHitSize(this.W, this.H);
    this.homeBtn?.position.set(52, 48);
    this.veriumText?.position.set(100, 40);
    this.basketText?.position.set(100, 74);
    this.codeText?.position.set(this.W / 2, 40);
    this.toastText?.position.set(this.W / 2, 108);
    this.tradeBtn?.position.set(this.W - 130, this.H - 120);
    this.tradePanel?.position.set(this.W / 2, this.H / 2);
  }

  // ------------------------------------------------------------- plots

  private hostPlotSnapshot(): PlotSnap[] {
    const saved = store.get<{ c: string | null; g: number; m: number }[] | null>('plots', null);
    const src = saved ?? [];
    return this.plotObjs.map((_, i) => {
      const p = src[i];
      return { c: p?.c ?? null, g: typeof p?.g === 'number' ? p.g : 0 };
    });
  }

  private renderPlots(snap: PlotSnap[]): void {
    this.plotViews.forEach((v, i) => {
      const p = snap[i];
      v.gfx.clear();
      const s = 58;
      const planted = !!p?.c;
      const base = planted ? FARM.soilWet : FARM.soilDark;
      v.gfx.roundRect(-s / 2, -s / 2, s, s, 12).fill({ color: base, alpha: 0.9 });
      v.gfx.roundRect(-s / 2, -s / 2, s, s, 12).stroke({ color: darken(base, 0.3), width: 2 });
      const crop = cropById(p?.c);
      if (crop && (p?.g ?? 0) >= 1) v.label.text = crop.emoji ?? '🌾';
      else if (crop) v.label.text = '🌱';
      else v.label.text = '';
    });
  }

  // ------------------------------------------------------------- remotes

  private spawnRemote(id: string, host: boolean): void {
    if (this.remotes.has(id) || id === this.session.id) return;
    const entity = new Entity();
    const char = makeCharacter(
      host ? 'person' : 'blob',
      host ? 0xe07a5f : 0x6fb0d8,
      30,
      id.length + 3,
    );
    entity.addChild(char.view);
    const spawn = this.map.objects.find((o) => o.name === 'player') ?? { x: 544, y: 672 };
    entity.position.set(spawn.x, spawn.y);
    const label = makeText(this.names[id] ?? '?', 18, { color: FARM.ink, weight: '800' });
    label.position.set(0, -58);
    entity.addChild(label);
    this.add(entity, this.mapLayer);
    this.remotes.set(id, {
      entity,
      body: char.body,
      label,
      tx: spawn.x,
      ty: spawn.y,
      host,
      walk: 0,
    });
  }

  // ------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    // Movement.
    const jx = this.joystick.value.x;
    const jy = this.joystick.value.y;
    if (Math.hypot(jx, jy) > 0.12) {
      const moved = moveWithCollision(
        this.map,
        this.player.x,
        this.player.y,
        20,
        16,
        jx * PLAYER_SPEED * dt,
        jy * PLAYER_SPEED * dt,
      );
      this.player.position.set(moved.x, moved.y);
      if (Math.abs(jx) > 0.3) this.facing = jx > 0 ? 1 : -1;
      this.player.scale.x = this.facing;
      this.walkPhase += dt * 11;
      const sc = Math.sin(this.walkPhase) * 0.08;
      this.playerBody.scale.set(1 + sc, 1 - sc);
    } else {
      this.playerBody.scale.set(1, 1);
    }

    // Position sync.
    this.sendIn -= dt;
    if (this.sendIn <= 0) {
      this.sendIn = SEND_INTERVAL;
      this.positions[this.session.id] = { x: this.player.x, y: this.player.y };
      if (this.session.isHost) {
        this.session.broadcast({ type: 'snap', pos: this.positions });
      } else {
        this.session.send({ type: 'pos', x: this.player.x, y: this.player.y });
      }
    }

    // Interpolate remotes toward their targets.
    for (const r of this.remotes.values()) {
      const dx = r.tx - r.entity.x;
      const dy = r.ty - r.entity.y;
      r.entity.position.set(
        r.entity.x + dx * Math.min(1, dt * 12),
        r.entity.y + dy * Math.min(1, dt * 12),
      );
      if (Math.hypot(dx, dy) > 1) {
        r.walk += dt * 11;
        const sc = Math.sin(r.walk) * 0.08;
        r.body.scale.set(1 + sc, 1 - sc);
      } else r.body.scale.set(1, 1);
    }

    this.updateTradeButton();
    this.camera.update(dt);
  }

  /** Enable the Trade button when an eligible partner is close by. */
  private updateTradeButton(): void {
    if (this.tradePartner) {
      this.tradeBtn.alpha = 1;
      return;
    }
    const partner = this.nearestPartner();
    this.tradeBtn.alpha = partner ? 1 : 0.4;
  }

  /** The nearest tradeable remote in range: host trades with visitors, and
   *  visitors trade with the host. */
  private nearestPartner(): string | null {
    let best: string | null = null;
    let bestD = TRADE_RANGE;
    for (const [id, r] of this.remotes) {
      const eligible = this.session.isHost ? !r.host : r.host;
      if (!eligible) continue;
      const d = Math.hypot(r.entity.x - this.player.x, r.entity.y - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- net

  private onNet(from: string, data: unknown): void {
    const msg = data as Record<string, unknown> | null;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'pos': {
        if (!this.session.isHost) return;
        this.positions[from] = { x: Number(msg.x), y: Number(msg.y) };
        const r = this.remotes.get(from);
        if (r) {
          r.tx = Number(msg.x);
          r.ty = Number(msg.y);
        }
        return;
      }
      case 'snap': {
        const pos = msg.pos as Record<string, { x: number; y: number }>;
        for (const [id, p] of Object.entries(pos)) {
          if (id === this.session.id) continue;
          const r = this.remotes.get(id);
          if (r) {
            r.tx = p.x;
            r.ty = p.y;
          }
        }
        return;
      }
      case 'plots': {
        this.renderPlots(msg.plots as PlotSnap[]);
        return;
      }
      case 'trade-req': {
        // Someone wants to trade with us.
        if (this.tradePartner) return;
        this.openTradeWith(from);
        this.toast('trade started 🤝');
        return;
      }
      case 'trade-offer': {
        if (from !== this.tradePartner) return;
        this.theirOffer = (msg.items as Offer) ?? {};
        this.theyConfirmed = false;
        this.refreshTradePanel();
        return;
      }
      case 'trade-confirm': {
        if (from !== this.tradePartner) return;
        this.theyConfirmed = true;
        this.refreshTradePanel();
        this.trySettle();
        return;
      }
      case 'trade-cancel': {
        if (from !== this.tradePartner) return;
        this.toast('trade cancelled');
        this.closeTrade();
        return;
      }
      case 'trade-exec': {
        // Host settled the trade — apply the swap to our inventory.
        this.applySwap((msg.give as Offer) ?? {}, (msg.get as Offer) ?? {});
        this.toast('trade complete! ✅');
        this.closeTrade();
        return;
      }
      default:
        return;
    }
  }

  // ------------------------------------------------------------- trade

  private startTrade(): void {
    if (this.tradePartner) return;
    const partner = this.nearestPartner();
    if (!partner) {
      this.toast('walk up to someone to trade');
      audio.buzz();
      return;
    }
    this.sendToPartner(partner, { type: 'trade-req' });
    this.openTradeWith(partner);
    this.toast('trade started 🤝');
  }

  private openTradeWith(id: string): void {
    this.tradePartner = id;
    this.myOffer = {};
    this.theirOffer = {};
    this.iConfirmed = false;
    this.theyConfirmed = false;
    this.tradePanel.visible = true;
    this.refreshTradePanel();
    audio.blip(1.2);
  }

  private toggleOfferItem(id: string): void {
    if (!this.tradePartner || this.iConfirmed) return;
    const have = invCount(id);
    const cur = this.myOffer[id] ?? 0;
    if (cur < have) this.myOffer[id] = cur + 1;
    else delete this.myOffer[id];
    this.sendToPartner(this.tradePartner, { type: 'trade-offer', items: this.myOffer });
    this.refreshTradePanel();
    audio.blip();
  }

  private confirmTrade(): void {
    if (!this.tradePartner || this.iConfirmed) return;
    this.iConfirmed = true;
    this.sendToPartner(this.tradePartner, { type: 'trade-confirm' });
    this.refreshTradePanel();
    this.trySettle();
  }

  /** The host settles once both sides have confirmed. */
  private trySettle(): void {
    if (!this.session.isHost || !this.tradePartner) return;
    if (!this.iConfirmed || !this.theyConfirmed) return;
    // Validate both inventories can cover their offers.
    for (const [id, n] of Object.entries(this.myOffer))
      if (invCount(id) < n) return this.abortTrade();
    // (Visitor offer is trusted; the visitor validates its own on apply.)
    const partner = this.tradePartner;
    this.session.sendTo(partner, { type: 'trade-exec', give: this.theirOffer, get: this.myOffer });
    this.applySwap(this.myOffer, this.theirOffer);
    this.toast('trade complete! ✅');
    this.closeTrade();
  }

  private abortTrade(): void {
    if (this.tradePartner) this.sendToPartner(this.tradePartner, { type: 'trade-cancel' });
    this.toast('trade failed — not enough crops');
    audio.buzz();
    this.closeTrade();
  }

  /** Remove what we gave, add what we got. */
  private applySwap(give: Offer, get: Offer): void {
    for (const [id, n] of Object.entries(give)) invRemove(id, n);
    for (const [id, n] of Object.entries(get)) invAdd(id, n);
    this.updateBasket();
  }

  private sendToPartner(id: string, data: Record<string, unknown>): void {
    if (this.session.isHost) this.session.sendTo(id, data);
    else this.session.send(data);
  }

  private closeTrade(): void {
    this.tradePartner = null;
    this.myOffer = {};
    this.theirOffer = {};
    this.iConfirmed = false;
    this.theyConfirmed = false;
    this.tradePanel.visible = false;
  }

  private buildTradePanel(): void {
    this.tradePanel = new Container();
    this.tradePanel.visible = false;
    const bg = new Graphics();
    bg.roundRect(-330, -300, 660, 600, 26).fill(0x2a2016);
    bg.roundRect(-330, -300, 660, 600, 26).stroke({ color: FARM.accent, width: 3 });
    this.tradePanel.addChild(bg);
    const title = makeText('🤝 Trade — tap crops to offer', 24, {
      color: FARM.accent,
      weight: '900',
    });
    title.position.set(0, -262);
    this.tradePanel.addChild(title);
    this.theirText = makeText('', 20, { color: FARM.inkSoft, weight: '800' });
    this.theirText.position.set(0, -218);
    this.tradePanel.addChild(this.theirText);
    this.tradeGrid = new Container();
    this.tradePanel.addChild(this.tradeGrid);
    this.confirmBtn = new UIButton('CONFIRM', {
      width: 240,
      height: 74,
      fontSize: 28,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.confirmTrade(),
    });
    this.confirmBtn.position.set(-120, 250);
    this.add(this.confirmBtn, this.tradePanel);
    const cancel = new UIButton('CANCEL', {
      width: 200,
      height: 74,
      fontSize: 26,
      fill: 0x5a4632,
      textColor: FARM.ink,
      onTap: () => {
        if (this.tradePartner) this.sendToPartner(this.tradePartner, { type: 'trade-cancel' });
        this.closeTrade();
      },
    });
    cancel.position.set(140, 250);
    this.add(cancel, this.tradePanel);
    this.uiLayer.addChild(this.tradePanel);
  }

  private refreshTradePanel(): void {
    for (const old of this.tradeGrid.removeChildren()) old.destroy({ children: true });
    const theirs = Object.entries(this.theirOffer)
      .map(([id, n]) => `${cropById(id)?.emoji ?? id}×${n}`)
      .join('  ');
    this.theirText.text = `they offer: ${theirs || '—'}${this.theyConfirmed ? '  ✅' : ''}`;
    this.confirmBtn.setLabel(this.iConfirmed ? 'CONFIRMED ✅' : 'CONFIRM');

    const inv = invAll();
    const ids = CROPS.map((c) => c.id).filter((id) => (inv[id] ?? 0) > 0);
    const cols = 4;
    const dx = 150;
    const dy = 128;
    ids.forEach((id, k) => {
      const crop = cropById(id);
      if (!crop) return;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Entity();
      const offered = this.myOffer[id] ?? 0;
      const ring = new Graphics();
      ring
        .roundRect(-64, -52, 128, 104, 16)
        .fill(offered > 0 ? 0x3a5a2a : FARM.panel)
        .roundRect(-64, -52, 128, 104, 16)
        .stroke({
          color: offered > 0 ? FARM.accent : RARITY[crop.rarity].color,
          width: offered > 0 ? 4 : 2,
        });
      chip.addChild(ring);
      if (crop.emoji) chip.addChild(makeText(crop.emoji, 40));
      else if (crop.drawFruit) {
        const g = new Graphics();
        crop.drawFruit(g, 26);
        chip.addChild(g);
      }
      const lbl = makeText(`${offered}/${inv[id]}`, 18, { color: FARM.ink, weight: '900' });
      lbl.position.set(0, 34);
      chip.addChild(lbl);
      chip.position.set((col - (cols - 1) / 2) * dx, -150 + row * dy);
      chip.eventMode = 'static';
      chip.on('pointertap', () => this.toggleOfferItem(id));
      this.tradeGrid.addChild(chip);
    });
  }

  // ------------------------------------------------------------- misc

  private updateVerium(): void {
    this.veriumText.text = `⬡ ${verium.balance()}`;
  }

  private updateBasket(): void {
    const n = invTotal();
    this.basketText.text = n > 0 ? `🧺 ${n}` : '🧺 empty';
  }

  private toast(msg: string): void {
    this.toastText.text = msg;
    this.toastText.alpha = 1;
    const clear = new Entity();
    clear.addBehavior(new Tween(this.toastText, { alpha: 0 }, 2, { ease: easings.inQuad }));
    clear.addBehavior(new Timer(2.1, () => this.remove(clear)));
    this.add(clear, this.uiLayer);
  }

  private goTitle(): void {
    if (this.game.scenes.isTransitioning) return;
    this.leaving = true;
    audio.blip(0.9);
    this.session.leave();
    this.game.scenes.replace(new TitleScene());
  }
}
