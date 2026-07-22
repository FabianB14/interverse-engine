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
  lighten,
  makeTappable,
  verium,
} from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM, SEASON_TINT } from '../theme.js';
import { makeText } from '../text.js';
import { CROPS, cropById } from '../crops.js';
import type { CropDef } from '../crops.js';
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
import { store } from '../store.js';
import { invAdd, invAll, invTotal } from '../inventory.js';
import { MarketScene } from './MarketScene.js';
import '../debug.js';

const COLS = 4;
const ROWS = 3;
const PLOTS = COLS * ROWS;
const MOISTURE_DECAY = 0.03; // per second in sun
const GROW_MOISTURE = 0.15; // plants only grow when this wet

interface Plot {
  crop: string | null;
  growth: number; // 0..1
  moisture: number; // 0..1
}

interface PlotView {
  root: Entity;
  soil: Graphics;
  leaves: Graphics;
  fruit: Container | null;
  fruitCrop: string | null;
}

export class FarmScene extends Scene {
  private plots: Plot[] = [];
  private views: PlotView[] = [];
  private plotSize = 150;
  private plotPos: { x: number; y: number }[] = [];
  private gridLayer!: Container;
  private fxLayer!: Container;
  private rainLayer!: Graphics;
  private uiLayer!: Container;
  private field!: Graphics;

  private selectedSeed = 'carrot';
  private seedChips: { id: string; ring: Graphics }[] = [];
  private seedBar!: Container;

  private veriumText!: Text;
  private basketText!: Text;
  private weatherText!: Text;
  private toastText!: Text;
  private waterBtn!: UIButton;
  private musicBtn!: UIButton;
  private marketBtn!: UIButton;

  private clock = 0; // weather/season seconds
  private forcedWeather: Weather | null = null;
  private harvested = 0;
  private season: Season = 'spring';
  private t = 0;
  private saveIn = 5;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    this.load();

    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    this.stage.addChild(bg);
    this.field = new Graphics();
    this.stage.addChild(this.field);

    this.gridLayer = new Container();
    this.fxLayer = new Container();
    this.rainLayer = new Graphics();
    this.uiLayer = new Container();
    this.stage.addChild(this.gridLayer, this.fxLayer, this.rainLayer, this.uiLayer);

    for (let i = 0; i < PLOTS; i++) {
      const root = new Entity();
      const soil = new Graphics();
      const leaves = new Graphics();
      root.addChild(soil, leaves);
      const idx = i;
      makeTappable(root, () => this.tapPlot(idx), {
        hitRect: { x: -80, y: -80, width: 160, height: 160 },
      });
      this.gridLayer.addChild(root);
      this.views.push({ root, soil, leaves, fruit: null, fruitCrop: null });
    }

    // HUD
    this.veriumText = makeText('', 30, { color: FARM.coin, weight: '900' });
    this.veriumText.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.veriumText);
    this.basketText = makeText('', 22, { color: FARM.ink, weight: '800' });
    this.basketText.anchor.set(0, 0.5);
    this.uiLayer.addChild(this.basketText);
    this.weatherText = makeText('', 26, { color: FARM.ink, weight: '800' });
    this.weatherText.anchor.set(1, 0.5);
    this.uiLayer.addChild(this.weatherText);
    this.toastText = makeText('', 28, { color: FARM.accent, weight: '900' });
    this.uiLayer.addChild(this.toastText);

    this.buildSeedBar();

    this.waterBtn = new UIButton('💧', {
      width: 108,
      height: 96,
      fontSize: 44,
      fill: 0x6fb0d8,
      onTap: () => this.waterAll(),
    });
    this.add(this.waterBtn, this.uiLayer);
    this.musicBtn = new UIButton(music.playing ? '🎵' : '🔇', {
      width: 108,
      height: 96,
      fontSize: 40,
      fill: FARM.panel,
      onTap: () => {
        const on = music.toggle();
        this.musicBtn.setLabel(on ? '🎵' : '🔇');
      },
    });
    this.add(this.musicBtn, this.uiLayer);
    this.marketBtn = new UIButton('🧺 Market', {
      width: 260,
      height: 96,
      fontSize: 34,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.toMarket(),
    });
    this.add(this.marketBtn, this.uiLayer);

    this.layout(W, H);
    this.applySeason();
    for (let i = 0; i < PLOTS; i++) this.renderPlot(i);
    this.updateVeriumText();
    this.updateBasket();

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
      toMarket: () => this.toMarket(),
      weather: () => this.currentWeather(),
      season: () => this.season,
      setClock: (t: number) => {
        this.clock = t;
      },
      rainNow: () => {
        this.forcedWeather = 'rain';
      },
      musicOn: () => music.playing,
      toggleMusic: () => {
        const on = music.toggle();
        this.musicBtn.setLabel(on ? '🎵' : '🔇');
        return on;
      },
    };
  }

  protected override onExit(): void {
    this.save();
    delete window.__farm;
  }

  // ------------------------------------------------------------- layout

  private layout(W: number, H: number): void {
    this.veriumText.position.set(24, 44);
    this.basketText.position.set(24, 82);
    this.weatherText.position.set(W - 24, 48);
    this.toastText.position.set(W / 2, 118);

    // Grid block centered between HUD and the seed bar.
    const top = 150;
    const bottomUi = 380; // space reserved for seed bar + buttons
    const availW = W * 0.94;
    const availH = H - top - bottomUi;
    const size = Math.min(availW / COLS, availH / ROWS) - 12;
    this.plotSize = size;
    const gridW = COLS * (size + 12) - 12;
    const gridH = ROWS * (size + 12) - 12;
    const ox = (W - gridW) / 2 + size / 2;
    const oy = top + (availH - gridH) / 2 + size / 2;
    this.plotPos = [];
    for (let i = 0; i < PLOTS; i++) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const x = ox + c * (size + 12);
      const y = oy + r * (size + 12);
      this.plotPos.push({ x, y });
      this.views[i]?.root.position.set(x, y);
    }

    this.seedBar.position.set(W / 2, H - 250);
    this.waterBtn.position.set(W - 74, H - 68);
    this.musicBtn.position.set(74, H - 68);
    this.marketBtn.position.set(W / 2, H - 68);

    this.field.clear();
    this.field.rect(0, 0, W, H).fill(FARM.bg);
    this.field
      .roundRect(W * 0.02, top - 20, W * 0.96, H - top - bottomUi + 40, 28)
      .fill(FARM.grass);
    this.applySeason();
  }

  private buildSeedBar(): void {
    this.seedBar = new Container();
    this.uiLayer.addChild(this.seedBar);
    const cols = 5;
    const dx = 128;
    const dy = 118;
    CROPS.forEach((crop, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const chip = new Entity();
      const ring = new Graphics();
      chip.addChild(ring);
      const label = makeText(crop.emoji ?? '•', 40);
      if (!crop.emoji && crop.drawFruit) {
        const fg = new Graphics();
        crop.drawFruit(fg, 26);
        chip.addChild(fg);
      } else {
        chip.addChild(label);
      }
      const cost = makeText(`⬡${crop.seedCost}`, 18, { color: FARM.coin, weight: '800' });
      cost.position.set(0, 38);
      chip.addChild(cost);
      chip.position.set((col - (cols - 1) / 2) * dx, row * dy - 24);
      const id = crop.id;
      makeTappable(chip, () => this.selectSeed(id), { hitRadius: 44 });
      this.seedBar.addChild(chip);
      this.seedChips.push({ id, ring });
    });
    this.refreshSeedHighlight();
  }

  private refreshSeedHighlight(): void {
    for (const { id, ring } of this.seedChips) {
      ring.clear();
      const sel = id === this.selectedSeed;
      ring
        .circle(0, 0, 46)
        .fill(sel ? 0x3a5a2a : FARM.panel)
        .circle(0, 0, 46)
        .stroke({ color: sel ? FARM.accent : 0x000000, width: sel ? 4 : 0, alpha: sel ? 1 : 0 });
    }
  }

  // ------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.clock += dt;

    const season = seasonAt(this.clock);
    if (season !== this.season) {
      this.season = season;
      this.applySeason();
    }
    const weather = this.currentWeather();
    const raining = isWet(weather);

    for (const p of this.plots) {
      if (!p.crop) continue;
      if (raining) p.moisture = Math.min(1, p.moisture + dt * 0.5);
      else p.moisture = Math.max(0, p.moisture - dt * MOISTURE_DECAY);
      const crop = cropById(p.crop);
      if (crop && p.moisture > GROW_MOISTURE && p.growth < 1) {
        p.growth = Math.min(1, p.growth + dt / crop.growSeconds);
      }
    }
    for (let i = 0; i < PLOTS; i++) this.renderPlot(i);

    this.updateWeatherText(weather);
    this.drawRain(raining, weather === 'storm');

    this.saveIn -= dt;
    if (this.saveIn <= 0) {
      this.saveIn = 5;
      this.save();
    }
  }

  private currentWeather(): Weather {
    return this.forcedWeather ?? weatherAt(this.clock);
  }

  private applySeason(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const top = 150;
    const bottomUi = 380;
    const tint = SEASON_TINT[this.season] ?? FARM.grass;
    this.field.clear();
    this.field.rect(0, 0, W, H).fill(FARM.bg);
    this.field.roundRect(W * 0.02, top - 20, W * 0.96, H - top - bottomUi + 40, 28).fill(tint);
  }

  private updateVeriumText(): void {
    this.veriumText.text = `⬡ ${verium.balance()}`;
  }

  private updateBasket(): void {
    const n = invTotal();
    this.basketText.text = n > 0 ? `🧺 ${n}` : '🧺 empty';
  }

  private toMarket(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(0.9);
    this.save();
    this.game.scenes.replace(new MarketScene());
  }

  private updateWeatherText(w: Weather): void {
    const label = `${SEASON_ICON[this.season]} ${this.season}   ${WEATHER_ICON[w]}`;
    if (this.weatherText.text !== label) this.weatherText.text = label;
  }

  private drawRain(raining: boolean, storm: boolean): void {
    this.rainLayer.clear();
    if (!raining) return;
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.rainLayer.rect(0, 0, W, H).fill({ color: 0x2a3a4a, alpha: storm ? 0.22 : 0.12 });
    const n = storm ? 60 : 38;
    for (let i = 0; i < n; i++) {
      const x = (i * 137.5 + this.t * 380) % W;
      const y = (i * 91.3 + this.t * 620) % H;
      this.rainLayer
        .moveTo(x, y)
        .lineTo(x - 6, y + 18)
        .stroke({ color: 0x9ecbe0, width: 2, alpha: 0.5 });
    }
  }

  // ------------------------------------------------------------ rendering

  private renderPlot(i: number): void {
    const p = this.plots[i];
    const v = this.views[i];
    if (!p || !v) return;
    const s = this.plotSize;
    const crop = cropById(p.crop);

    // Soil.
    v.soil.clear();
    const wet = p.moisture > 0.45;
    const base = p.crop ? (wet ? FARM.soilWet : FARM.soil) : FARM.soilDark;
    v.soil.roundRect(-s / 2, -s / 2, s, s, 16).fill(base);
    v.soil.roundRect(-s / 2, -s / 2, s, s, 16).stroke({ color: darken(base, 0.3), width: 3 });
    for (let r = 0; r < 3; r++) {
      const yy = -s / 2 + (s * (r + 1)) / 4;
      v.soil
        .moveTo(-s / 2 + 10, yy)
        .lineTo(s / 2 - 10, yy)
        .stroke({
          color: darken(base, 0.18),
          width: 2,
          alpha: 0.6,
        });
    }
    // Needs-water droplet.
    if (crop && p.growth < 1 && p.moisture < 0.2) {
      v.soil
        .circle(s / 2 - 22, -s / 2 + 22, 9)
        .fill({ color: 0x6fb0d8, alpha: 0.9 })
        .poly([s / 2 - 22, -s / 2 + 8, s / 2 - 28, -s / 2 + 20, s / 2 - 16, -s / 2 + 20])
        .fill({ color: 0x6fb0d8, alpha: 0.9 });
    }
    // Ripe glow.
    if (crop && p.growth >= 1) {
      v.soil.circle(0, 0, s * 0.5).stroke({ color: FARM.accent, width: 4, alpha: 0.7 });
    }

    // Plant.
    this.drawPlant(v.leaves, crop, p.growth, s);

    // Fruit (persistent node, only rebuilt when the ripe crop changes).
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
    if (v.fruit) {
      const bob = Math.sin(this.t * 2 + i) * 4;
      v.fruit.position.set(0, -s * 0.28 + bob);
    }
  }

  private drawPlant(leaves: Graphics, crop: CropDef | undefined, growth: number, s: number): void {
    leaves.clear();
    if (!crop) return;
    if (growth <= 0.03) {
      leaves.ellipse(0, s * 0.16, s * 0.12, s * 0.06).fill(0x4a3320);
      return;
    }
    const g = Math.min(1, growth);
    const h = s * (0.12 + g * 0.42);
    const baseY = s * 0.2;
    leaves
      .moveTo(0, baseY)
      .lineTo(0, baseY - h)
      .stroke({ color: darken(crop.leaf, 0.1), width: Math.max(4, s * 0.03 * (0.6 + g)) });
    const ls = s * (0.06 + g * 0.14);
    leaves.ellipse(-ls * 0.9, baseY - h * 0.45, ls, ls * 0.55).fill(crop.leaf);
    leaves.ellipse(ls * 0.9, baseY - h * 0.7, ls, ls * 0.55).fill(lighten(crop.leaf, 0.08));
    if (g >= 0.55) {
      leaves.ellipse(0, baseY - h, ls * 1.15, ls * 0.7).fill(darken(crop.leaf, 0.05));
    }
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
    // Quick pop-in, driven from the scene's fx layer (plot roots aren't ticked).
    c.scale.set(0.3);
    const pop = new Entity();
    pop.addBehavior(new Tween(c.scale, { x: 1, y: 1 }, 0.35, { ease: easings.outBack }));
    pop.addBehavior(new Timer(0.4, () => this.remove(pop)));
    this.add(pop, this.fxLayer);
    return c;
  }

  // ------------------------------------------------------------ actions

  private tapPlot(i: number): void {
    const p = this.plots[i];
    if (!p) return;
    if (!p.crop) this.plantAt(i, this.selectedSeed);
    else if (p.growth >= 1) this.harvestAt(i);
    else this.waterAt(i);
  }

  private selectSeed(id: string): void {
    if (!cropById(id)) return;
    this.selectedSeed = id;
    audio.blip(1.2);
    this.refreshSeedHighlight();
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
    let any = false;
    for (const p of this.plots) {
      if (p.crop) {
        p.moisture = 1;
        any = true;
      }
    }
    if (any) audio.chime();
    this.toast('watered the farm 💧');
  }

  private harvestAt(i: number): boolean {
    const p = this.plots[i];
    const crop = cropById(p?.crop);
    if (!p || !crop || p.growth < 1) return false;
    // Harvest into the basket — sell at the farmers market for Verium.
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

  // --------------------------------------------------------------- fx

  private popup(i: number, text: string): void {
    const pos = this.plotPos[i];
    if (!pos) return;
    const e = new Entity();
    e.position.set(pos.x, pos.y - this.plotSize * 0.3);
    e.addChild(makeText(text, 40));
    e.addBehavior(
      new Tween(e, { y: pos.y - this.plotSize * 0.7, alpha: 0 }, 0.7, { ease: easings.outQuad }),
    );
    e.addBehavior(new Timer(0.75, () => this.remove(e)));
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

  // -------------------------------------------------------------- save

  private load(): void {
    const saved = store.get<{ c: string | null; g: number; m: number }[] | null>('plots', null);
    if (saved && saved.length === PLOTS) {
      this.plots = saved.map((s) => ({
        crop: s.c ?? null,
        growth: typeof s.g === 'number' ? s.g : 0,
        moisture: typeof s.m === 'number' ? s.m : 0,
      }));
    } else {
      this.plots = Array.from({ length: PLOTS }, () => ({ crop: null, growth: 0, moisture: 0 }));
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
