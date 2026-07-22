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
import {
  extraPlotTiles,
  growthMultiplier,
  moistureDecayMultiplier,
  upgradeLevel,
} from '../upgrades.js';
import { currentTheme, themeById } from '../themes.js';
import { activePet, petById } from '../pets.js';
import {
  BUILDS,
  buildAt,
  buildById,
  footprint,
  placeBuild,
  removeBuild,
  savedBuilds,
} from '../build.js';
import type { Placed } from '../build.js';
import {
  accessoryById,
  grantAccessory,
  revokeAccessory,
  tradeableAccessories,
} from '../accessories.js';
import { farmNet } from '../net.js';
import type { Look } from '../net.js';
import { savedAcc, savedHair, savedName, savedSkin, store } from '../store.js';
import { invAdd, invAll, invClear, invCount, invRemove, invTotal } from '../inventory.js';
import { makeCharacter } from '../character.js';
import type { CharType, HairStyle } from '../character.js';
import {
  TILE,
  TILE_SIZE,
  expandedFarmRows,
  farmLegend,
  farmPainters,
  setMapTheme,
} from '../map.js';
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

  // Building
  private buildLayer!: Container;
  private tileView!: Container;
  private mapExpand = 0;
  private mapThemeId = 'meadow';
  private buildBtn!: UIButton;
  private buildPanel!: Container;
  private placing: string | null = null;
  private baseSolid: boolean[][] | null = null;
  private placeMarkers!: Graphics;

  // Pet companion
  private pet: Entity | null = null;
  private petBody: Container | null = null;
  private petPhase = 0;

  // Multiplayer (hosting your farm / visiting a friend's)
  private visiting = false;
  private remotes = new Map<
    string,
    { entity: Entity; body: Container; tx: number; ty: number; walk: number }
  >();
  private codeText!: Text;
  private tradeBtn!: UIButton;
  private sendIn = 0;
  private plotSyncIn = 1;

  // Trade state
  private tradePartner: string | null = null;
  private myOffer: Record<string, number> = {};
  private theirOffer: Record<string, number> = {};
  private iConfirmed = false;
  private theyConfirmed = false;
  private tradePanel!: Container;
  private tradeGrid!: Container;
  private theirText!: Text;
  private confirmBtn!: UIButton;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.visiting = farmNet.visiting();
    if (!this.visiting) this.load();

    setMapTheme(currentTheme());
    this.mapExpand = this.visiting ? 0 : upgradeLevel('expand');
    this.mapThemeId = currentTheme().id;
    this.map = tileMapFromRows(expandedFarmRows(this.mapExpand), TILE_SIZE, farmLegend);
    this.mapLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.mapLayer, this.uiLayer);
    this.tileView = buildTileMapView(this.map, farmPainters);
    this.mapLayer.addChild(this.tileView);

    // Placed buildings render above tiles, below plots/players.
    this.buildLayer = new Container();
    this.mapLayer.addChild(this.buildLayer);
    this.placeMarkers = new Graphics();
    this.mapLayer.addChild(this.placeMarkers);
    if (!this.visiting) this.renderBuilds(savedBuilds());

    // Plots: map 'o' markers + More Land upgrade tiles + built Crop Plots.
    // (Visitors see the HOST's plot list — synced over the net after enter.)
    const plotObjs: { x: number; y: number }[] = this.map.objects
      .filter((o) => o.name === 'plot')
      .map((o) => ({ x: o.x, y: o.y }));
    if (!this.visiting) {
      for (const t of extraPlotTiles())
        plotObjs.push({ x: (t.col + 0.5) * TILE_SIZE, y: (t.row + 0.5) * TILE_SIZE });
      for (const b of savedBuilds())
        if (b.id === 'plot')
          plotObjs.push({ x: (b.col + 0.5) * TILE_SIZE, y: (b.row + 0.5) * TILE_SIZE });
    }
    if (this.plots.length !== plotObjs.length) {
      this.plots = plotObjs.map(() => ({ crop: null, growth: 0, moisture: 0 }));
    }
    plotObjs.forEach((o) => {
      const root = new Entity();
      root.position.set(o.x, o.y);
      const soil = new Graphics();
      const leaves = new Graphics();
      root.addChild(soil, leaves);
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
    this.add(this.giftBox, this.mapLayer);
    this.drawGiftBox();

    // Player.
    const spawn = this.map.objects.find((o) => o.name === 'player') ?? { x: 544, y: 672 };
    const charType = store.get<CharType>('charType', 'blob');
    const charColor = store.get<number>('charColor', 0xe07a5f);
    this.player = new Entity();
    const pChar = makeCharacter(
      charType,
      charColor,
      30,
      5,
      savedAcc(),
      savedSkin(),
      savedHair() as HairStyle,
    );
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

    // Dynamic joystick: slide anywhere to walk. It listens on the STAGE via
    // bubbled events, so taps still reach plots, NPCs, buttons — walking and
    // tapping coexist. Also used for build-mode tile taps.
    this.stage.eventMode = 'static';
    this.stage.hitArea = { contains: () => true };
    this.joystick = new VirtualJoystick({ radius: 70, dynamic: true, tapThreshold: 14 });
    this.joystick.listen(this.stage);
    this.add(this.joystick, this.uiLayer);
    // Tap resolver: a press that barely moves is a TAP. We resolve it against
    // the WORLD ourselves (nearest plot/vendor/gift to the press point) instead
    // of relying on display-object hit testing, which breaks the moment the
    // camera shifts beneath the finger.
    let tapDown = { x: 0, y: 0 };
    let tapOnUi = false;
    this.stage.on('pointerdown', (e) => {
      tapDown = { x: e.global.x, y: e.global.y };
      let n = e.target as Container | null;
      tapOnUi = false;
      while (n) {
        if (n === this.uiLayer) {
          tapOnUi = true;
          break;
        }
        n = n.parent;
      }
    });
    this.stage.on('pointerup', (e) => {
      if (Math.hypot(e.global.x - tapDown.x, e.global.y - tapDown.y) > 14) return;
      if (tapOnUi) return; // buttons/panels handle their own taps
      if (this.placing) {
        this.placeAtPointer(tapDown.x, tapDown.y);
        return;
      }
      this.resolveWorldTap(tapDown.x, tapDown.y);
    });

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

    // Build mode (your own farm only) + trade (only with company).
    this.buildBtn = new UIButton('🔨', {
      width: 100,
      height: 88,
      fontSize: 38,
      fill: FARM.panel,
      onTap: () => this.toggleBuildPanel(),
    });
    this.buildBtn.visible = !this.visiting;
    this.add(this.buildBtn, this.uiLayer);
    this.tradeBtn = new UIButton('🤝', {
      width: 100,
      height: 88,
      fontSize: 38,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.startTrade(),
    });
    this.tradeBtn.visible = !!farmNet.session();
    this.add(this.tradeBtn, this.uiLayer);
    this.codeText = makeText('', 22, { color: FARM.accent, weight: '900' });
    this.uiLayer.addChild(this.codeText);
    const sess = farmNet.session();
    if (sess)
      this.codeText.text = this.visiting
        ? `visiting ${sess.code}`
        : `farm ${sess.code} — share it!`;

    this.buildSeedPanel();
    this.buildInventoryPanel();
    this.buildBuildPanel();
    this.buildTradePanel();

    // Pet companion trots along behind you.
    this.spawnPet();

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
      // Multiplayer + trade
      code: () => farmNet.session()?.code ?? '',
      remoteIds: () => [...this.remotes.keys()],
      startTrade: () => this.startTrade(),
      offerItem: (id: string) => this.toggleOfferItem(id),
      confirmTrade: () => this.confirmTrade(),
      tradeOpen: () => this.tradePartner !== null,
      isVisiting: () => this.visiting,
      // Building + pets
      buildStart: (id: string) => {
        this.placing = id;
        this.buildBtn.setLabel('✕');
      },
      placingId: () => this.placing,
      cancelBuild: () => this.cancelPlacing(),
      removeAt: (col: number, row: number) => this.doRemove(col, row),
      plotScreen: (i: number) => {
        const v = this.plotViews[i];
        if (!v) return null;
        const g = this.mapLayer.toGlobal({ x: v.x, y: v.y });
        return { x: g.x, y: g.y };
      },
      placeAt: (col: number, row: number) => this.tryPlace(col, row),
      buildCount: () => savedBuilds().length,
      petActive: () => activePet(),
    };

    // Multiplayer wiring — hosting your farm or visiting a friend's.
    if (farmNet.session()) this.setupNet();
  }

  protected override onExit(): void {
    this.save();
    ambience.stop();
    // Detach the net handler slots (the session itself survives — travelling
    // to the market keeps your farm open).
    farmNet.onMsg = farmNet.onJoin = farmNet.onLeave = null;
    farmNet.onClose = null;
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
    this.codeText.position.set(W / 2, 74);
    this.tipText.position.set(W / 2, H - 26);
    this.interactBtn.position.set(W - 100, H - 120);
    this.pouchBtn.position.set(W - 100, H - 250);
    this.invBtn.position.set(W - 100, H - 350);
    this.buildBtn.position.set(W - 100, H - 450);
    this.tradeBtn.position.set(W - 100, H - 550);
    this.seedPanel.position.set(W / 2, H - 360);
    this.invPanel.position.set(W / 2, H / 2);
    this.buildPanel.position.set(W / 2, H / 2);
    this.tradePanel.position.set(W / 2, H / 2);
    this.tradePanel.scale.set(Math.min(1, (H - 40) / 620, (W - 20) / 680));
    this.invPanel.scale.set(Math.min(1, (H - 40) / 620, (W - 20) / 680));
    this.buildPanel.scale.set(Math.min(1, (H - 40) / 660, (W - 20) / 680));
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
    close.position.set(0, 282);
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

    // Growth (Sprinklers slow moisture loss; Rich Soil speeds growth).
    const decay = MOISTURE_DECAY * moistureDecayMultiplier();
    const grow = growthMultiplier();
    for (const p of this.plots) {
      if (!p.crop) continue;
      if (raining) p.moisture = Math.min(1, p.moisture + dt * 0.5);
      else p.moisture = Math.max(0, p.moisture - dt * decay);
      const crop = cropById(p.crop);
      if (crop && p.moisture > GROW_MOISTURE && p.growth < 1) {
        p.growth = Math.min(1, p.growth + (dt / crop.growSeconds) * grow);
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
    this.updatePet(dt);
    this.updatePlaceMarkers();

    // Multiplayer sync: positions at 10Hz, host farm-state at 1Hz.
    const sess = farmNet.session();
    if (sess) {
      this.sendIn -= dt;
      if (this.sendIn <= 0) {
        this.sendIn = 0.1;
        if (sess.isHost) this.sendPositions();
        else sess.send({ type: 'pos', x: this.player.x, y: this.player.y });
      }
      if (sess.isHost && this.remotes.size > 0) {
        this.plotSyncIn -= dt;
        if (this.plotSyncIn <= 0) {
          this.plotSyncIn = 1;
          this.broadcastFarm();
        }
      }
      for (const r of this.remotes.values()) {
        const dx = r.tx - r.entity.x;
        const dy = r.ty - r.entity.y;
        r.entity.position.set(
          r.entity.x + dx * Math.min(1, dt * 12),
          r.entity.y + dy * Math.min(1, dt * 12),
        );
        if (Math.hypot(dx, dy) > 1) {
          r.walk += dt * 11;
          const s = Math.sin(r.walk) * 0.08;
          r.body.scale.set(1 + s, 1 - s);
        } else r.body.scale.set(1, 1);
      }
    }

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

  /**
   * A screen tap resolved directly against the world: find the nearest
   * interactable to the tapped point and use it if the player is in range.
   * (Tap-near-something = interact; drag = walk — they never fight.)
   */
  private resolveWorldTap(gx: number, gy: number): void {
    if (this.box.isOpen) return;
    if (this.seedPanel.visible || this.invPanel.visible || this.buildPanel.visible) return;
    if (this.tradePanel.visible) return;
    const w = this.mapLayer.toLocal({ x: gx, y: gy });
    let best: Target = null;
    let bestD = PLOT_SIZE; // how close the TAP must be to the thing itself
    for (let i = 0; i < this.plotViews.length; i++) {
      const v = this.plotViews[i]!;
      const d = Math.hypot(v.x - w.x, v.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'plot', i };
      }
    }
    const dv = Math.hypot(this.vendor.x - w.x, this.vendor.y - (w.y + 30));
    if (dv < Math.max(bestD, 80)) best = { kind: 'vendor' };
    const dg = Math.hypot(this.giftBox.x - w.x, this.giftBox.y - w.y);
    if (dg < Math.min(bestD, 70)) best = { kind: 'gift' };
    if (!best) return;
    if (best.kind === 'vendor') this.tryTalk();
    else if (best.kind === 'gift') this.claimGiftBox();
    else this.tapPlot(best.i);
  }

  private tapPlot(i: number): void {
    if (this.placing) return; // build-mode taps place structures instead
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
    // Visitors helped plant on the host's farm — tell the host.
    if (this.visiting)
      farmNet.session()?.send({ type: 'plot-act', kind: 'plant', i, crop: cropId });
    else this.save();
    return true;
  }

  private waterAt(i: number): void {
    const p = this.plots[i];
    if (!p || !p.crop) return;
    p.moisture = 1;
    audio.blip(0.7);
    this.popup(i, '💧');
    this.renderPlot(i);
    if (this.visiting) farmNet.session()?.send({ type: 'plot-act', kind: 'water', i });
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
    if (this.visiting) farmNet.session()?.send({ type: 'plot-act', kind: 'harvest', i });
    else this.save();
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
    // Going home ends the multiplayer session (host closes the room).
    farmNet.leave();
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
    // A visitor is walking someone ELSE's farm — never write their plots
    // over your own save.
    if (this.visiting) return;
    store.set(
      'plots',
      this.plots.map((p) => ({ c: p.crop, g: p.growth, m: p.moisture })),
    );
    store.set('clock', this.clock);
    store.set('harvested', this.harvested);
  }

  // ------------------------------------------------------------- building

  private renderBuilds(list: Placed[]): void {
    for (const old of this.buildLayer.removeChildren()) old.destroy({ children: true });
    const theme = currentTheme();
    const s = TILE_SIZE;

    // Streams first (under bridges): each tile flows into neighboring stream
    // tiles and into the map's own water, so placed runs read as one river.
    const streamSet = new Set(
      list.filter((b) => b.id === 'stream').map((b) => `${b.col},${b.row}`),
    );
    const wet = (c: number, r: number): boolean =>
      streamSet.has(`${c},${r}`) || this.map.ground[r]?.[c] === TILE.WATER;
    // Full-bleed water: stream tiles fill their whole tile and flow
    // seamlessly into neighbors, so a run reads as one wide river.
    const water = new Graphics();
    for (const b of list) {
      if (b.id !== 'stream') continue;
      const x = b.col * s;
      const y = b.row * s;
      water.roundRect(x + 1, y + 1, s - 2, s - 2, 14).fill(darken(theme.water, 0.12));
      water.roundRect(x + 4, y + 4, s - 8, s - 8, 10).fill(theme.water);
      if (wet(b.col - 1, b.row)) water.rect(x, y + 4, 6, s - 8).fill(theme.water);
      if (wet(b.col + 1, b.row)) water.rect(x + s - 6, y + 4, 6, s - 8).fill(theme.water);
      if (wet(b.col, b.row - 1)) water.rect(x + 4, y, s - 8, 6).fill(theme.water);
      if (wet(b.col, b.row + 1)) water.rect(x + 4, y + s - 6, s - 8, 6).fill(theme.water);
      water
        .ellipse(x + s * 0.38, y + s * 0.42, 8, 3)
        .fill({ color: lighten(theme.water, 0.25), alpha: 0.7 });
      water
        .ellipse(x + s * 0.66, y + s * 0.7, 6, 2.5)
        .fill({ color: lighten(theme.water, 0.2), alpha: 0.6 });
    }
    this.buildLayer.addChild(water);

    // Per-item art scale (in tiles) — ponds and the farmhouse read as big
    // landmarks, bridges and fences stay tile-sized.
    const ART_TILES: Record<string, number> = { pond: 2.9, shed: 2.3, bridge: 1.25, fence: 1.2 };
    for (const b of list) {
      const def = buildById(b.id);
      if (!def || b.id === 'plot' || b.id === 'stream') continue;
      const view = def.draw(TILE_SIZE * (ART_TILES[b.id] ?? 1.2), {
        water: theme.water,
        trunk: theme.trunk,
      });
      // Center the art on the placement's FOOTPRINT (the pond is 2×2).
      view.position.set(
        (b.col + (def.w ?? 1) / 2) * TILE_SIZE,
        (b.row + (def.h ?? 1) / 2) * TILE_SIZE,
      );
      this.buildLayer.addChild(view);
    }

    // Collision: streams are real water (you can't walk through them), and a
    // bridge on a stream tile makes it crossable again.
    if (!this.baseSolid) this.baseSolid = this.map.solid.map((r) => [...r]);
    this.map.solid = this.baseSolid.map((r) => [...r]);
    for (const b of list) {
      if (b.id !== 'stream' && b.id !== 'pond') continue;
      for (const t of footprint(b)) {
        if (this.map.solid[t.row]) this.map.solid[t.row]![t.col] = true;
      }
    }
    for (const b of list) if (b.id === 'bridge') this.map.solid[b.row]![b.col] = false;
  }

  private buildBuildPanel(): void {
    this.buildPanel = new Container();
    this.buildPanel.visible = false;
    const bg = new Graphics();
    bg.roundRect(-330, -320, 660, 640, 26).fill(0x2a2016);
    bg.roundRect(-330, -320, 660, 640, 26).stroke({ color: FARM.accent, width: 3 });
    this.buildPanel.addChild(bg);
    const title = makeText('🔨 Build — pick, then tap a tile', 26, {
      color: FARM.accent,
      weight: '900',
    });
    title.position.set(0, -282);
    this.buildPanel.addChild(title);
    BUILDS.forEach((b, i) => {
      const btn = new UIButton(`${b.emoji} ${b.name} — ⬡${b.cost}`, {
        width: 560,
        height: 62,
        fontSize: 23,
        fill: FARM.panel,
        textColor: FARM.ink,
        onTap: () => {
          this.placing = b.id;
          this.buildBtn.setLabel('✕');
          this.buildPanel.visible = false;
          this.toast(`tap a grassy tile to place it — or ✕ to cancel`);
          audio.blip(1.2);
        },
      });
      btn.position.set(0, -222 + i * 72);
      this.add(btn, this.buildPanel);
    });
    const removeBtn = new UIButton('🧹 Remove — half cost back', {
      width: 560,
      height: 62,
      fontSize: 23,
      fill: 0x6e3a3a,
      textColor: FARM.ink,
      onTap: () => {
        this.placing = 'remove';
        this.buildBtn.setLabel('✕');
        this.buildPanel.visible = false;
        this.toast('tap a glowing red tile to remove it — or ✕ to cancel');
        audio.blip(1.2);
      },
    });
    removeBtn.position.set(0, -222 + BUILDS.length * 72);
    this.add(removeBtn, this.buildPanel);
    const close = new UIButton('✕ close', {
      width: 190,
      height: 60,
      fontSize: 24,
      fill: 0x5a4632,
      textColor: FARM.ink,
      onTap: () => this.toggleBuildPanel(),
    });
    close.position.set(0, 282);
    this.add(close, this.buildPanel);
    this.uiLayer.addChild(this.buildPanel);
  }

  private toggleBuildPanel(): void {
    if (this.visiting) return;
    // While placing, the 🔨 button shows ✕ and tapping it cancels the mode.
    if (this.placing) {
      this.cancelPlacing('build cancelled');
      audio.blip(0.8);
      return;
    }
    this.buildPanel.visible = !this.buildPanel.visible;
    audio.blip();
  }

  private placeAtPointer(gx: number, gy: number): void {
    const p = this.mapLayer.toLocal({ x: gx, y: gy });
    const col = Math.floor(p.x / TILE_SIZE);
    const row = Math.floor(p.y / TILE_SIZE);
    // Placement is deliberate: only the glowing tiles NEXT TO the player are
    // selectable, so you walk to where you want the thing and pick a side.
    if (!this.adjacentTargets().some((t) => t.col === col && t.row === row)) {
      this.toast('tap a glowing tile next to you');
      audio.buzz();
      return;
    }
    this.tryPlace(col, row);
  }

  /** The 8 tiles around the player that the current build/remove can use. */
  private adjacentTargets(): { col: number; row: number }[] {
    const id = this.placing;
    if (!id) return [];
    const pc = Math.floor(this.player.x / TILE_SIZE);
    const pr = Math.floor(this.player.y / TILE_SIZE);
    const out: { col: number; row: number }[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const col = pc + dx;
      const row = pr + dy;
      if (id === 'remove' ? buildAt(col, row) !== null : this.canPlaceAt(id, col, row)) {
        out.push({ col, row });
      }
    }
    return out;
  }

  /** Tile-validity for a build (no adjacency — the markers add that). */
  private canPlaceAt(id: string, col: number, row: number): boolean {
    const def = buildById(id);
    if (!def) return false;
    const pc = Math.floor(this.player.x / TILE_SIZE);
    const pr = Math.floor(this.player.y / TILE_SIZE);
    for (const t of footprint({ id, col, row })) {
      const base = this.baseSolid?.[t.row]?.[t.col];
      const onGroundWater = this.map.ground[t.row]?.[t.col] === TILE.WATER;
      const existing = buildAt(t.col, t.row);
      const waterBuild = existing && (existing.id === 'stream' || existing.id === 'pond');
      if (id === 'bridge') {
        // Bridges span water (built streams/ponds or the map's own lake) or
        // sit on open grass; anything else is out.
        const openGrass = base === false && !existing;
        if (!(onGroundWater || waterBuild || openGrass)) return false;
      } else {
        if (base !== false) return false;
        if (existing) return false;
        // Water can't flood the tile the player stands on.
        if ((id === 'stream' || id === 'pond') && t.col === pc && t.row === pr) return false;
      }
      // Never build over a crop plot.
      const px = (t.col + 0.5) * TILE_SIZE;
      const py = (t.row + 0.5) * TILE_SIZE;
      if (this.plotViews.some((v) => Math.abs(v.x - px) < 1 && Math.abs(v.y - py) < 1))
        return false;
    }
    return true;
  }

  /** Glowing selectable tiles around the player while placing/removing. */
  private updatePlaceMarkers(): void {
    this.placeMarkers.clear();
    if (!this.placing || this.visiting) return;
    const pulse = 0.35 + Math.sin(this.t * 5) * 0.15;
    const removing = this.placing === 'remove';
    for (const t of this.adjacentTargets()) {
      const x = t.col * TILE_SIZE;
      const y = t.row * TILE_SIZE;
      this.placeMarkers
        .roundRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10)
        .fill({ color: removing ? 0xff5470 : 0x8fd06a, alpha: pulse * 0.5 })
        .roundRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8, 10)
        .stroke({ color: removing ? 0xff8fa0 : 0xd9ffb0, width: 3, alpha: pulse + 0.3 });
    }
  }

  /** Deconstruct whatever covers the tile — half the cost comes back. */
  private doRemove(col: number, row: number): boolean {
    const removed = removeBuild(col, row);
    if (!removed) {
      this.toast('nothing to remove there');
      audio.buzz();
      return false;
    }
    const def = buildById(removed.id);
    this.cancelPlacing();
    audio.chime();
    this.updateVeriumText();
    if (removed.id === 'plot') {
      // Retire the live plot too (any crop on it is lost).
      const x = (removed.col + 0.5) * TILE_SIZE;
      const y = (removed.row + 0.5) * TILE_SIZE;
      const idx = this.plotViews.findIndex((v) => Math.abs(v.x - x) < 1 && Math.abs(v.y - y) < 1);
      if (idx >= 0) {
        const [v] = this.plotViews.splice(idx, 1);
        if (v) this.remove(v.root);
        this.plots.splice(idx, 1);
      }
    }
    this.renderBuilds(savedBuilds());
    this.save();
    this.toast(`${def?.emoji ?? '🧹'} removed — +⬡${def ? Math.ceil(def.cost / 2) : 0} back`);
    return true;
  }

  /** Leave build-placing mode (taps go back to farming). */
  private cancelPlacing(msg?: string): void {
    this.placing = null;
    this.buildBtn.setLabel('🔨');
    this.placeMarkers?.clear();
    if (msg) this.toast(msg);
  }

  private tryPlace(col: number, row: number): boolean {
    const id = this.placing;
    if (!id || this.visiting) return false;
    if (id === 'remove') return this.doRemove(col, row);
    const def = buildById(id);
    if (!def) return false;
    // An invalid tile keeps build mode alive (the glowing markers show where
    // it CAN go); only running out of Verium cancels it.
    if (!this.canPlaceAt(id, col, row)) {
      this.toast('tap a glowing tile next to you');
      audio.buzz();
      return false;
    }
    if (!placeBuild(id, col, row)) {
      this.cancelPlacing(`needs ⬡${def.cost} — build cancelled`);
      audio.buzz();
      return false;
    }
    this.cancelPlacing();
    audio.chime();
    this.updateVeriumText();
    this.renderBuilds(savedBuilds());
    if (id === 'plot') {
      // A new working plot, live immediately.
      const x = (col + 0.5) * TILE_SIZE;
      const y = (row + 0.5) * TILE_SIZE;
      this.plots.push({ crop: null, growth: 0, moisture: 0 });
      const root = new Entity();
      root.position.set(x, y);
      const soil = new Graphics();
      const leaves = new Graphics();
      root.addChild(soil, leaves);
      const idx = this.plotViews.length;
      this.add(root, this.mapLayer);
      this.plotViews.push({ root, soil, leaves, fruit: null, fruitCrop: null, x, y });
      this.renderPlot(idx);
      this.save();
    }
    this.toast(`${def.emoji} placed!`);
    return true;
  }

  // ------------------------------------------------------------- pet

  private spawnPet(): void {
    const id = activePet();
    const def = petById(id);
    if (!def) return;
    this.pet = new Entity();
    const body = new Container();
    body.addChild(def.draw(18));
    this.pet.addChild(body);
    this.petBody = body;
    this.pet.position.set(this.player.x - 46, this.player.y + 18);
    this.add(this.pet, this.mapLayer);
  }

  private updatePet(dt: number): void {
    if (!this.pet || !this.petBody) return;
    const tx = this.player.x - 46 * this.facing;
    const ty = this.player.y + 18;
    const dx = tx - this.pet.x;
    const dy = ty - this.pet.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) {
      const k = Math.min(1, dt * 5);
      this.pet.position.set(this.pet.x + dx * k, this.pet.y + dy * k);
      this.petPhase += dt * 10;
      const s = Math.sin(this.petPhase) * 0.1;
      this.petBody.scale.set(1 + s, 1 - s);
      if (Math.abs(dx) > 4) this.pet.scale.x = dx > 0 ? 1 : -1;
    } else {
      this.petBody.scale.set(1, 1);
    }
  }

  // ------------------------------------------------------------- multiplayer

  private setupNet(): void {
    const sess = farmNet.session();
    if (!sess) return;
    // Spawn everyone already here, with their real look.
    for (const p of sess.players) if (p.id !== sess.id) this.spawnRemote(p.id);
    farmNet.onJoin = (id) => {
      this.spawnRemote(id);
      if (sess.isHost) {
        this.toast(`${farmNet.looks.get(id)?.n ?? 'a friend'} dropped by! 👋`);
        this.broadcastFarm();
      }
    };
    farmNet.onLeave = (id) => {
      const r = this.remotes.get(id);
      if (r) {
        this.remove(r.entity);
        this.remotes.delete(id);
      }
      if (this.tradePartner === id) this.closeTrade();
    };
    farmNet.onClose = (reason) => {
      this.toast(`disconnected: ${reason}`);
      this.visiting = false;
      this.tradeBtn.visible = false;
      this.codeText.text = '';
      for (const r of this.remotes.values()) this.remove(r.entity);
      this.remotes.clear();
    };
    farmNet.onMsg = (from, data) => this.onNet(from, data);
    // Visitors ask the host for the farm's current state.
    if (this.visiting) sess.send({ type: 'farm-req' });
  }

  private spawnRemote(id: string): void {
    if (this.remotes.has(id)) return;
    const look: Look = farmNet.looks.get(id) ?? {
      t: 'blob',
      c: 0x6fb0d8,
      s: 0xf0c08a,
      a: 'none',
      n: 'Friend',
    };
    const entity = new Entity();
    const char = makeCharacter(
      look.t,
      look.c,
      30,
      id.length + 3,
      look.a,
      look.s,
      look.h ?? 'short',
    );
    entity.addChild(char.view);
    const label = makeText(look.n, 18, { color: FARM.ink, weight: '800' });
    label.position.set(0, -58);
    entity.addChild(label);
    const spawn = this.map.objects.find((o) => o.name === 'player') ?? { x: 544, y: 672 };
    entity.position.set(spawn.x + 60, spawn.y);
    this.add(entity, this.mapLayer);
    this.remotes.set(id, { entity, body: char.body, tx: spawn.x + 60, ty: spawn.y, walk: 0 });
  }

  /** Rebuild a remote's avatar when their look arrives late. */
  private refreshRemoteLooks(): void {
    for (const [id, r] of this.remotes) {
      const look = farmNet.looks.get(id);
      if (!look) continue;
      const label = r.entity.children.at(-1);
      if (label && 'text' in label && (label as Text).text !== look.n) {
        const { x, y } = r.entity;
        this.remove(r.entity);
        this.remotes.delete(id);
        this.spawnRemote(id);
        const nr = this.remotes.get(id);
        if (nr) {
          nr.entity.position.set(x, y);
          nr.tx = x;
          nr.ty = y;
        }
      }
    }
  }

  /** Host → everyone: the farm's plots (positions + state). */
  private broadcastFarm(): void {
    const sess = farmNet.session();
    if (!sess || !sess.isHost) return;
    sess.broadcast({
      type: 'farm',
      spots: this.plotViews.map((v) => ({ x: v.x, y: v.y })),
      plots: this.plots.map((p) => ({ c: p.crop, g: p.growth, m: p.moisture })),
      builds: savedBuilds(),
      expand: upgradeLevel('expand'),
      theme: currentTheme().id,
    });
  }

  /** Visitor: rebuild the tile world to the host's map size + theme. */
  private rebuildMap(expand: number, theme: string): void {
    if (expand === this.mapExpand && theme === this.mapThemeId) return;
    this.mapExpand = expand;
    this.mapThemeId = theme;
    setMapTheme(themeById(theme));
    this.map = tileMapFromRows(expandedFarmRows(expand), TILE_SIZE, farmLegend);
    const idx = this.mapLayer.getChildIndex(this.tileView);
    this.tileView.destroy({ children: true });
    this.tileView = buildTileMapView(this.map, farmPainters);
    this.mapLayer.addChildAt(this.tileView, idx);
    this.baseSolid = null;
    this.camera.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
  }

  /** Visitor: adopt the host's plots/builds wholesale. */
  private applyFarm(
    spots: { x: number; y: number }[],
    plots: { c: string | null; g: number; m: number }[],
    builds: Placed[],
    expand: number,
    theme: string,
  ): void {
    if (!this.visiting) return;
    // Match the host's map size + theme before laying anything on it.
    this.rebuildMap(expand, theme);
    // Rebuild plot views to match the host's layout.
    for (const v of this.plotViews) this.remove(v.root);
    this.plotViews = [];
    this.plots = plots.map((p) => ({ crop: p.c, growth: p.g, moisture: p.m }));
    spots.forEach((o, i) => {
      const root = new Entity();
      root.position.set(o.x, o.y);
      const soil = new Graphics();
      const leaves = new Graphics();
      root.addChild(soil, leaves);
      this.add(root, this.mapLayer);
      this.plotViews.push({ root, soil, leaves, fruit: null, fruitCrop: null, x: o.x, y: o.y });
      this.renderPlot(i);
    });
    this.renderBuilds(builds);
  }

  private onNet(from: string, data: unknown): void {
    const sess = farmNet.session();
    if (!sess) return;
    const msg = data as Record<string, unknown> | null;
    if (!msg || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'look':
      case 'looks':
        this.refreshRemoteLooks();
        return;
      case 'pos': {
        const r = this.remotes.get(from);
        if (r) {
          r.tx = Number(msg.x);
          r.ty = Number(msg.y);
        }
        // The host relays everyone's positions.
        if (sess.isHost) {
          this.sendPositions();
        }
        return;
      }
      case 'snap': {
        const pos = msg.pos as Record<string, { x: number; y: number }>;
        for (const [id, p] of Object.entries(pos)) {
          if (id === sess.id) continue;
          const r = this.remotes.get(id);
          if (r) {
            r.tx = p.x;
            r.ty = p.y;
          }
        }
        return;
      }
      case 'farm-req':
        if (sess.isHost) this.broadcastFarm();
        return;
      case 'farm':
        this.applyFarm(
          (msg.spots as { x: number; y: number }[]) ?? [],
          (msg.plots as { c: string | null; g: number; m: number }[]) ?? [],
          (msg.builds as Placed[]) ?? [],
          Number(msg.expand ?? 0),
          typeof msg.theme === 'string' ? msg.theme : 'meadow',
        );
        return;
      case 'plot-act': {
        // A visitor farmed one of our plots — apply it (no wallet/basket
        // effects here; those happened on the visitor's device).
        if (!sess.isHost) return;
        const i = Number(msg.i);
        const p = this.plots[i];
        if (!p) return;
        if (msg.kind === 'water' && p.crop) p.moisture = 1;
        else if (msg.kind === 'plant' && !p.crop && typeof msg.crop === 'string') {
          p.crop = msg.crop;
          p.growth = 0;
          p.moisture = 1;
        } else if (msg.kind === 'harvest' && p.crop && p.growth >= 1) {
          p.crop = null;
          p.growth = 0;
          p.moisture = 0;
        }
        this.renderPlot(i);
        this.save();
        this.broadcastFarm();
        return;
      }
      case 'trade-req':
        if (!this.tradePartner) {
          this.openTradeWith(from);
          this.toast('trade started 🤝');
        }
        return;
      case 'trade-offer':
        if (from === this.tradePartner) {
          this.theirOffer = (msg.items as Record<string, number>) ?? {};
          this.theyConfirmed = false;
          this.refreshTradePanel();
        }
        return;
      case 'trade-confirm':
        if (from === this.tradePartner) {
          this.theyConfirmed = true;
          this.refreshTradePanel();
          this.trySettle();
        }
        return;
      case 'trade-cancel':
        if (from === this.tradePartner) {
          this.toast('trade cancelled');
          this.closeTrade();
        }
        return;
      case 'trade-exec':
        this.applySwap(
          (msg.give as Record<string, number>) ?? {},
          (msg.get as Record<string, number>) ?? {},
        );
        this.toast('trade complete! ✅');
        this.closeTrade();
        return;
      default:
        return;
    }
  }

  private sendPositions(): void {
    const sess = farmNet.session();
    if (!sess) return;
    const pos: Record<string, { x: number; y: number }> = {
      [sess.id]: { x: this.player.x, y: this.player.y },
    };
    for (const [id, r] of this.remotes) pos[id] = { x: r.tx, y: r.ty };
    sess.broadcast({ type: 'snap', pos });
  }

  // ------------------------------------------------------------- trade

  private nearestPartner(): string | null {
    let best: string | null = null;
    let bestD = 220;
    for (const [id, r] of this.remotes) {
      const d = Math.hypot(r.entity.x - this.player.x, r.entity.y - this.player.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private startTrade(): void {
    if (!farmNet.session() || this.tradePartner) return;
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

  /** Toggle a crop (id) or accessory ('acc:<id>') in my offer. */
  private toggleOfferItem(id: string): void {
    if (!this.tradePartner || this.iConfirmed) return;
    if (id.startsWith('acc:')) {
      if (this.myOffer[id]) delete this.myOffer[id];
      else this.myOffer[id] = 1;
    } else {
      const have = invCount(id);
      const cur = this.myOffer[id] ?? 0;
      if (cur < have) this.myOffer[id] = cur + 1;
      else delete this.myOffer[id];
    }
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

  /** The host settles once both sides confirmed. */
  private trySettle(): void {
    const sess = farmNet.session();
    if (!sess || !sess.isHost || !this.tradePartner) return;
    if (!this.iConfirmed || !this.theyConfirmed) return;
    for (const [id, n] of Object.entries(this.myOffer)) {
      if (!id.startsWith('acc:') && invCount(id) < n) {
        this.sendToPartner(this.tradePartner, { type: 'trade-cancel' });
        this.toast('trade failed — not enough crops');
        this.closeTrade();
        return;
      }
    }
    sess.sendTo(this.tradePartner, {
      type: 'trade-exec',
      give: this.theirOffer,
      get: this.myOffer,
    });
    this.applySwap(this.myOffer, this.theirOffer);
    this.toast('trade complete! ✅');
    this.closeTrade();
  }

  /** Remove what we gave, add what we got (crops and accessories). */
  private applySwap(give: Record<string, number>, get: Record<string, number>): void {
    for (const [id, n] of Object.entries(give)) {
      if (id.startsWith('acc:')) revokeAccessory(id.slice(4));
      else invRemove(id, n);
    }
    for (const [id, n] of Object.entries(get)) {
      if (id.startsWith('acc:')) grantAccessory(id.slice(4));
      else invAdd(id, n);
    }
    this.updateBasket();
  }

  private sendToPartner(id: string, data: Record<string, unknown>): void {
    const sess = farmNet.session();
    if (!sess) return;
    if (sess.isHost) sess.sendTo(id, data);
    else sess.send(data);
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
    const title = makeText('🤝 Trade — tap crops & hats to offer', 24, {
      color: FARM.accent,
      weight: '900',
    });
    title.position.set(0, -262);
    this.tradePanel.addChild(title);
    this.theirText = makeText('', 20, { color: FARM.inkSoft, weight: '800' });
    this.theirText.position.set(0, -220);
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
      .map(([id, n]) =>
        id.startsWith('acc:')
          ? accessoryById(id.slice(4)).emoji
          : `${cropById(id)?.emoji ?? id}×${n}`,
      )
      .join('  ');
    this.theirText.text = `they offer: ${theirs || '—'}${this.theyConfirmed ? '  ✅' : ''}`;
    this.confirmBtn.setLabel(this.iConfirmed ? 'CONFIRMED ✅' : 'CONFIRM');

    const inv = invAll();
    const items: {
      key: string;
      emoji?: string | undefined;
      draw?: ((g: Graphics) => void) | undefined;
      sub: string;
    }[] = [];
    for (const c of CROPS) {
      if ((inv[c.id] ?? 0) > 0)
        items.push({
          key: c.id,
          emoji: c.emoji,
          draw: c.drawFruit ? (g): void => c.drawFruit!(g, 24) : undefined,
          sub: `${this.myOffer[c.id] ?? 0}/${inv[c.id]}`,
        });
    }
    for (const a of tradeableAccessories()) {
      items.push({
        key: `acc:${a}`,
        emoji: accessoryById(a).emoji,
        sub: this.myOffer[`acc:${a}`] ? 'offered' : 'hat',
      });
    }
    const cols = 4;
    const dx = 150;
    const dy = 122;
    items.forEach((it, k) => {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Entity();
      const offered = (this.myOffer[it.key] ?? 0) > 0;
      const ring = new Graphics();
      ring
        .roundRect(-64, -50, 128, 100, 16)
        .fill(offered ? 0x3a5a2a : FARM.panel)
        .roundRect(-64, -50, 128, 100, 16)
        .stroke({ color: offered ? FARM.accent : darken(FARM.panel, 0.3), width: offered ? 4 : 2 });
      chip.addChild(ring);
      if (it.emoji) chip.addChild(makeText(it.emoji, 38));
      else if (it.draw) {
        const g = new Graphics();
        it.draw(g);
        chip.addChild(g);
      }
      const lbl = makeText(it.sub, 16, { color: FARM.ink, weight: '900' });
      lbl.position.set(0, 32);
      chip.addChild(lbl);
      chip.position.set((col - (cols - 1) / 2) * dx, -150 + row * dy);
      chip.eventMode = 'static';
      chip.on('pointertap', () => this.toggleOfferItem(it.key));
      this.tradeGrid.addChild(chip);
    });
  }
}
