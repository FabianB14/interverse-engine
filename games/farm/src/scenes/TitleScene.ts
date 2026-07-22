import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Tween, audio, easings, makeTappable } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { music } from '../music.js';
import { ACC_KEY, SKIN_KEY, savedAcc, savedName, savedSkin, store } from '../store.js';
import { makeCharacter } from '../character.js';
import type { CharType } from '../character.js';
import { ACCESSORIES, accessoryIndex, ownedAccessoryIds } from '../accessories.js';
import { GAME_TITLE } from '../game.js';
import { FarmScene } from './FarmScene.js';
import { NameScene } from './NameScene.js';
import { FriendsScene } from './FriendsScene.js';
import '../debug.js';

// Outfit / blob-body colors, and a range of skin tones for the person.
const CHAR_COLORS = [0xe07a5f, 0xf2cc8f, 0x81b29a, 0x6fb0d8, 0xc77dff];
const SKIN_COLORS = [0xffe0bd, 0xf0c08a, 0xd99a63, 0xb5703c, 0x8d5524, 0x5c3a1e];

/** HSV (h in 0..360, s/v in 0..1) to a packed RGB hex, for the color picker. */
function hsvToHex(h: number, s: number, v: number): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (n: number): number => Math.round((n + m) * 255);
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/** Cozy title: live avatar picker (blob/person, colors, skin, accessory) + name. */
export class TitleScene extends Scene {
  private title!: Text;
  private sub!: Text;
  private preview!: Entity;
  private previewBody: Container | null = null;
  private nameBtn!: UIButton;
  private typeBtn!: UIButton;
  private outfitCap!: Text;
  private swatchRow!: Entity;
  private hueBar!: Entity;
  private hueKnob!: Graphics;
  private hueWidth = 520;
  private hueDragging = false;
  private skinCap!: Text;
  private skinRow!: Entity;
  private accBtn!: UIButton;
  private accPanel!: Container;
  private accGrid!: Container;
  private playBtn!: UIButton;
  private friendsBtn!: UIButton;
  private busy = false;
  private t = 0;

  private charType: CharType = 'blob';
  private charColor = CHAR_COLORS[0]!;
  private skinColor = SKIN_COLORS[1]!;
  private accId = 'none';

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    if (W > H) {
      // Landscape: avatar preview on the left, controls in a right column.
      const lx = W * 0.28;
      const rx = W * 0.66;
      this.title.position.set(W / 2, H * 0.12);
      this.sub.position.set(W / 2, H * 0.12 + 44);
      this.preview.position.set(lx, H * 0.56);
      this.nameBtn.position.set(lx, H * 0.82);
      this.typeBtn.position.set(rx, H * 0.23);
      this.outfitCap.position.set(rx, H * 0.33);
      this.swatchRow.position.set(rx, H * 0.42);
      this.hueBar.position.set(rx, H * 0.52);
      this.hueBar.scale.set(Math.min(1, (W * 0.6) / this.hueWidth));
      this.skinCap.position.set(rx, H * 0.62);
      this.skinRow.position.set(rx, H * 0.72);
      this.accBtn.position.set(rx, H * 0.84);
      this.accPanel.position.set(W / 2, H / 2);
      this.accPanel.scale.set(Math.min(1, (H - 40) / 640, (W - 20) / 700));
      this.playBtn.position.set(lx, H * 0.94);
      this.friendsBtn.position.set(130, 50);
      return;
    }
    this.title.position.set(W / 2, H * 0.075);
    this.sub.position.set(W / 2, H * 0.075 + 50);
    this.preview.position.set(W / 2, H * 0.275);
    this.nameBtn.position.set(W / 2, H * 0.42);
    this.typeBtn.position.set(W / 2, H * 0.485);
    this.outfitCap.position.set(W / 2, H * 0.535);
    this.swatchRow.position.set(W / 2, H * 0.57);
    this.hueBar.position.set(W / 2, H * 0.625);
    this.hueBar.scale.set(1);
    this.skinCap.position.set(W / 2, H * 0.675);
    this.skinRow.position.set(W / 2, H * 0.71);
    this.accBtn.position.set(W / 2, H * 0.775);
    this.accPanel.position.set(W / 2, H / 2);
    this.accPanel.scale.set(Math.min(1, (H - 40) / 640, (W - 20) / 700));
    this.playBtn.position.set(W / 2, H * 0.875);
    this.friendsBtn.position.set(130, 50);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    this.charType = store.get<CharType>('charType', 'blob');
    this.charColor = store.get<number>('charColor', CHAR_COLORS[0]!);
    this.skinColor = savedSkin();
    this.accId = savedAcc();

    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    bg.rect(0, H * 0.6, W, H * 0.4).fill(FARM.grassDark);
    bg.ellipse(W / 2, H * 0.6, W, H * 0.12).fill(FARM.grass);
    this.stage.addChild(bg);

    this.title = makeText(GAME_TITLE, 92, { color: FARM.accent, letterSpacing: 2 });
    this.stage.addChild(this.title);
    this.sub = makeText('', 24, { color: FARM.inkSoft, weight: 'bold' });
    this.stage.addChild(this.sub);
    this.updateSub();

    this.preview = new Entity();
    this.add(this.preview);
    this.rebuildPreview();

    this.nameBtn = new UIButton('', {
      width: 420,
      height: 76,
      fontSize: 28,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.editName(),
    });
    this.add(this.nameBtn);
    this.updateNameLabel();

    this.typeBtn = new UIButton('', {
      width: 380,
      height: 76,
      fontSize: 30,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toggleType(),
    });
    this.add(this.typeBtn);
    this.updateTypeLabel();

    this.outfitCap = makeText('', 20, { color: FARM.inkSoft, weight: '800' });
    this.stage.addChild(this.outfitCap);
    this.swatchRow = new Entity();
    this.add(this.swatchRow);
    this.redrawSwatches();
    this.buildHueBar();

    this.skinCap = makeText('skin tone', 20, { color: FARM.inkSoft, weight: '800' });
    this.stage.addChild(this.skinCap);
    this.skinRow = new Entity();
    this.add(this.skinRow);
    this.redrawSkins();

    // Accessory bar: collapsed by default — tap to open a grid of everything
    // you own (scales to any wardrobe size), pick one, and it collapses.
    this.accBtn = new UIButton('', {
      width: 420,
      height: 76,
      fontSize: 26,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toggleAccPanel(),
    });
    this.add(this.accBtn);
    this.buildAccPanel();
    this.updateAccLabel();

    this.playBtn = new UIButton('🌱  PLAY', {
      width: 420,
      height: 100,
      fontSize: 42,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.play(),
    });
    this.add(this.playBtn);

    this.friendsBtn = new UIButton('👥 Friends', {
      width: 220,
      height: 68,
      fontSize: 26,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.goFriends(),
    });
    this.add(this.friendsBtn);

    this.updateOutfitCap();
    this.updateSkinVisibility();
    this.layout(W, H);

    window.__farm = {
      scene: () => 'title',
      play: () => this.play(),
      musicOn: () => music.playing,
      charType: () => this.charType,
      setChar: (type: string, color: number) => {
        this.charType = type === 'person' ? 'person' : 'blob';
        this.charColor = color;
        store.set('charType', this.charType);
        store.set('charColor', this.charColor);
        this.rebuildPreview();
        this.updateTypeLabel();
        this.updateOutfitCap();
        this.updateSkinVisibility();
        this.redrawSwatches();
      },
      acc: () => this.accId,
      setAcc: (id: string) => this.applyAcc(id),
      skin: () => this.skinColor,
      setSkin: (c: number) => this.pickSkin(c),
      name: () => savedName() ?? '',
      editName: () => this.editName(),
      friends: () => this.goFriends(),
    };
  }

  private goFriends(): void {
    if (this.busy || this.game.scenes.isTransitioning) return;
    audio.blip(1.2);
    this.game.scenes.replace(new FriendsScene());
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private updateSub(): void {
    const n = savedName();
    this.sub.text = n
      ? `${n}'s farm · grow · sell · relax`
      : 'walk your farm · grow · sell · relax';
  }

  private updateNameLabel(): void {
    const n = savedName();
    this.nameBtn.setLabel(n ? `✏️  ${n}` : '✏️  Name your farmer');
  }

  private editName(): void {
    if (this.game.scenes.isTransitioning) return;
    audio.blip(1.2);
    this.game.scenes.replace(new NameScene());
  }

  private rebuildPreview(): void {
    for (const old of this.preview.removeChildren()) old.destroy({ children: true });
    const char = makeCharacter(this.charType, this.charColor, 82, 5, this.accId, this.skinColor);
    this.preview.addChild(char.view);
    this.previewBody = char.body;
  }

  private updateTypeLabel(): void {
    this.typeBtn.setLabel(this.charType === 'blob' ? 'You: 🫧 Blob — tap' : 'You: 🧑 Person — tap');
  }

  private updateOutfitCap(): void {
    this.outfitCap.text = this.charType === 'blob' ? 'blob color' : 'shirt color';
  }

  private updateSkinVisibility(): void {
    const show = this.charType === 'person';
    this.skinCap.visible = show;
    this.skinRow.visible = show;
  }

  private toggleType(): void {
    this.charType = this.charType === 'blob' ? 'person' : 'blob';
    store.set('charType', this.charType);
    this.rebuildPreview();
    this.updateTypeLabel();
    this.updateOutfitCap();
    this.updateSkinVisibility();
    audio.blip(1.2);
  }

  private pickColor(c: number): void {
    this.charColor = c;
    store.set('charColor', c);
    this.rebuildPreview();
    this.redrawSwatches();
    this.moveHueKnob();
    audio.blip(1.2);
  }

  /** A full-spectrum hue bar so you can pick any color, not just presets. */
  private buildHueBar(): void {
    this.hueBar = new Entity();
    const bar = new Graphics();
    const w = this.hueWidth;
    const h = 34;
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      const x = -w / 2 + (i / steps) * w;
      bar.rect(x, -h / 2, w / steps + 1, h).fill(hsvToHex((i / steps) * 360, 0.62, 0.92));
    }
    bar.roundRect(-w / 2, -h / 2, w, h, 10).stroke({ color: 0xffffff, width: 3, alpha: 0.35 });
    this.hueBar.addChild(bar);
    this.hueKnob = new Graphics();
    this.hueKnob
      .circle(0, 0, 16)
      .fill(0xffffff)
      .circle(0, 0, 16)
      .stroke({ color: 0x2a2016, width: 3 });
    this.hueBar.addChild(this.hueKnob);

    this.hueBar.eventMode = 'static';
    this.hueBar.hitArea = new Rectangle(-w / 2 - 20, -30, w + 40, 60);
    const pick = (e: { global: { x: number; y: number } }): void => {
      const p = this.hueBar.toLocal(e.global);
      const t = Math.max(0, Math.min(1, (p.x + w / 2) / w));
      this.pickColor(hsvToHex(t * 360, 0.62, 0.92));
    };
    this.hueBar.on('pointerdown', pick);
    this.hueBar.on('globalpointermove', (e) => {
      if (this.hueDragging) pick(e);
    });
    this.hueBar.on('pointerdown', () => (this.hueDragging = true));
    this.hueBar.on('pointerup', () => (this.hueDragging = false));
    this.hueBar.on('pointerupoutside', () => (this.hueDragging = false));
    this.add(this.hueBar);
    this.moveHueKnob();
  }

  private moveHueKnob(): void {
    if (!this.hueKnob) return;
    // Show the knob at the hue nearest the current color (approx via max channel).
    const r = (this.charColor >> 16) & 0xff;
    const g = (this.charColor >> 8) & 0xff;
    const b = this.charColor & 0xff;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue = 0;
    if (max !== min) {
      const d = max - min;
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    this.hueKnob.position.set((hue / 360 - 0.5) * this.hueWidth, 0);
  }

  private pickSkin(c: number): void {
    this.skinColor = c;
    store.set(SKIN_KEY, c);
    this.rebuildPreview();
    this.redrawSkins();
    audio.blip(1.2);
  }

  private redrawSwatches(): void {
    for (const old of this.swatchRow.removeChildren()) old.destroy({ children: true });
    this.redrawDots(this.swatchRow, CHAR_COLORS, this.charColor, (c) => this.pickColor(c));
  }

  private redrawSkins(): void {
    for (const old of this.skinRow.removeChildren()) old.destroy({ children: true });
    this.redrawDots(this.skinRow, SKIN_COLORS, this.skinColor, (c) => this.pickSkin(c));
  }

  private redrawDots(
    row: Entity,
    colors: number[],
    selected: number,
    onPick: (c: number) => void,
  ): void {
    const dx = Math.min(96, 620 / colors.length);
    colors.forEach((c, i) => {
      const dot = new Entity();
      const g = new Graphics().circle(0, 0, 27).fill(c);
      if (c === selected) g.circle(0, 0, 33).stroke({ color: 0xffffff, width: 4 });
      dot.addChild(g);
      dot.position.set((i - (colors.length - 1) / 2) * dx, 0);
      makeTappable(dot, () => onPick(c), { hitRadius: 40 });
      row.addChild(dot);
    });
  }

  private buildAccPanel(): void {
    this.accPanel = new Container();
    this.accPanel.visible = false;
    const bg = new Graphics();
    bg.roundRect(-330, -320, 660, 640, 26).fill(0x2a2016);
    bg.roundRect(-330, -320, 660, 640, 26).stroke({ color: FARM.accent, width: 3 });
    this.accPanel.addChild(bg);
    const title = makeText('🎩 your wardrobe', 28, { color: FARM.accent, weight: '900' });
    title.position.set(0, -282);
    this.accPanel.addChild(title);
    this.accGrid = new Container();
    this.accPanel.addChild(this.accGrid);
    const close = new UIButton('✕ close', {
      width: 190,
      height: 60,
      fontSize: 24,
      fill: 0x5a4632,
      textColor: FARM.ink,
      onTap: () => this.toggleAccPanel(),
    });
    close.position.set(0, 282);
    this.add(close, this.accPanel);
    this.stage.addChild(this.accPanel);
  }

  private toggleAccPanel(): void {
    if (!this.accPanel.visible) this.refreshAccGrid();
    this.accPanel.visible = !this.accPanel.visible;
    // Keep the wardrobe above everything else on the title.
    if (this.accPanel.visible) this.stage.addChild(this.accPanel);
    audio.blip();
  }

  private refreshAccGrid(): void {
    for (const old of this.accGrid.removeChildren()) old.destroy({ children: true });
    const owned = ownedAccessoryIds();
    const cols = 5;
    const dx = 122;
    const dy = 116;
    owned.forEach((id, k) => {
      const def = ACCESSORIES[accessoryIndex(id)]!;
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Entity();
      const sel = id === this.accId;
      const ring = new Graphics();
      ring
        .roundRect(-54, -48, 108, 96, 16)
        .fill(sel ? 0x3a5a2a : FARM.panel)
        .roundRect(-54, -48, 108, 96, 16)
        .stroke({ color: sel ? FARM.accent : 0x5a4632, width: sel ? 4 : 2 });
      chip.addChild(ring);
      chip.addChild(makeText(def.emoji, 38));
      const lbl = makeText(def.name, 13, { color: FARM.inkSoft, weight: '800' });
      lbl.position.set(0, 34);
      chip.addChild(lbl);
      chip.position.set((col - (cols - 1) / 2) * dx, -210 + row * dy);
      makeTappable(
        chip,
        () => {
          this.applyAcc(id);
          this.toggleAccPanel();
        },
        { hitRadius: 54 },
      );
      this.accGrid.addChild(chip);
    });
  }

  private applyAcc(id: string): void {
    this.accId = ACCESSORIES[accessoryIndex(id)]!.id;
    store.set(ACC_KEY, this.accId);
    this.rebuildPreview();
    this.updateAccLabel();
  }

  private updateAccLabel(): void {
    const a = ACCESSORIES[accessoryIndex(this.accId)]!;
    const n = ownedAccessoryIds().length;
    this.accBtn.setLabel(
      a.id === 'none' ? `🚫 No accessory (${n} owned) ▾` : `${a.emoji} ${a.name} ▾`,
    );
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    if (this.previewBody) {
      const s = Math.sin(this.t * 2) * 0.05;
      this.previewBody.scale.set(1 + s, 1 - s);
    }
  }

  private play(): void {
    if (this.busy || this.game.scenes.isTransitioning) return;
    this.busy = true;
    music.start();
    const go = new Entity();
    go.addBehavior(new Timer(0.02, () => this.game.scenes.replace(new FarmScene())));
    this.add(go);
    this.playBtn.scale.set(0.94);
    this.playBtn.addBehavior(
      new Tween(this.playBtn.scale, { x: 1, y: 1 }, 0.2, { ease: easings.outBack }),
    );
  }
}
