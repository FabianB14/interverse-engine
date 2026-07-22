import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Camera,
  DialogueRunner,
  Entity,
  Scene,
  Timer,
  Tween,
  VirtualJoystick,
  Wobble,
  audio,
  buildTileMapView,
  cozyAutumn,
  darken,
  easings,
  lighten,
  makeTappable,
  moveWithCollision,
  tileMapFromRows,
  verium,
} from '@interverse/engine';
import type { DialogueData, TileMapData } from '@interverse/engine';
import { DialogueBox, UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { CROPS, RARITY, cropById } from '../crops.js';
import type { CropDef } from '../crops.js';
import { claimGift, claimWelcome, giftReadyInMs } from '../gifts.js';
import {
  SEASON_ICON,
  WEATHER_ICON,
  computeWeather,
  isWet,
  seasonAt,
  weatherAt,
} from '../weather.js';
import type { Season, Weather } from '../weather.js';
import { music } from '../music.js';
import { ambience } from '../ambience.js';
import { savedAcc, savedName, savedSkin, store } from '../store.js';
import { invAdd, invAll, invClear, invTotal } from '../inventory.js';
import { makeCharacter } from '../character.js';
import type { CharType } from '../character.js';
import { TILE_SIZE, farmLegend, farmPainters, farmRows } from '../map.js';
import { MarketScene } from './MarketScene.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

const PLAYER_SPEED = 250;
const INTERACT_RANGE = 140;
const PLOT_SIZE = 58;
const MOISTURE_DECAY = 0.03;
const GROW_MOISTURE = 0.15;

interface Plot {
  crop: string | null;
  growth: number;
  moisture: number;
}

interface PlotView {
  root: Entity;
  soil: Graphics;
  leaves: Graphics;
  fruit: Container | null;
  fruitCrop: string | null;
  x: number;
  y: number;
}

const VENDOR_DIALOGUE: DialogueData = {
  start: 'intro',
  nodes: {
    intro: {
      speaker: 'Market Vendor',
      text: 'Howdy, neighbor! Bring your harvest to the market?',
      choices: [
        { text: '🧺 Yes — to the market!', next: 'go' },
        { text: 'Just saying hi', next: 'bye' },
      ],
    },
    go: { speaker: 'Market Vendor', text: 'Wonderful — folks are waiting on their orders!' },
    bye: { speaker: 'Market Vendor', text: 'Come back when your crops are ripe!' },
  },
};

type Target = { kind: 'plot'; i: number } | { kind: 'vendor' } | { kind: 'gift' } | null;

// Rotating gameplay hints so a new farmer knows what to do next.
const TIPS: readonly string[] = [
  '💡 Slide your thumb anywhere to walk',
  '💡 Tap 🎒 to see all the crops in your basket',
  '💡 Check the market for orders before you plant',
  '💡 Rarer crops are worth more — and orders pay big',
  '💡 Keep crops watered (or let the rain do it) to grow',
  '💡 Open the free gift box when it recharges',
  '💡 Grab the market bundle for cheap crops',
  '💡 Talk to the vendor to head to the market',
];

export class FarmScene extends Scene {
  private map!: TileMapData;
  private mapLayer!: Container;
  private uiLayer!: Container;
  private camera!: Camera;
  private joystick!: VirtualJoystick;
  private player!: Entity;
  private playerBody!: Container;
  private walkPhase = 0;
  private facing = 1;

  private homeBtn!: UIButton;
  private tipText!: Text;
  private tipIndex = 0;
  private tipIn = 6;

  private flash = 0;
  private boltIn = 4;

  private plots: Plot[] = [];
  private plotViews: PlotView[] = [];
  private vendor!: Entity;
  private vendorBang!: Text;
  private giftBox!: Entity;
  private giftGfx!: Graphics;
  private giftLabel!: Text;

  private box!: DialogueBox;
  private runner: DialogueRunner | null = null;
  private openMarketOnClose = false;

  private selectedSeed = 'carrot';
  private seedPanel!: Container;
  private seedChips: { id: string; ring: Graphics }[] = [];
  private pouchBtn!: UIButton;
  private interactBtn!: UIButton;
  private invBtn!: UIButton;
  private invPanel!: Container;
  private invGrid!: Container;
  private invTotalText!: Text;
  private promptText!: Text;
  private target: Target = null;

  private veriumText!: Text;
  private basketText!: Text;
  private weatherText!: Text;
  private nameText!: Text;
  private toastText!: Text;
  private rainLayer!: Graphics;

  private clock = 0;
  private forcedWeather: Weather | null = null;
  private season: Season = 'spring';
  private harvested = 0;
  private t = 0;
  private saveIn = 5;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.load();

    this.map = tileMapFromRows(farmRows, TILE_SIZE, farmLegend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.mapLayer.addChild(buildTileMapView(this.map, farmPainters));

    // Plots at every 'plot' object.
    const plotObjs = this.map.objects.filter((o) => o.name === 'plot');
    if (this.plots.length !== plotObjs.length) {
      this.plots = plotObjs.map(() => ({ crop: null, growth: 0, moisture: 0 }));
    }
    plotObjs.forEach((o, i) => {
      const root = new Entity();
      root.position.set(o.x, o.y);
      const soil = new Graphics();
      const leaves = new Graphics();
      root.addChild(soil, leaves);
      const idx = i;
      makeTappable(root, () => this.tapPlot(idx), {
        hitRect: { x: -PLOT_SIZE / 2, y: -PLOT_SIZE / 2, width: PLOT_SIZE, height: PLOT_SIZE },
      });
      this.add(root, this.mapLayer);
      this.plotViews.push({ root, soil, leaves, fruit: null, fruitCrop: null, x: o.x, y: o.y });
    });

    // Vendor NPC.
    const vObj = this.map.objects.find((o) => o.name === 'vendor') ?? { x: 720, y: 288 };
    this.vendor = new Entity();
    const vChar = makeCharacter('person', 0xe07a5f, 34, 21);
    this.vendor.addChild(vChar.view);
    this.vendor.position.set(vObj.x, vObj.y + 20);
    this.vendor.addBehavior(new Wobble({ target: vChar.body, amount: 0.03, speed: 1.8 }));
    this.vendorBang = makeText('!', 44, { color: FARM.accent });
    this.vendorBang.position.set(0, -76);
    this.vendorBang.visible = false;
    this.vendor.addChild(this.vendorBang);
    makeTappable(this.vendor, () => this.tryTalk(), { hitRadius: 80 });
    this.add(this.vendor, this.mapLayer);

    // Gift box — a recharging free reward you walk up to and open.
    const gObj = this.map.objects.find((o) => o.name === 'gift') ?? { x: 400, y: 736 };
    this.giftBox = new Entity();
    this.giftGfx = new Graphics();
    this.giftBox.addChild(this.giftGfx);
    this.giftLabel = makeText('', 18, { color: FARM.accent, weight: '800' });
    this.giftLabel.position.set(0, -46);
    this.giftBox.addChild(this.giftLabel);
    this.giftBox.position.set(gObj.x, gObj.y);
    this.giftBox.addBehavior(new Wobble({ target: this.giftGfx, amount: 0.06, speed: 3 }));
    makeTappable(this.giftBox, () => this.claimGiftBox(), { hitRadius: 60 });
    this.add(this.giftBox, this.mapLayer);
    this.drawGiftBox();

    // Player.
    const spawn = this.map.objects.find((o) => o.name === 'player') ?? { x: 544, y: 672 };
    const charType = store.get<CharType>('charType', 'blob');
    const charColor = store.get<number>('charColor', 0xe07a5f);
    this.player = new Entity();
    const pChar = makeCharacter(charType, charColor, 30, 5, savedAcc(), savedSkin());
    this.playerBody = pChar.body;
    this.player.addChild(pChar.view);
    this.player.position.set(spawn.x, spawn.y);
    this.add(this.player, this.mapLayer);

    this.camera = new Camera(this.mapLayer, W, H, { deadzoneWidth: 140, deadzoneHeight: 180 });
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    this.camera.follow(this.player);

    // World prompt over the current interactable.
    this.promptText = makeText('', 22, { color: FARM.ink, weight: '800' });
    this.promptText.visible = false;
    this.mapLayer.addChild(this.promptText);

    // UI layer. A dynamic joystick: press and slide anywhere to walk — the
    // ring springs up under your thumb. Sits below the action buttons so
    // taps on those still hit the buttons.
    this.joystick = new VirtualJoystick({
      radius: 90,
      dynamic: true,
      hitWidth: W,
      hitHeight: H,
    });
    this.joystick.position.set(W / 2, H / 2);
    this.add(this.joystick, this.uiLayer);

    this.rainLayer = new Graphics();
    this.uiLayer.addChild(this.rainLayer);

    this.veriumText = makeText('', 28, { color: FARM.coin, weight: '900' });
    this.veriumText.anchor.set(0, 0.5);
    this.basketText = makeText('', 22, { color: FARM.ink, weight: '800' });
    this.basketText.anchor.set(0, 0.5);
    this.weatherText = makeText('', 24, { color: FARM.ink, weight: '800' });
    this.weatherText.anchor.set(1, 0.5);
    const farmer = savedName();
    this.nameText = makeText(farmer ? `${farmer}'s Farm` : '', 24, {
      color: FARM.accent,
      weight: '900',
    });
    this.toastText = makeText('', 26, { color: FARM.accent, weight: '900' });
    this.tipText = makeText(TIPS[0]!, 19, { color: FARM.inkSoft, weight: '800' });
    this.tipText.alpha = 0.92;
    this.uiLayer.addChild(
      this.veriumText,
      this.basketText,
      this.weatherText,
      this.nameText,
      this.toastText,
      this.tipText,
    );

    // Home button — back to the title/menu from anywhere.
    this.homeBtn = new UIButton('🏠', {
      width: 76,
      height: 76,
      fontSize: 34,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.goHome(),
    });
    this.add(this.homeBtn, this.uiLayer);

    this.pouchBtn = new UIButton('🌱', {
      width: 100,
      height: 88,
      fontSize: 40,
      fill: FARM.panel,
      onTap: () => this.toggleSeedPanel(),
    });
    this.add(this.pouchBtn, this.uiLayer);
    this.invBtn = new UIButton('🎒', {
      width: 100,
      height: 88,
      fontSize: 40,
      fill: FARM.panel,
      onTap: () => this.toggleInventory(),
    });
    this.add(this.invBtn, this.uiLayer);
    this.interactBtn = new UIButton('✋', {
      width: 140,
      height: 140,
      fontSize: 56,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.performInteract(),
    });
    this.add(this.interactBtn, this.uiLayer);
    this.buildSeedPanel();
    this.buildInventoryPanel();

    this.box = new DialogueBox({ palette: cozyAutumn });
    this.box.onClosed = () => {
      this.runner = null;
      this.joystick.visible = true;
      if (this.openMarketOnClose) {
        this.openMarketOnClose = false;
        this.goMarket();
      }
    };
    this.add(this.box, this.uiLayer);

    this.layout(W, H);
    for (let i = 0; i < this.plotViews.length; i++) this.renderPlot(i);
    this.updateVeriumText();
    this.updateBasket();
    this.refreshSeedHighlight();

    // Welcome gift so a brand-new farmer can afford their first seeds.
    if (claimWelcome()) {
      this.updateVeriumText();
      this.updateBasket();
      const back = new Entity();
      back.addBehavior(new Timer(0.4, () => this.toast('🎁 Welcome gift! +100 ⬡ and free crops')));
      this.add(back, this.uiLayer);
    }

    window.__farm = {
      scene: () => 'farm',
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      selectSeed: (id: string) => this.selectSeed(id),
      plant: (i: number, cropId?: string) => this.plantAt(i, cropId ?? this.selectedSeed),
      water: (i: number) => this.waterAt(i),
      waterAll: () => this.waterAll(),
      harvest: (i: number) => this.harvestAt(i),
      growAll: () => {
        for (const p of this.plots) if (p.crop) p.growth = 1;
      },
      plotInfo: () =>
        this.plots.map((p) => ({
          c: p.crop,
          g: Math.round(p.growth * 100) / 100,
          m: Math.round(p.moisture * 100) / 100,
        })),
      harvested: () => this.harvested,
      inv: () => invAll(),
      giveItem: (id: string, n: number) => {
        invAdd(id, n);
        this.updateBasket();
      },
      clearInv: () => {
        invClear();
        this.updateBasket();
      },
      toMarket: () => this.goMarket(),
      weather: () => this.currentWeather(),
      season: () => this.season,
      setClock: (t: number) => {
        this.clock = t;
      },
      rainNow: () => {
        this.forcedWeather = 'rain';
      },
      musicOn: () => music.playing,
      toggleMusic: () => music.toggle(),
      player: () => ({ x: this.player.x, y: this.player.y }),
      teleport: (x: number, y: number) => {
        this.player.position.set(x, y);
      },
      talkVendor: () => {
        this.player.position.set(this.vendor.x, this.vendor.y + 60);
        this.tryTalk();
      },
      dialogueOpen: () => this.box.isOpen,
      giftReadyMs: () => giftReadyInMs(),
      claimGift: () => this.claimGiftBox(),
      home: () => this.goHome(),
      tip: () => this.tipText.text,
      storm: () => this.currentWeather() === 'storm',
      openInv: () => this.toggleInventory(),
      invOpen: () => this.invPanel.visible,
    };
  }

  protected override onExit(): void {
    this.save();
    ambience.stop();
    delete window.__farm;
  }

  // ------------------------------------------------------------- layout

  private layout(W: number, H: number): void {
    this.camera.setViewSize(W, H);
    this.homeBtn.position.set(52, 48);
    this.veriumText.position.set(100, 40);
    this.basketText.position.set(100, 74);
    this.weatherText.position.set(W - 20, 44);
    this.nameText.position.set(W / 2, 40);
    this.toastText.position.set(W / 2, 108);
    this.tipText.position.set(W / 2, H - 26);
    this.joystick.position.set(W / 2, H / 2);
    this.joystick.setHitSize(W, H);
    this.interactBtn.position.set(W - 100, H - 120);
    this.pouchBtn.position.set(W - 100, H - 250);
    this.invBtn.position.set(W - 100, H - 350);
    this.seedPanel.position.set(W / 2, H - 360);
    this.invPanel.position.set(W / 2, H / 2);
    this.box.position.set((W - 656) / 2, H - 300 - 36);
  }

  private buildSeedPanel(): void {
    this.seedPanel = new Container();
    this.seedPanel.visible = false;
    const bg = new Graphics();
    bg.roundRect(-330, -140, 660, 280, 26).fill(0x2a2016);
    bg.roundRect(-330, -140, 660, 280, 26).stroke({ color: FARM.accent, width: 3 });
    this.seedPanel.addChild(bg);
    const title = makeText('choose a seed', 22, { color: FARM.inkSoft, weight: '800' });
    title.position.set(0, -112);
    this.seedPanel.addChild(title);
    const cols = 5;
    const dx = 122;
    const dy = 120;
    CROPS.forEach((crop, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const chip = new Entity();
      const ring = new Graphics();
      chip.addChild(ring);
      if (crop.emoji) chip.addChild(makeText(crop.emoji, 40));
      else if (crop.drawFruit) {
        const g = new Graphics();
        crop.drawFruit(g, 26);
        chip.addChild(g);
      }
      const cost = makeText(`seed ⬡${crop.seedCost}`, 16, { color: FARM.inkSoft, weight: '800' });
      cost.position.set(0, 36);
      chip.addChild(cost);
      const worth = makeText(`worth ⬡${crop.sellPrice}`, 16, {
        color: RARITY[crop.rarity].color,
        weight: '800',
      });
      worth.position.set(0, 56);
      chip.addChild(worth);
      chip.position.set((col - (cols - 1) / 2) * dx, -50 + row * dy);
      const id = crop.id;
      makeTappable(chip, () => this.pickSeed(id), { hitRadius: 46 });
      this.seedPanel.addChild(chip);
      this.seedChips.push({ id, ring });
    });
    this.uiLayer.addChild(this.seedPanel);
  }

  private toggleSeedPanel(): void {
    this.seedPanel.visible = !this.seedPanel.visible;
    audio.blip();
  }

  /** The basket/inventory panel: every crop you're holding, with worth. */
  private buildInventoryPanel(): void {
    this.invPanel = new Container();
    this.invPanel.visible = false;
    const bg = new Graphics();
    bg.roundRect(-330, -300, 660, 600, 26).fill(0x2a2016);
    bg.roundRect(-330, -300, 660, 600, 26).stroke({ color: FARM.accent, width: 3 });
    this.invPanel.addChild(bg);
    const title = makeText('🎒 your basket', 30, { color: FARM.accent, weight: '900' });
    title.position.set(0, -262);
    this.invPanel.addChild(title);
    this.invTotalText = makeText('', 22, { color: FARM.coin, weight: '900' });
    this.invTotalText.position.set(0, -222);
    this.invPanel.addChild(this.invTotalText);
    this.invGrid = new Container();
    this.invPanel.addChild(this.invGrid);
    const close = new UIButton('✕ close', {
      width: 200,
      height: 70,
      fontSize: 26,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toggleInventory(),
    });
    close.position.set(0, 250);
    this.add(close, this.invPanel);
    this.uiLayer.addChild(this.invPanel);
  }

  private refreshInventoryPanel(): void {
    for (const old of this.invGrid.removeChildren()) old.destroy({ children: true });
    const inv = invAll();
    const ids = Object.keys(inv).filter((id) => (inv[id] ?? 0) > 0 && cropById(id));
    let total = 0;
    for (const id of ids) {
      const crop = cropById(id);
      if (crop) total += (inv[id] ?? 0) * crop.sellPrice;
    }
    this.invTotalText.text =
      ids.length > 0 ? `${invTotal()} crops · worth ⬡${total}` : 'empty — go harvest! 🌾';
    const cols = 4;
    const dx = 150;
    const dy = 140;
    ids.forEach((id, k) => {
      const crop = cropById(id);
      if (!crop) return;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Container();
      const ring = new Graphics();
      ring
        .roundRect(-64, -60, 128, 120, 18)
        .fill(FARM.panel)
        .roundRect(-64, -60, 128, 120, 18)
        .stroke({ color: RARITY[crop.rarity].color, width: 3 });
      chip.addChild(ring);
      if (crop.emoji) chip.addChild(makeText(crop.emoji, 44));
      else if (crop.drawFruit) {
        const g = new Graphics();
        crop.drawFruit(g, 28);
        chip.addChild(g);
      }
      const count = makeText(`×${inv[id]}`, 22, { color: FARM.ink, weight: '900' });
      count.position.set(0, 30);
      chip.addChild(count);
      const worth = makeText(`⬡${crop.sellPrice}`, 15, {
        color: RARITY[crop.rarity].color,
        weight: '800',
      });
      worth.position.set(0, 50);
      chip.addChild(worth);
      chip.position.set((col - (cols - 1) / 2) * dx, -140 + row * dy);
      this.invGrid.addChild(chip);
    });
  }

  private toggleInventory(): void {
    if (!this.invPanel.visible) this.refreshInventoryPanel();
    this.invPanel.visible = !this.invPanel.visible;
    audio.blip();
  }

  private pickSeed(id: string): void {
    this.selectSeed(id);
    this.seedPanel.visible = false;
  }

  private selectSeed(id: string): void {
    const crop = cropById(id);
    if (!crop) return;
    this.selectedSeed = id;
    this.pouchBtn.setLabel(crop.emoji ?? '🌱');
    audio.blip(1.2);
    this.refreshSeedHighlight();
  }

  private refreshSeedHighlight(): void {
    // Each chip is ringed in its rarity color; the selected one gets a bright
    // accent ring.
    for (const { id, ring } of this.seedChips) {
      ring.clear();
      const sel = id === this.selectedSeed;
      const crop = cropById(id);
      const rc = crop ? RARITY[crop.rarity].color : 0x888888;
      ring
        .circle(0, 0, 46)
        .fill(sel ? 0x3a5a2a : FARM.panel)
        .circle(0, 0, 46)
        .stroke({ color: sel ? FARM.accent : rc, width: sel ? 5 : 3 });
    }
    const crop = cropById(this.selectedSeed);
    if (crop) this.pouchBtn.setLabel(crop.emoji ?? '🌱');
  }

  // ------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.clock += dt;
    this.season = seasonAt(this.clock);
    const weather = this.currentWeather();
    const raining = isWet(weather);

    // Vendor dialogue: choosing "to the market" opens it when the box closes.
    if (this.runner?.currentId === 'go') this.openMarketOnClose = true;

    // Movement (frozen during dialogue).
    if (!this.box.isOpen) {
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
        // Face the way we're walking (only flip on a clear horizontal push).
        if (Math.abs(jx) > 0.3) this.facing = jx > 0 ? 1 : -1;
        this.player.scale.x = this.facing;
        // Walk bob: squash/stretch plus a little side-to-side lean.
        this.walkPhase += dt * 11;
        const s = Math.sin(this.walkPhase) * 0.08;
        this.playerBody.scale.set(1 + s, 1 - s);
        this.playerBody.rotation = Math.sin(this.walkPhase * 0.5) * 0.06;
      } else {
        this.playerBody.scale.set(1, 1);
        this.playerBody.rotation = 0;
      }
    }

    // Growth.
    for (const p of this.plots) {
      if (!p.crop) continue;
      if (raining) p.moisture = Math.min(1, p.moisture + dt * 0.5);
      else p.moisture = Math.max(0, p.moisture - dt * MOISTURE_DECAY);
      const crop = cropById(p.crop);
      if (crop && p.moisture > GROW_MOISTURE && p.growth < 1) {
        p.growth = Math.min(1, p.growth + dt / crop.growSeconds);
      }
    }
    for (let i = 0; i < this.plotViews.length; i++) this.renderPlot(i);

    // Storm: wind ambience, plus lightning flashes with trailing thunder.
    const storm = weather === 'storm';
    ambience.setWind(raining && music.playing);
    if (storm) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) {
        this.boltIn = 3.5 + Math.random() * 6;
        this.flash = 1;
        if (music.playing) {
          // Thunder trails the flash by a beat, like the real thing.
          const th = new Entity();
          th.addBehavior(
            new Timer(0.25 + Math.random() * 0.5, () => {
              ambience.thunder();
              this.remove(th);
            }),
          );
          this.add(th, this.uiLayer);
        }
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);

    // Rotate the gameplay tip every so often.
    this.tipIn -= dt;
    if (this.tipIn <= 0) {
      this.tipIn = 11;
      this.cycleTip();
    }

    this.updateTarget();
    this.updateWeatherText(weather);
    this.drawRain(raining, storm);
    this.camera.update(dt);

    this.saveIn -= dt;
    if (this.saveIn <= 0) {
      this.saveIn = 5;
      this.save();
    }
  }

  /** Find the nearest interactable within range and update the prompt. */
  private updateTarget(): void {
    const px = this.player.x;
    const py = this.player.y;
    let best: Target = null;
    let bestD = INTERACT_RANGE;
    for (let i = 0; i < this.plotViews.length; i++) {
      const v = this.plotViews[i]!;
      const d = Math.hypot(v.x - px, v.y - py);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'plot', i };
      }
    }
    const dv = Math.hypot(this.vendor.x - px, this.vendor.y - py);
    if (dv < bestD) {
      bestD = dv;
      best = { kind: 'vendor' };
    }
    const dg = Math.hypot(this.giftBox.x - px, this.giftBox.y - py);
    if (dg < bestD) {
      bestD = dg;
      best = { kind: 'gift' };
    }
    this.target = best;
    this.vendorBang.visible = best?.kind === 'vendor' && !this.box.isOpen;
    this.drawGiftBox();

    if (!best || this.box.isOpen) {
      this.promptText.visible = false;
      this.interactBtn.alpha = 0.4;
      return;
    }
    this.interactBtn.alpha = 1;
    let label = 'talk';
    let icon = '💬';
    let at = { x: this.vendor.x, y: this.vendor.y - 96 };
    if (best.kind === 'plot') {
      const p = this.plots[best.i]!;
      label = !p.crop ? 'plant' : p.growth >= 1 ? 'harvest' : 'water';
      icon = label === 'plant' ? '🌱' : label === 'water' ? '💧' : '🌾';
      const v = this.plotViews[best.i]!;
      at = { x: v.x, y: v.y - 64 };
    } else if (best.kind === 'gift') {
      const ready = giftReadyInMs() <= 0;
      label = ready ? 'open gift' : 'gift not ready';
      icon = '🎁';
      at = { x: this.giftBox.x, y: this.giftBox.y - 66 };
    }
    this.interactBtn.setLabel(icon);
    this.promptText.text = `tap to ${label}`;
    this.promptText.position.set(at.x, at.y);
    this.promptText.visible = true;
  }

  private performInteract(): void {
    const target = this.target;
    if (this.box.isOpen || !target) return;
    if (target.kind === 'vendor') this.tryTalk();
    else if (target.kind === 'gift') this.claimGiftBox();
    else this.tapPlot(target.i);
  }

  private drawGiftBox(): void {
    const readyMs = giftReadyInMs();
    const ready = readyMs <= 0;
    this.giftGfx.clear();
    const box = ready ? 0xe07a5f : 0x7a6a55;
    const lid = ready ? 0xffb03a : 0x94856d;
    this.giftGfx.roundRect(-20, -10, 40, 34, 5).fill(box);
    this.giftGfx.roundRect(-24, -20, 48, 14, 5).fill(lid);
    this.giftGfx.rect(-4, -20, 8, 44).fill({ color: 0xfff3e2, alpha: 0.85 });
    this.giftGfx.rect(-24, -6, 48, 6).fill({ color: 0xfff3e2, alpha: 0.85 });
    if (ready) {
      this.giftGfx.star(0, -30, 5, 8, 4).fill(0xffe08a);
      this.giftLabel.text = 'free gift!';
    } else {
      this.giftLabel.text = `${Math.ceil(readyMs / 1000)}s`;
    }
  }

  private claimGiftBox(): void {
    if (
      Math.hypot(this.giftBox.x - this.player.x, this.giftBox.y - this.player.y) >
      INTERACT_RANGE + 20
    ) {
      this.toast('walk up to the gift box');
      return;
    }
    const reward = claimGift();
    if (!reward) {
      this.toast(`gift recharges in ${Math.ceil(giftReadyInMs() / 1000)}s`);
      audio.buzz();
      return;
    }
    const crop = cropById(reward.crop);
    audio.chime();
    this.giftPopup(`+${reward.verium} ⬡  ${crop?.emoji ?? '🌱'}`);
    this.updateVeriumText();
    this.updateBasket();
    this.drawGiftBox();
  }

  private giftPopup(text: string): void {
    const e = new Entity();
    e.position.set(this.giftBox.x, this.giftBox.y - 30);
    e.addChild(makeText(text, 26, { color: FARM.coin, weight: '900' }));
    e.addBehavior(new Tween(e, { y: this.giftBox.y - 90, alpha: 0 }, 1, { ease: easings.outQuad }));
    e.addBehavior(new Timer(1.05, () => this.remove(e)));
    this.add(e, this.mapLayer);
  }

  private currentWeather(): Weather {
    return this.forcedWeather ?? weatherAt(this.clock);
  }

  private updateVeriumText(): void {
    this.veriumText.text = `⬡ ${verium.balance()}`;
  }

  private updateBasket(): void {
    const n = invTotal();
    this.basketText.text = n > 0 ? `🧺 ${n}` : '🧺 empty';
  }

  private updateWeatherText(w: Weather): void {
    const label = `${SEASON_ICON[this.season]} ${this.season}  ${WEATHER_ICON[w]}`;
    if (this.weatherText.text !== label) this.weatherText.text = label;
  }

  private drawRain(raining: boolean, storm: boolean): void {
    this.rainLayer.clear();
    if (!raining) return;
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.rainLayer.rect(0, 0, W, H).fill({ color: 0x2a3a4a, alpha: storm ? 0.2 : 0.1 });
    const n = storm ? 60 : 38;
    for (let i = 0; i < n; i++) {
      const x = (i * 137.5 + this.t * 380) % W;
      const y = (i * 91.3 + this.t * 620) % H;
      this.rainLayer
        .moveTo(x, y)
        .lineTo(x - 6, y + 18)
        .stroke({ color: 0x9ecbe0, width: 2, alpha: 0.5 });
    }
    // Lightning: a quick bright wash across the sky.
    if (this.flash > 0) {
      this.rainLayer.rect(0, 0, W, H).fill({ color: 0xdfe8ff, alpha: this.flash * 0.55 });
    }
  }

  // ------------------------------------------------------------ rendering

  private renderPlot(i: number): void {
    const p = this.plots[i];
    const v = this.plotViews[i];
    if (!p || !v) return;
    const s = PLOT_SIZE;
    const crop = cropById(p.crop);

    v.soil.clear();
    if (p.crop) {
      const wet = p.moisture > 0.45;
      const base = wet ? FARM.soilWet : FARM.soil;
      v.soil.roundRect(-s / 2, -s / 2, s, s, 12).fill(base);
      v.soil.roundRect(-s / 2, -s / 2, s, s, 12).stroke({ color: darken(base, 0.3), width: 3 });
      for (let r = 0; r < 3; r++) {
        const yy = -s / 2 + (s * (r + 1)) / 4;
        v.soil
          .moveTo(-s / 2 + 8, yy)
          .lineTo(s / 2 - 8, yy)
          .stroke({ color: darken(base, 0.18), width: 2, alpha: 0.6 });
      }
      if (p.growth < 1 && p.moisture < 0.2) {
        v.soil
          .circle(s / 2 - 16, -s / 2 + 16, 8)
          .fill({ color: 0x6fb0d8, alpha: 0.9 })
          .poly([s / 2 - 16, -s / 2 + 4, s / 2 - 22, -s / 2 + 14, s / 2 - 10, -s / 2 + 14])
          .fill({ color: 0x6fb0d8, alpha: 0.9 });
      }
      if (p.growth >= 1) {
        v.soil.circle(0, -4, s * 0.5).stroke({ color: FARM.accent, width: 3, alpha: 0.7 });
      }
    } else {
      // Empty tilled plot marker.
      v.soil.roundRect(-s / 2, -s / 2, s, s, 12).fill({ color: FARM.soilDark, alpha: 0.85 });
      v.soil
        .roundRect(-s / 2, -s / 2, s, s, 12)
        .stroke({ color: darken(FARM.soilDark, 0.3), width: 2 });
    }

    this.drawPlant(v.leaves, crop, p.growth, s);

    const ripe = !!crop && p.growth >= 1;
    if (ripe && crop && v.fruitCrop !== crop.id) {
      if (v.fruit) {
        v.root.removeChild(v.fruit);
        v.fruit.destroy({ children: true });
      }
      v.fruit = this.makeFruit(crop, s);
      v.root.addChild(v.fruit);
      v.fruitCrop = crop.id;
    } else if (!ripe && v.fruit) {
      v.root.removeChild(v.fruit);
      v.fruit.destroy({ children: true });
      v.fruit = null;
      v.fruitCrop = null;
    }
    if (v.fruit) v.fruit.position.set(0, -s * 0.32 + Math.sin(this.t * 2 + i) * 4);
  }

  private drawPlant(leaves: Graphics, crop: CropDef | undefined, growth: number, s: number): void {
    leaves.clear();
    if (!crop) return;
    if (growth <= 0.03) {
      leaves.ellipse(0, s * 0.14, s * 0.12, s * 0.06).fill(0x4a3320);
      return;
    }
    const g = Math.min(1, growth);
    const h = s * (0.12 + g * 0.42);
    const baseY = s * 0.18;
    leaves
      .moveTo(0, baseY)
      .lineTo(0, baseY - h)
      .stroke({ color: darken(crop.leaf, 0.1), width: Math.max(4, s * 0.03 * (0.6 + g)) });
    const ls = s * (0.06 + g * 0.14);
    leaves.ellipse(-ls * 0.9, baseY - h * 0.45, ls, ls * 0.55).fill(crop.leaf);
    leaves.ellipse(ls * 0.9, baseY - h * 0.7, ls, ls * 0.55).fill(lighten(crop.leaf, 0.08));
    if (g >= 0.55) leaves.ellipse(0, baseY - h, ls * 1.15, ls * 0.7).fill(darken(crop.leaf, 0.05));
  }

  private makeFruit(crop: CropDef, s: number): Container {
    const c = new Container();
    if (crop.drawFruit) {
      const g = new Graphics();
      crop.drawFruit(g, s * 0.32);
      c.addChild(g);
    } else {
      c.addChild(makeText(crop.emoji ?? '•', s * 0.42));
    }
    c.scale.set(0.3);
    const pop = new Entity();
    pop.addBehavior(new Tween(c.scale, { x: 1, y: 1 }, 0.35, { ease: easings.outBack }));
    pop.addBehavior(new Timer(0.4, () => this.remove(pop)));
    this.add(pop, this.uiLayer);
    return c;
  }

  // ------------------------------------------------------------ actions

  private tapPlot(i: number): void {
    const v = this.plotViews[i];
    if (!v) return;
    if (Math.hypot(v.x - this.player.x, v.y - this.player.y) > INTERACT_RANGE + 20) {
      this.toast('walk closer to reach it');
      return;
    }
    const p = this.plots[i];
    if (!p) return;
    if (!p.crop) this.plantAt(i, this.selectedSeed);
    else if (p.growth >= 1) this.harvestAt(i);
    else this.waterAt(i);
  }

  private plantAt(i: number, cropId: string): boolean {
    const p = this.plots[i];
    const crop = cropById(cropId);
    if (!p || !crop || p.crop) return false;
    if (!verium.spend(crop.seedCost)) {
      this.toast('need more ⬡');
      audio.buzz();
      return false;
    }
    p.crop = cropId;
    p.growth = 0;
    p.moisture = 1;
    audio.blip(1.5);
    this.popup(i, '🌱');
    this.updateVeriumText();
    this.renderPlot(i);
    this.save();
    return true;
  }

  private waterAt(i: number): void {
    const p = this.plots[i];
    if (!p || !p.crop) return;
    p.moisture = 1;
    audio.blip(0.7);
    this.popup(i, '💧');
    this.renderPlot(i);
  }

  private waterAll(): void {
    for (const p of this.plots) if (p.crop) p.moisture = 1;
  }

  private harvestAt(i: number): boolean {
    const p = this.plots[i];
    const crop = cropById(p?.crop);
    if (!p || !crop || p.growth < 1) return false;
    invAdd(crop.id, 1);
    this.harvested += 1;
    audio.chime();
    this.popup(i, crop.emoji ?? '🧺');
    p.crop = null;
    p.growth = 0;
    p.moisture = 0;
    this.updateBasket();
    this.renderPlot(i);
    this.save();
    return true;
  }

  // ----------------------------------------------------------- vendor / fx

  private tryTalk(): void {
    if (this.box.isOpen) return;
    if (
      Math.hypot(this.vendor.x - this.player.x, this.vendor.y - this.player.y) >
      INTERACT_RANGE + 30
    ) {
      this.toast('walk up to the vendor');
      return;
    }
    audio.blip();
    this.joystick.visible = false;
    this.seedPanel.visible = false;
    this.openMarketOnClose = false;
    this.runner = new DialogueRunner(VENDOR_DIALOGUE);
    this.runner.start('intro');
    this.box.open(this.runner);
  }

  private goMarket(): void {
    if (this.game.scenes.isTransitioning) return;
    this.save();
    this.game.scenes.replace(new MarketScene());
  }

  private goHome(): void {
    if (this.game.scenes.isTransitioning) return;
    this.save();
    ambience.stop();
    audio.blip(0.9);
    this.game.scenes.replace(new TitleScene());
  }

  private cycleTip(): void {
    this.tipIndex = (this.tipIndex + 1) % TIPS.length;
    this.tipText.text = TIPS[this.tipIndex]!;
  }

  private popup(i: number, text: string): void {
    const v = this.plotViews[i];
    if (!v) return;
    const e = new Entity();
    e.position.set(v.x, v.y - 30);
    e.addChild(makeText(text, 36));
    e.addBehavior(new Tween(e, { y: v.y - 80, alpha: 0 }, 0.7, { ease: easings.outQuad }));
    e.addBehavior(new Timer(0.75, () => this.remove(e)));
    this.add(e, this.mapLayer);
  }

  private toast(msg: string): void {
    this.toastText.text = msg;
    this.toastText.alpha = 1;
    const clear = new Entity();
    clear.addBehavior(new Tween(this.toastText, { alpha: 0 }, 1.6, { ease: easings.inQuad }));
    clear.addBehavior(new Timer(1.7, () => this.remove(clear)));
    this.add(clear, this.uiLayer);
  }

  // -------------------------------------------------------------- save

  private load(): void {
    const saved = store.get<{ c: string | null; g: number; m: number }[] | null>('plots', null);
    if (saved) {
      this.plots = saved.map((s) => ({
        crop: s.c ?? null,
        growth: typeof s.g === 'number' ? s.g : 0,
        moisture: typeof s.m === 'number' ? s.m : 0,
      }));
    }
    this.clock = store.get<number>('clock', 0);
    this.harvested = store.get<number>('harvested', 0);
    this.season = computeWeather(this.clock).season;
  }

  private save(): void {
    store.set(
      'plots',
      this.plots.map((p) => ({ c: p.crop, g: p.growth, m: p.moisture })),
    );
    store.set('clock', this.clock);
    store.set('harvested', this.harvested);
  }
}
