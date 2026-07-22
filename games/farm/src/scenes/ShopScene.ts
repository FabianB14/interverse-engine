import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Tween, audio, darken, easings, verium } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { ACC_KEY, savedAcc, store } from '../store.js';
import {
  ACCESSORIES,
  accessoryById,
  accessoryView,
  buyAccessory,
  isAccessoryOwned,
} from '../accessories.js';
import { UPGRADES, buyUpgrade, nextCost, upgradeLevel } from '../upgrades.js';
import { THEMES, applyTheme, buyTheme, currentTheme, isThemeOwned } from '../themes.js';
import { PETS, activePet, buyPet, isPetOwned, setActivePet } from '../pets.js';
import { MarketScene } from './MarketScene.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

type Tab = 'upgrades' | 'cosmetics' | 'themes' | 'pets';

/** The farm shop: spend Verium on permanent upgrades or premium cosmetics. */
export class ShopScene extends Scene {
  private uiLayer!: Container;
  private content!: Container;
  private fxLayer!: Container;
  private titleText!: Text;
  private veriumText!: Text;
  private toastText!: Text;
  private backBtn!: UIButton;
  private homeBtn!: UIButton;
  private upTab!: UIButton;
  private cosTab!: UIButton;
  private themeTab!: UIButton;
  private petTab!: UIButton;
  private tab: Tab = 'upgrades';
  private W = 720;
  private H = 1280;

  protected override onResize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.layout();
    this.rebuild();
  }

  protected override onEnter(): void {
    this.W = this.game.viewWidth;
    this.H = this.game.viewHeight;

    const bg = new Graphics();
    bg.rect(0, 0, this.W, this.H).fill(FARM.bg);
    bg.roundRect(this.W * 0.03, 180, this.W * 0.94, this.H - 210, 30).fill(0x2a2016);
    this.stage.addChild(bg);

    this.content = new Container();
    this.fxLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.content, this.fxLayer, this.uiLayer);

    this.titleText = makeText('🛒 Shop', 40, { color: FARM.accent });
    this.uiLayer.addChild(this.titleText);
    this.veriumText = makeText('', 28, { color: FARM.coin, weight: '900' });
    this.veriumText.anchor.set(1, 0.5);
    this.uiLayer.addChild(this.veriumText);
    this.toastText = makeText('', 26, { color: FARM.accent, weight: '900' });
    this.uiLayer.addChild(this.toastText);

    this.backBtn = new UIButton('← Market', {
      width: 220,
      height: 76,
      fontSize: 28,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.toMarket(),
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

    const tabDef = (label: string, tab: Tab): UIButton =>
      new UIButton(label, {
        width: 168,
        height: 68,
        fontSize: 22,
        fill: FARM.panel,
        textColor: FARM.ink,
        onTap: () => this.setTab(tab),
      });
    this.upTab = tabDef('🌾 Upgrades', 'upgrades');
    this.cosTab = tabDef('🎩 Hats', 'cosmetics');
    this.themeTab = tabDef('🌸 Themes', 'themes');
    this.petTab = tabDef('🐤 Pets', 'pets');
    this.add(this.upTab, this.uiLayer);
    this.add(this.cosTab, this.uiLayer);
    this.add(this.themeTab, this.uiLayer);
    this.add(this.petTab, this.uiLayer);

    this.layout();
    this.rebuild();
    this.updateVerium();

    window.__farm = {
      scene: () => 'shop',
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      tab: () => this.tab,
      setTab: (t: string) => this.setTab(t === 'cosmetics' ? 'cosmetics' : 'upgrades'),
      buyUpgrade: (id: string) => this.buyUpgradeAction(id),
      upLevel: (id: string) => upgradeLevel(id),
      buyCosmetic: (id: string) => this.buyCosmeticAction(id),
      owned: (id: string) => isAccessoryOwned(id),
      buyTheme: (id: string) => this.buyThemeAction(id),
      themeActive: () => currentTheme().id,
      buyPet: (id: string) => this.buyPetAction(id),
      petActive: () => activePet(),
      toMarket: () => this.toMarket(),
      home: () => this.toHome(),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private get land(): boolean {
    return this.W > this.H;
  }

  private layout(): void {
    const W = this.W;
    this.backBtn.position.set(130, 54);
    this.homeBtn.position.set(W - 58, 54);
    this.titleText.position.set(W / 2, 54);
    this.veriumText.position.set(W - 108, 54);
    const tabs = [this.upTab, this.cosTab, this.themeTab, this.petTab];
    tabs.forEach((t, i) => t.position.set(W / 2 + (i - 1.5) * 178, 134));
    this.toastText.position.set(W / 2, this.H - 40);
  }

  private setTab(t: Tab): void {
    if (this.tab === t) return;
    this.tab = t;
    audio.blip(1.1);
    this.rebuild();
  }

  private rebuild(): void {
    // Highlight the active tab.
    this.upTab.alpha = this.tab === 'upgrades' ? 1 : 0.55;
    this.cosTab.alpha = this.tab === 'cosmetics' ? 1 : 0.55;
    this.themeTab.alpha = this.tab === 'themes' ? 1 : 0.55;
    this.petTab.alpha = this.tab === 'pets' ? 1 : 0.55;
    for (const old of this.content.removeChildren()) old.destroy({ children: true });
    if (this.tab === 'upgrades') this.buildUpgrades();
    else if (this.tab === 'cosmetics') this.buildCosmetics();
    else if (this.tab === 'themes') this.buildThemes();
    else this.buildPets();
  }

  /** Whole-farm looks: preview swatch strip + buy/apply. */
  private buildThemes(): void {
    const W = this.W;
    const cols = this.land ? 4 : 2;
    const cw = this.land ? W * 0.22 : W * 0.42;
    const ch = 200;
    const dx = this.land ? W * 0.24 : W * 0.46;
    THEMES.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new Container();
      card.position.set(W / 2 + (col - (cols - 1) / 2) * dx, 300 + row * (ch + 20));
      const bg = new Graphics();
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).fill(FARM.panel);
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).stroke({ color: FARM.accent, width: 2 });
      card.addChild(bg);
      // Mini landscape preview: grass, water, a tree.
      const prev = new Graphics();
      prev.roundRect(-cw / 2 + 14, -ch / 2 + 14, cw - 28, 64, 10).fill(t.grass);
      prev.ellipse(-cw * 0.2, -ch / 2 + 58, cw * 0.16, 12).fill(t.water);
      prev.circle(cw * 0.18, -ch / 2 + 40, 16).fill(t.foliage);
      prev.rect(cw * 0.16, -ch / 2 + 52, 5, 14).fill(t.trunk);
      if (t.blossom) {
        prev.circle(cw * 0.12, -ch / 2 + 32, 3).fill(t.blossom);
        prev.circle(cw * 0.24, -ch / 2 + 36, 3).fill(t.blossom);
      }
      card.addChild(prev);
      const name = makeText(`${t.emoji} ${t.name}`, 22, { color: FARM.ink, weight: '800' });
      name.position.set(0, 22);
      card.addChild(name);
      const owned = isThemeOwned(t.id);
      const active = currentTheme().id === t.id;
      const btn = new UIButton(active ? 'ACTIVE' : owned ? 'APPLY' : `⬡${t.price}`, {
        width: cw - 28,
        height: 56,
        fontSize: 22,
        fill: active ? 0x5a4632 : owned ? FARM.grass : FARM.accent,
        textColor: active ? FARM.inkSoft : owned ? 0x1c2a12 : 0x2a2016,
        onTap: () => this.buyThemeAction(t.id),
      });
      btn.position.set(0, 62);
      this.add(btn, card);
      this.content.addChild(card);
    });
  }

  /** AI pals that trot along behind you on the farm. */
  private buildPets(): void {
    const W = this.W;
    const cols = this.land ? 4 : 2;
    const cw = this.land ? W * 0.22 : W * 0.42;
    const ch = 210;
    const dx = this.land ? W * 0.24 : W * 0.46;
    PETS.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new Container();
      card.position.set(W / 2 + (col - (cols - 1) / 2) * dx, 300 + row * (ch + 20));
      const bg = new Graphics();
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).fill(FARM.panel);
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).stroke({ color: FARM.accent, width: 2 });
      card.addChild(bg);
      const view = p.draw(34);
      view.position.set(0, -30);
      card.addChild(view);
      const name = makeText(`${p.emoji} ${p.name}`, 22, { color: FARM.ink, weight: '800' });
      name.position.set(0, 34);
      card.addChild(name);
      const owned = isPetOwned(p.id);
      const active = activePet() === p.id;
      const btn = new UIButton(active ? 'WITH YOU' : owned ? 'BRING' : `⬡${p.price}`, {
        width: cw - 28,
        height: 56,
        fontSize: 22,
        fill: active ? 0x5a4632 : owned ? FARM.grass : FARM.accent,
        textColor: active ? FARM.inkSoft : owned ? 0x1c2a12 : 0x2a2016,
        onTap: () => this.buyPetAction(p.id),
      });
      btn.position.set(0, 72);
      this.add(btn, card);
      this.content.addChild(card);
    });
  }

  private buyThemeAction(id: string): boolean {
    if (isThemeOwned(id)) {
      applyTheme(id);
      audio.chime();
      this.toast('theme applied — see it on the farm! 🌸');
      this.rebuild();
      return true;
    }
    if (buyTheme(id)) {
      applyTheme(id);
      audio.chime();
      this.toast('theme unlocked + applied! 🌸');
      this.rebuild();
      this.updateVerium();
      return true;
    }
    this.toast('not enough Verium');
    audio.buzz();
    return false;
  }

  private buyPetAction(id: string): boolean {
    if (isPetOwned(id)) {
      setActivePet(activePet() === id ? '' : id);
      audio.blip(1.2);
      this.rebuild();
      return true;
    }
    if (buyPet(id)) {
      audio.chime();
      this.toast('a new friend joins your farm! 🐾');
      this.rebuild();
      this.updateVerium();
      return true;
    }
    this.toast('not enough Verium');
    audio.buzz();
    return false;
  }

  private buildUpgrades(): void {
    const W = this.W;
    const land = this.land;
    const cols = land ? 2 : 1;
    const cw = land ? W * 0.45 : W * 0.88;
    const ch = land ? 132 : 150;
    UPGRADES.forEach((u, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new Container();
      card.position.set(
        land ? W / 2 + (col - (cols - 1) / 2) * (W * 0.47) : W / 2,
        (land ? 260 : 280) + row * (ch + 18),
      );
      const bg = new Graphics();
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 22).fill(FARM.panel);
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 22).stroke({
        color: darken(FARM.panel, 0.3),
        width: 2,
      });
      card.addChild(bg);
      card.addChild(this.leftText(`${u.emoji} ${u.name}`, 30, -cw / 2 + 30, -42, FARM.ink));
      card.addChild(this.leftText(u.desc, 20, -cw / 2 + 30, -6, FARM.inkSoft));
      // Level pips.
      const lvl = upgradeLevel(u.id);
      const pips = new Graphics();
      for (let p = 0; p < u.maxLevel; p++) {
        const on = p < lvl;
        pips.circle(-cw / 2 + 40 + p * 34, 34, 12).fill(on ? FARM.accent : darken(FARM.panel, 0.3));
      }
      card.addChild(pips);

      const cost = nextCost(u.id);
      const maxed = cost === null;
      const btn = new UIButton(maxed ? 'MAX' : `⬡${cost}`, {
        width: 190,
        height: 96,
        fontSize: maxed ? 26 : 30,
        fill: maxed ? 0x5a4632 : FARM.accent,
        textColor: maxed ? FARM.inkSoft : 0x2a2016,
        onTap: () => this.buyUpgradeAction(u.id),
      });
      btn.position.set(cw / 2 - 120, 0);
      this.add(btn, card);
      this.content.addChild(card);
    });
  }

  private buildCosmetics(): void {
    const W = this.W;
    const premium = ACCESSORIES.filter((a) => a.price);
    const cols = this.land ? 4 : 2;
    const cw = this.land ? W * 0.22 : W * 0.42;
    const ch = 210;
    const dx = this.land ? W * 0.24 : W * 0.46;
    const dy = ch + 20;
    premium.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const card = new Container();
      card.position.set(W / 2 + (col - (cols - 1) / 2) * dx, 300 + row * dy);
      const bg = new Graphics();
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).fill(FARM.panel);
      bg.roundRect(-cw / 2, -ch / 2, cw, ch, 20).stroke({ color: FARM.accent, width: 2 });
      card.addChild(bg);
      // Preview drawn on a little head.
      const head = new Graphics().circle(0, -20, 34).fill(0x6fb0d8);
      card.addChild(head);
      const acc = accessoryView(a.id, 34);
      acc.position.set(0, -20);
      card.addChild(acc);
      const name = makeText(a.name, 22, { color: FARM.ink, weight: '800' });
      name.position.set(0, 34);
      card.addChild(name);

      const owned = isAccessoryOwned(a.id);
      const worn = savedAcc() === a.id;
      const btn = new UIButton(worn ? 'WEARING' : owned ? 'WEAR' : `⬡${a.price}`, {
        width: cw - 30,
        height: 62,
        fontSize: 24,
        fill: worn ? 0x5a4632 : owned ? FARM.grass : FARM.accent,
        textColor: worn ? FARM.inkSoft : owned ? 0x1c2a12 : 0x2a2016,
        onTap: () => (owned ? this.wearCosmetic(a.id) : this.buyCosmeticAction(a.id)),
      });
      btn.position.set(0, 74);
      this.add(btn, card);
      this.content.addChild(card);
    });
  }

  private buyUpgradeAction(id: string): boolean {
    if (buyUpgrade(id)) {
      audio.chime();
      this.toast('upgraded! 🌾');
      this.rebuild();
      this.updateVerium();
      return true;
    }
    this.toast(nextCost(id) === null ? 'already maxed out' : 'not enough Verium');
    audio.buzz();
    return false;
  }

  private buyCosmeticAction(id: string): boolean {
    if (buyAccessory(id)) {
      audio.chime();
      this.wearCosmetic(id);
      this.toast(`unlocked ${accessoryById(id).name}! 🎩`);
      return true;
    }
    this.toast('not enough Verium');
    audio.buzz();
    return false;
  }

  private wearCosmetic(id: string): void {
    store.set(ACC_KEY, id);
    audio.blip(1.2);
    this.rebuild();
  }

  private toast(msg: string): void {
    this.toastText.text = msg;
    this.toastText.alpha = 1;
    const clear = new Entity();
    clear.addBehavior(new Tween(this.toastText, { alpha: 0 }, 1.6, { ease: easings.inQuad }));
    clear.addBehavior(new Timer(1.7, () => this.remove(clear)));
    this.add(clear, this.fxLayer);
  }

  private leftText(content: string, size: number, x: number, y: number, color: number): Text {
    const t = makeText(content, size, { color, weight: '800' });
    t.anchor.set(0, 0.5);
    t.position.set(x, y);
    return t;
  }

  private updateVerium(): void {
    this.veriumText.text = `⬡ ${verium.balance()}`;
  }

  private toMarket(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.game.scenes.replace(new MarketScene());
  }

  private toHome(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.game.scenes.replace(new TitleScene());
  }
}
