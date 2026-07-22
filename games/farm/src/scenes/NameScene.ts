import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { NAME_KEY, cleanName, savedName, store } from '../store.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MAX_LEN = 12;

/** Name entry for your farmer, saved on device. Shown as "<Name>'s Farm". */
export class NameScene extends Scene {
  private name = savedName() ?? '';
  private titleText!: Text;
  private preview!: Text;
  private box!: Graphics;
  private keys: UIButton[] = [];
  private spaceBtn!: UIButton;
  private delBtn!: UIButton;
  private doneBtn!: UIButton;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    const landscape = W > H;
    this.titleText.position.set(W / 2, landscape ? 56 : 130);
    const boxY = landscape ? 100 : 210;
    this.box.clear();
    this.box
      .roundRect(W / 2 - 310, boxY, 620, 110, 20)
      .fill({ color: FARM.panel })
      .roundRect(W / 2 - 310, boxY, 620, 110, 20)
      .stroke({ color: FARM.accent, width: 3 });
    this.preview.position.set(W / 2, boxY + 55);
    const perRow = landscape ? 13 : 7;
    const keyW = 82;
    const keyH = landscape ? 78 : 90;
    const keyGap = 10;
    const rowW = perRow * keyW + (perRow - 1) * keyGap;
    const startX = (W - rowW) / 2 + keyW / 2;
    const startY = landscape ? 260 : 400;
    this.keys.forEach((btn, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      btn.position.set(startX + col * (keyW + keyGap), startY + row * (keyH + keyGap));
    });
    const rows = Math.ceil(this.keys.length / perRow);
    const controlsY = startY + rows * (keyH + keyGap) + 24;
    this.spaceBtn.position.set(W / 2 - 190, controlsY);
    this.delBtn.position.set(W / 2 + 10, controlsY);
    this.doneBtn.position.set(W / 2, Math.min(H - 70, controlsY + 120));
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    this.stage.addChild(bg);

    this.titleText = makeText('NAME YOUR FARMER', 44, { color: FARM.accent });
    this.stage.addChild(this.titleText);
    this.box = new Graphics();
    this.stage.addChild(this.box);
    this.preview = makeText('', 46, { color: FARM.ink });
    this.stage.addChild(this.preview);

    for (const key of KEYS) {
      const btn = new UIButton(key, {
        width: 82,
        height: 90,
        fontSize: 34,
        fill: FARM.panel,
        textColor: FARM.ink,
        onTap: () => this.press(key),
      });
      this.add(btn);
      this.keys.push(btn);
    }
    this.spaceBtn = new UIButton('SPACE', {
      width: 180,
      height: 84,
      fontSize: 26,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.press(' '),
    });
    this.add(this.spaceBtn);
    this.delBtn = new UIButton('⌫', {
      width: 180,
      height: 84,
      fontSize: 34,
      fill: 0xd9645a,
      onTap: () => this.press('⌫'),
    });
    this.add(this.delBtn);
    this.doneBtn = new UIButton('SAVE 🌱', {
      width: 360,
      height: 96,
      fontSize: 34,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => this.done(),
    });
    this.add(this.doneBtn);

    this.refresh();
    this.layout(W, H);

    window.__farm = {
      scene: () => 'name',
      setName: (n: string) => {
        this.name = cleanName(n);
        this.refresh();
      },
      saveName: () => this.done(),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private press(key: string): void {
    audio.blip(1.2);
    if (key === '⌫') {
      this.name = this.name.slice(0, -1);
    } else if (this.name.length < MAX_LEN) {
      this.name += key === ' ' ? ' ' : this.name.length === 0 ? key : key.toLowerCase();
    }
    this.refresh();
  }

  private refresh(): void {
    const n = cleanName(this.name);
    this.preview.text = n ? `${n}'s Farm` : 'name…';
    this.preview.alpha = n ? 1 : 0.45;
  }

  private done(): void {
    if (this.game.scenes.isTransitioning) return;
    const n = cleanName(this.name);
    if (!n) {
      audio.buzz();
      return;
    }
    store.set(NAME_KEY, n);
    audio.chime();
    this.game.scenes.replace(new TitleScene());
  }
}
