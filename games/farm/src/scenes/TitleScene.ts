import { Container, Graphics } from 'pixi.js';
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
  private skinCap!: Text;
  private skinRow!: Entity;
  private accRow!: Entity;
  private accPrev!: UIButton;
  private accNext!: UIButton;
  private accLabel!: Text;
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
    this.accPrev.position.set(-200, 0);
    this.accNext.position.set(200, 0);
    if (W > H) {
      // Landscape: avatar preview on the left, controls in a right column.
      const lx = W * 0.28;
      const rx = W * 0.66;
      this.title.position.set(W / 2, H * 0.12);
      this.sub.position.set(W / 2, H * 0.12 + 44);
      this.preview.position.set(lx, H * 0.56);
      this.nameBtn.position.set(lx, H * 0.82);
      this.typeBtn.position.set(rx, H * 0.28);
      this.outfitCap.position.set(rx, H * 0.4);
      this.swatchRow.position.set(rx, H * 0.5);
      this.skinCap.position.set(rx, H * 0.6);
      this.skinRow.position.set(rx, H * 0.7);
      this.accRow.position.set(rx, H * 0.82);
      this.playBtn.position.set(lx, H * 0.94);
      this.friendsBtn.position.set(W - 130, 50);
      return;
    }
    this.title.position.set(W / 2, H * 0.085);
    this.sub.position.set(W / 2, H * 0.085 + 52);
    this.preview.position.set(W / 2, H * 0.29);
    this.nameBtn.position.set(W / 2, H * 0.44);
    this.typeBtn.position.set(W / 2, H * 0.51);
    this.outfitCap.position.set(W / 2, H * 0.565);
    this.swatchRow.position.set(W / 2, H * 0.6);
    this.skinCap.position.set(W / 2, H * 0.655);
    this.skinRow.position.set(W / 2, H * 0.69);
    this.accRow.position.set(W / 2, H * 0.765);
    this.playBtn.position.set(W / 2, H * 0.88);
    this.friendsBtn.position.set(W - 130, 50);
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

    this.skinCap = makeText('skin tone', 20, { color: FARM.inkSoft, weight: '800' });
    this.stage.addChild(this.skinCap);
    this.skinRow = new Entity();
    this.add(this.skinRow);
    this.redrawSkins();

    // Accessory cycler: ◀  [emoji Name]  ▶
    this.accRow = new Entity();
    this.add(this.accRow);
    this.accPrev = new UIButton('◀', {
      width: 84,
      height: 80,
      fontSize: 34,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.cycleAcc(-1),
    });
    this.accNext = new UIButton('▶', {
      width: 84,
      height: 80,
      fontSize: 34,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.cycleAcc(1),
    });
    this.add(this.accPrev, this.accRow);
    this.add(this.accNext, this.accRow);
    this.accLabel = makeText('', 26, { color: FARM.ink, weight: '800' });
    this.accRow.addChild(this.accLabel);
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
    audio.blip(1.2);
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

  private cycleAcc(dir: number): void {
    // Only cycle through accessories you own (free starters + bought ones).
    const owned = ownedAccessoryIds();
    const cur = owned.indexOf(this.accId);
    const from = cur >= 0 ? cur : 0;
    const next = owned[(from + dir + owned.length) % owned.length]!;
    this.applyAcc(next);
    audio.blip(1.2);
  }

  private applyAcc(id: string): void {
    this.accId = ACCESSORIES[accessoryIndex(id)]!.id;
    store.set(ACC_KEY, this.accId);
    this.rebuildPreview();
    this.updateAccLabel();
  }

  private updateAccLabel(): void {
    const a = ACCESSORIES[accessoryIndex(this.accId)]!;
    this.accLabel.text = a.id === 'none' ? '🚫 No accessory' : `${a.emoji}  ${a.name}`;
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
