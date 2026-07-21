import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio, partyPop } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { NAME_KEY, cleanName, savedName, store } from '../store.js';
import { makeText } from '../text.js';
// Circular with MenuScene — safe: only used inside callbacks.
import { MenuScene } from './MenuScene.js';

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MAX_LEN = 10;

/** First-launch name entry: "<Name> Blob". Saved on device. */
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
    this.titleText.position.set(W / 2, landscape ? 56 : 120);
    const boxY = landscape ? 100 : 200;
    this.box.clear();
    this.box
      .roundRect(W / 2 - 310, boxY, 620, 110, 20)
      .fill({ color: 0xffffff, alpha: 0.08 })
      .roundRect(W / 2 - 310, boxY, 620, 110, 20)
      .stroke({ color: 0xffffff, alpha: 0.3, width: 3 });
    this.preview.position.set(W / 2, boxY + 55);
    const perRow = landscape ? 13 : 7;
    const keyW = 82;
    const keyH = landscape ? 78 : 86;
    const keyGap = 10;
    const rowW = perRow * keyW + (perRow - 1) * keyGap;
    const startX = (W - rowW) / 2 + keyW / 2;
    const startY = landscape ? 260 : 380;
    this.keys.forEach((btn, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      btn.position.set(startX + col * (keyW + keyGap), startY + row * (keyH + keyGap));
    });
    const rows = Math.ceil(this.keys.length / perRow);
    const controlsY = startY + rows * (keyH + keyGap) + 30;
    this.spaceBtn.position.set(W / 2 - 190, controlsY);
    this.delBtn.position.set(W / 2 + 10, controlsY);
    this.doneBtn.position.set(W / 2, Math.min(H - 70, controlsY + 120));
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    window.__blobvale = {
      scene: () => 'name',
      code: () => null,
      playerCount: () => 0,
    };

    this.titleText = makeText('WHAT SHOULD WE CALL YOU?', 44, { color: partyPop.accent });
    this.stage.addChild(this.titleText);
    this.box = new Graphics();
    this.stage.addChild(this.box);
    this.preview = makeText('', 52, { color: partyPop.ink });
    this.stage.addChild(this.preview);

    for (const key of KEYS) {
      const btn = new UIButton(key, {
        width: 82,
        height: 86,
        fontSize: 34,
        fill: 0xffffff,
        onTap: () => this.press(key),
      });
      this.add(btn);
      this.keys.push(btn);
    }
    this.spaceBtn = new UIButton('SPACE', {
      width: 180,
      height: 84,
      fontSize: 26,
      fill: 0x8affc1,
      onTap: () => this.press(' '),
    });
    this.add(this.spaceBtn);
    this.delBtn = new UIButton('⌫', {
      width: 180,
      height: 84,
      fontSize: 34,
      fill: 0xff6f91,
      onTap: () => this.press('⌫'),
    });
    this.add(this.delBtn);
    this.doneBtn = new UIButton("LET'S GO!", {
      width: 360,
      height: 96,
      fontSize: 34,
      onTap: () => this.done(),
    });
    this.add(this.doneBtn);

    this.refresh();
    this.layout(W, H);
  }

  protected override onExit(): void {
    delete window.__blobvale;
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
    this.preview.text = n ? `${n} Blob` : 'Blob…';
    this.preview.alpha = n ? 1 : 0.45;
  }

  private done(): void {
    const n = cleanName(this.name);
    if (!n) {
      audio.buzz();
      return;
    }
    store.set(NAME_KEY, n);
    audio.chime();
    this.game.scenes.replace(new MenuScene());
  }
}
