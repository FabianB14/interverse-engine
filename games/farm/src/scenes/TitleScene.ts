import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Tween, audio, easings, makeTappable } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { music } from '../music.js';
import { store } from '../store.js';
import { makeCharacter } from '../character.js';
import type { CharType } from '../character.js';
import { GAME_TITLE } from '../game.js';
import { FarmScene } from './FarmScene.js';
import '../debug.js';

const CHAR_COLORS = [0xe07a5f, 0xf2cc8f, 0x81b29a, 0x6fb0d8, 0xc77dff];

/** Cozy title with a live character picker (blob or person) and a Play button. */
export class TitleScene extends Scene {
  private title!: Text;
  private sub!: Text;
  private preview!: Entity;
  private previewBody: Container | null = null;
  private typeBtn!: UIButton;
  private swatchRow!: Entity;
  private playBtn!: UIButton;
  private busy = false;
  private t = 0;

  private charType: CharType = 'blob';
  private charColor = CHAR_COLORS[0]!;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    this.title.position.set(W / 2, H * 0.13);
    this.sub.position.set(W / 2, H * 0.13 + 66);
    this.preview.position.set(W / 2, H * 0.42);
    this.typeBtn.position.set(W / 2, H * 0.58);
    this.swatchRow.position.set(W / 2, H * 0.66);
    this.playBtn.position.set(W / 2, H * 0.82);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    this.charType = store.get<CharType>('charType', 'blob');
    this.charColor = store.get<number>('charColor', CHAR_COLORS[0]!);

    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    bg.rect(0, H * 0.6, W, H * 0.4).fill(FARM.grassDark);
    bg.ellipse(W / 2, H * 0.6, W, H * 0.12).fill(FARM.grass);
    this.stage.addChild(bg);

    this.title = makeText(GAME_TITLE, 92, { color: FARM.accent, letterSpacing: 2 });
    this.stage.addChild(this.title);
    this.sub = makeText('walk your farm · grow · sell · relax', 24, {
      color: FARM.inkSoft,
      weight: 'bold',
    });
    this.stage.addChild(this.sub);

    this.preview = new Entity();
    this.add(this.preview);
    this.rebuildPreview();

    this.typeBtn = new UIButton('', {
      width: 360,
      height: 84,
      fontSize: 32,
      fill: FARM.panel,
      onTap: () => this.toggleType(),
    });
    this.add(this.typeBtn);
    this.updateTypeLabel();

    this.swatchRow = new Entity();
    this.add(this.swatchRow);
    this.redrawSwatches();

    this.playBtn = new UIButton('🌱  PLAY', {
      width: 420,
      height: 104,
      fontSize: 42,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.play(),
    });
    this.add(this.playBtn);

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
        this.redrawSwatches();
      },
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private rebuildPreview(): void {
    for (const old of this.preview.removeChildren()) old.destroy({ children: true });
    const char = makeCharacter(this.charType, this.charColor, 92, 5);
    this.preview.addChild(char.view);
    this.previewBody = char.body;
  }

  private updateTypeLabel(): void {
    this.typeBtn.setLabel(this.charType === 'blob' ? 'You: 🫧 Blob — tap' : 'You: 🧑 Person — tap');
  }

  private toggleType(): void {
    this.charType = this.charType === 'blob' ? 'person' : 'blob';
    store.set('charType', this.charType);
    this.rebuildPreview();
    this.updateTypeLabel();
    audio.blip(1.2);
  }

  private pickColor(c: number): void {
    this.charColor = c;
    store.set('charColor', c);
    this.rebuildPreview();
    this.redrawSwatches();
    audio.blip(1.2);
  }

  private redrawSwatches(): void {
    for (const old of this.swatchRow.removeChildren()) old.destroy({ children: true });
    CHAR_COLORS.forEach((c, i) => {
      const dot = new Entity();
      const g = new Graphics().circle(0, 0, 30).fill(c);
      if (c === this.charColor) g.circle(0, 0, 36).stroke({ color: 0xffffff, width: 4 });
      dot.addChild(g);
      dot.position.set((i - (CHAR_COLORS.length - 1) / 2) * 84, 0);
      makeTappable(dot, () => this.pickColor(c), { hitRadius: 42 });
      this.swatchRow.addChild(dot);
    });
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
