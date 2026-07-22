import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Entity,
  Scene,
  Timer,
  Tween,
  audio,
  darken,
  easings,
  makeTappable,
  verium,
} from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { RARITY, cropById } from '../crops.js';
import { invAdd, invAll, invClear, invCount, invRemove } from '../inventory.js';
import { BUNDLE, buyBundle } from '../gifts.js';
import { sellMultiplier } from '../upgrades.js';
import { loadOrders, saveOrders, topUpOrders } from '../orders.js';
import type { Order } from '../orders.js';
import { FarmScene } from './FarmScene.js';
import { ShopScene } from './ShopScene.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

/** The farmers market: fill customer orders for bonus Verium, or quick-sell. */
export class MarketScene extends Scene {
  private orders: Order[] = [];
  private ordersLayer!: Container;
  private basketLayer!: Container;
  private fxLayer!: Container;
  private uiLayer!: Container;
  private titleText!: Text;
  private veriumText!: Text;
  private ordersLabel!: Text;
  private basketLabel!: Text;
  private basketNote!: Text;
  private toastText!: Text;
  private backBtn!: UIButton;
  private homeBtn!: UIButton;
  private bundleBtn!: UIButton;
  private shopBtn!: UIButton;
  private W = 720;
  private H = 1280;

  protected override onResize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.layout();
  }

  protected override onEnter(): void {
    this.W = this.game.viewWidth;
    this.H = this.game.viewHeight;

    this.orders = topUpOrders(loadOrders());
    saveOrders(this.orders);

    const bg = new Graphics();
    bg.rect(0, 0, this.W, this.H).fill(FARM.bg);
    bg.roundRect(this.W * 0.03, 100, this.W * 0.94, this.H - 130, 30).fill(0x3a2c1a);
    this.stage.addChild(bg);

    this.ordersLayer = new Container();
    this.basketLayer = new Container();
    this.fxLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.ordersLayer, this.basketLayer, this.fxLayer, this.uiLayer);

    this.titleText = makeText('🧺 Market', 40, { color: FARM.accent });
    this.uiLayer.addChild(this.titleText);
    this.veriumText = makeText('', 28, { color: FARM.coin, weight: '900' });
    this.veriumText.anchor.set(1, 0.5);
    this.uiLayer.addChild(this.veriumText);
    this.ordersLabel = makeText('ORDERS', 24, { color: FARM.inkSoft, weight: '800' });
    this.uiLayer.addChild(this.ordersLabel);
    this.basketLabel = makeText('YOUR BASKET', 24, { color: FARM.inkSoft, weight: '800' });
    this.uiLayer.addChild(this.basketLabel);
    this.basketNote = makeText('tap a crop to quick-sell at base price', 18, {
      color: FARM.inkSoft,
      weight: 'bold',
    });
    this.uiLayer.addChild(this.basketNote);
    this.toastText = makeText('', 26, { color: FARM.accent, weight: '900' });
    this.uiLayer.addChild(this.toastText);

    this.backBtn = new UIButton('← Farm', {
      width: 200,
      height: 76,
      fontSize: 30,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.toFarm(),
    });
    this.add(this.backBtn, this.uiLayer);

    this.homeBtn = new UIButton('🏠', {
      width: 76,
      height: 76,
      fontSize: 34,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toHome(),
    });
    this.add(this.homeBtn, this.uiLayer);

    this.bundleBtn = new UIButton(`🎁 Bundle ⬡${BUNDLE.cost} → ${BUNDLE.count} crops`, {
      width: 340,
      height: 74,
      fontSize: 22,
      fill: 0x6b4f8f,
      onTap: () => this.buyBundleAction(),
    });
    this.add(this.bundleBtn, this.uiLayer);

    this.shopBtn = new UIButton('🛒 Shop', {
      width: 170,
      height: 74,
      fontSize: 24,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.toShop(),
    });
    this.add(this.shopBtn, this.uiLayer);

    this.layout();
    this.buildOrders();
    this.buildBasket();
    this.updateVerium();

    window.__farm = {
      scene: () => 'market',
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      orders: () => this.orders.map((o) => ({ crop: o.crop, qty: o.qty, reward: o.reward })),
      fulfill: (i: number) => this.fulfillOrder(i),
      quickSell: (id: string) => this.quickSellCrop(id),
      buyBundle: () => this.buyBundleAction(),
      inv: () => invAll(),
      giveItem: (id: string, n: number) => {
        invAdd(id, n);
        this.buildOrders();
        this.buildBasket();
      },
      clearInv: () => {
        invClear();
        this.buildOrders();
        this.buildBasket();
      },
      toFarm: () => this.toFarm(),
      home: () => this.toHome(),
      toShop: () => this.toShop(),
    };
  }

  private buyBundleAction(): boolean {
    if (buyBundle()) {
      audio.chime();
      this.toast(`🎁 bundle! +${BUNDLE.count} crops`);
      this.buildOrders();
      this.buildBasket();
      this.updateVerium();
      return true;
    }
    this.toast('not enough Verium for the bundle');
    audio.buzz();
    return false;
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private get land(): boolean {
    return this.W > this.H;
  }

  private layout(): void {
    const W = this.W;
    this.backBtn.position.set(120, 54);
    this.homeBtn.position.set(W - 58, 54);
    this.titleText.position.set(W / 2, 54);
    this.veriumText.position.set(W - 108, 54);
    if (this.land) {
      // Two columns: orders on the left, commerce (bundle/shop/basket) right.
      const rx = W * 0.73;
      this.ordersLabel.position.set(W * 0.29, 120);
      this.bundleBtn.position.set(rx, 170);
      this.shopBtn.position.set(rx, 252);
      this.basketLabel.position.set(rx, 320);
      this.basketNote.position.set(rx, 350);
      this.toastText.position.set(W / 2, this.H - 30);
    } else {
      this.ordersLabel.position.set(W / 2, 150);
      this.bundleBtn.position.set(W / 2 - 110, this.H - 430);
      this.shopBtn.position.set(W / 2 + 190, this.H - 430);
      this.basketLabel.position.set(W / 2, this.H - 360);
      this.basketNote.position.set(W / 2, this.H - 330);
      this.toastText.position.set(W / 2, this.H - 60);
    }
    this.buildOrders();
    this.buildBasket();
  }

  private orderCardW(): number {
    return this.land ? this.W * 0.5 : this.W * 0.9;
  }

  private buildOrders(): void {
    for (const old of this.ordersLayer.removeChildren()) old.destroy({ children: true });
    const cw = this.orderCardW();
    const ch = this.land ? 124 : 138;
    const cx = this.land ? this.W * 0.29 : this.W / 2;
    const startY = this.land ? 200 : 250;
    this.orders.forEach((o, i) => {
      const crop = cropById(o.crop);
      const card = new Container();
      card.position.set(cx, startY + i * (ch + 16));
      const bg = new Graphics();
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 22).fill(FARM.panel);
      // A rarity-colored border hints at how prized the requested crop is.
      const rc = crop ? RARITY[crop.rarity].color : darken(FARM.panel, 0.3);
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 22).stroke({ color: rc, width: 3 });
      card.addChild(bg);
      card.addChild(this.cardText(o.who, 60, -cw / 2 + 60, -6));
      const label = crop?.emoji ?? crop?.name ?? '?';
      card.addChild(this.cardText(`wants ×${o.qty} ${label}`, 28, -cw / 2 + 120, -26, 0, rc));
      card.addChild(this.cardText(`reward ⬡${o.reward}`, 24, -cw / 2 + 120, 20, 0, FARM.coin));
      const have = invCount(o.crop);
      card.addChild(
        this.cardText(
          `you have ${have}`,
          18,
          -cw / 2 + 120,
          50,
          0,
          have >= o.qty ? 0x8fd06a : FARM.inkSoft,
        ),
      );
      const canFill = have >= o.qty;
      const btn = new UIButton(canFill ? 'FULFILL' : `need ${o.qty - have}`, {
        width: 190,
        height: 92,
        fontSize: canFill ? 28 : 22,
        fill: canFill ? FARM.accent : 0x5a4632,
        textColor: canFill ? 0x2a2016 : FARM.inkSoft,
        onTap: () => this.fulfillOrder(i),
      });
      btn.position.set(cw / 2 - 120, 0);
      this.add(btn, card);
      this.ordersLayer.addChild(card);
    });
  }

  private buildBasket(): void {
    for (const old of this.basketLayer.removeChildren()) old.destroy({ children: true });
    const inv = invAll();
    const ids = Object.keys(inv).filter((id) => (inv[id] ?? 0) > 0 && cropById(id));
    const land = this.land;
    const centerX = land ? this.W * 0.73 : this.W / 2;
    if (ids.length === 0) {
      const empty = makeText('basket empty — go harvest! 🌾', 22, {
        color: FARM.inkSoft,
        weight: 'bold',
      });
      empty.position.set(centerX, land ? 420 : this.H - 250);
      this.basketLayer.addChild(empty);
      return;
    }
    const cols = land ? 4 : 5;
    const dx = Math.min(120, (land ? this.W * 0.44 : this.W * 0.9) / cols);
    const dy = land ? 108 : 118;
    const startY = land ? 420 : this.H - 300;
    ids.forEach((id, k) => {
      const crop = cropById(id);
      if (!crop) return;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Entity();
      const ring = new Graphics();
      ring
        .circle(0, 0, 42)
        .fill(FARM.panel)
        .circle(0, 0, 42)
        .stroke({ color: darken(FARM.panel, 0.3), width: 2 });
      chip.addChild(ring);
      if (crop.emoji) chip.addChild(makeText(crop.emoji, 40));
      else if (crop.drawFruit) {
        const g = new Graphics();
        crop.drawFruit(g, 26);
        chip.addChild(g);
      }
      const count = makeText(`×${inv[id]}`, 20, { color: FARM.ink, weight: '900' });
      count.position.set(0, 44);
      chip.addChild(count);
      chip.position.set(centerX + (col - (cols - 1) / 2) * dx, startY + row * dy);
      makeTappable(chip, () => this.quickSellCrop(id), { hitRadius: 46 });
      this.basketLayer.addChild(chip);
    });
  }

  /** Small left-anchored helper for card text. */
  private cardText(
    content: string,
    size: number,
    x: number,
    y: number,
    anchorX = 0.5,
    color: number = FARM.ink,
  ): Text {
    const t = makeText(content, size, { color, weight: '800' });
    t.anchor.set(anchorX, 0.5);
    t.position.set(x, y);
    return t;
  }

  private fulfillOrder(i: number): boolean {
    const o = this.orders[i];
    if (!o) return false;
    if (invCount(o.crop) < o.qty) {
      this.toast('not enough — grow more!');
      audio.buzz();
      return false;
    }
    invRemove(o.crop, o.qty);
    const reward = Math.round(o.reward * sellMultiplier());
    verium.add(reward);
    audio.chime();
    this.happy(250 + i * 156, `+⬡${reward}`);
    this.orders.splice(i, 1);
    this.orders = topUpOrders(this.orders);
    saveOrders(this.orders);
    this.buildOrders();
    this.buildBasket();
    this.updateVerium();
    return true;
  }

  private quickSellCrop(id: string): number {
    const n = invCount(id);
    const crop = cropById(id);
    if (n <= 0 || !crop) return 0;
    const gain = Math.round(n * crop.sellPrice * sellMultiplier());
    invRemove(id, n);
    verium.add(gain);
    audio.chime();
    this.happy(this.H - 300, `+⬡${gain}`);
    this.buildOrders();
    this.buildBasket();
    this.updateVerium();
    return gain;
  }

  private updateVerium(): void {
    this.veriumText.text = `⬡ ${verium.balance()}`;
  }

  private happy(y: number, text: string): void {
    const e = new Entity();
    e.position.set(this.W / 2, y);
    e.addChild(makeText(text, 34, { color: FARM.coin, weight: '900' }));
    e.addBehavior(new Tween(e, { y: y - 70, alpha: 0 }, 0.9, { ease: easings.outQuad }));
    e.addBehavior(new Timer(0.95, () => this.remove(e)));
    this.add(e, this.fxLayer);
  }

  private toast(msg: string): void {
    this.toastText.text = msg;
    this.toastText.alpha = 1;
    const clear = new Entity();
    clear.addBehavior(new Tween(this.toastText, { alpha: 0 }, 1.6, { ease: easings.inQuad }));
    clear.addBehavior(new Timer(1.7, () => this.remove(clear)));
    this.add(clear, this.fxLayer);
  }

  private toFarm(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.game.scenes.replace(new FarmScene());
  }

  private toHome(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.game.scenes.replace(new TitleScene());
  }

  private toShop(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.game.scenes.replace(new ShopScene());
  }
}
