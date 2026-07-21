import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio, partyPop } from '@interverse/engine';
import { join } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { makeText, playerName } from '../text.js';
import { LobbyScene } from './LobbyScene.js';
// Circular with MenuScene — safe: only used inside callbacks.
import { MenuScene } from './MenuScene.js';

// Same unambiguous alphabet the relay uses for codes (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export class JoinScene extends Scene {
  private code = '';
  private busy = false;
  private slots: Text[] = [];
  private slotBoxes: Graphics[] = [];
  private keys: UIButton[] = [];
  private backBtn!: UIButton;
  private titleText!: Text;
  private status!: Text;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    const landscape = W > H;
    this.titleText.position.set(W / 2, landscape ? 64 : 120);
    const slotW = 110;
    const gap = 22;
    const total = 4 * slotW + 3 * gap;
    const slotY = landscape ? 110 : 190;
    this.slotBoxes.forEach((box, i) => {
      const x = (W - total) / 2 + i * (slotW + gap);
      box.clear();
      box
        .roundRect(x, slotY, slotW, 130, 18)
        .fill({ color: 0xffffff, alpha: 0.08 })
        .roundRect(x, slotY, slotW, 130, 18)
        .stroke({ color: 0xffffff, alpha: 0.3, width: 3 });
      const ch = this.slots[i];
      if (ch) ch.position.set(x + slotW / 2, slotY + 65);
    });
    this.status.position.set(W / 2, slotY + 175);
    const perRow = landscape ? 16 : 8;
    const keyW = 76;
    const keyH = landscape ? 78 : 84;
    const keyGap = 10;
    const rowW = perRow * keyW + (perRow - 1) * keyGap;
    const startX = (W - rowW) / 2 + keyW / 2;
    const startY = landscape ? 360 : 470;
    this.keys.forEach((btn, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      btn.position.set(startX + col * (keyW + keyGap), startY + row * (keyH + keyGap));
    });
    this.backBtn.position.set(W / 2, H - (landscape ? 70 : 110));
  }

  constructor(private readonly prefill = '') {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    window.__blobvale = { scene: () => 'join', code: () => this.code, playerCount: () => 0 };

    this.titleText = makeText('ENTER ROOM CODE', 52, { color: partyPop.accent });
    this.stage.addChild(this.titleText);

    for (let i = 0; i < CODE_LENGTH; i++) {
      const box = new Graphics();
      this.stage.addChild(box);
      this.slotBoxes.push(box);
      const ch = makeText('', 72, { color: partyPop.ink });
      this.stage.addChild(ch);
      this.slots.push(ch);
    }

    this.status = makeText('', 28, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    for (const key of [...ALPHABET.split(''), '⌫']) {
      const btn = new UIButton(key, {
        width: 76,
        height: 84,
        fontSize: 34,
        fill: key === '⌫' ? 0xff6f91 : 0xffffff,
        onTap: () => this.press(key),
      });
      this.add(btn);
      this.keys.push(btn);
    }

    this.backBtn = new UIButton('BACK', {
      width: 240,
      height: 84,
      fontSize: 30,
      fill: 0x8affc1,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        window.history.replaceState(null, '', window.location.pathname);
        this.game.scenes.replace(new MenuScene());
      },
    });
    this.add(this.backBtn);
    this.layout(W, H);

    if (this.prefill) {
      for (const ch of this.prefill.slice(0, CODE_LENGTH)) this.press(ch, true);
    }
  }

  protected override onExit(): void {
    delete window.__blobvale;
  }

  private press(key: string, silent = false): void {
    if (this.busy) return;
    if (!silent) audio.blip(1.2);
    if (key === '⌫') {
      this.code = this.code.slice(0, -1);
    } else if (this.code.length < CODE_LENGTH && ALPHABET.includes(key)) {
      this.code += key;
    }
    this.slots.forEach((slot, i) => {
      slot.text = this.code[i] ?? '';
    });
    this.status.text = '';
    if (this.code.length === CODE_LENGTH) void this.tryJoin();
  }

  private async tryJoin(): Promise<void> {
    const relayUrl = resolveRelayUrl();
    if (!relayUrl) {
      this.status.text = 'No relay configured — open with ?relay=wss://your-relay-url';
      return;
    }
    this.busy = true;
    this.status.style.fill = partyPop.inkSoft;
    this.status.text = 'joining…';
    try {
      const session = await join(this.code, playerName(), { url: relayUrl, game: GAME_TAG });
      this.game.scenes.replace(new LobbyScene(session));
    } catch (err) {
      this.busy = false;
      this.code = '';
      this.slots.forEach((slot) => {
        slot.text = '';
      });
      this.status.style.fill = 0xff5470;
      this.status.text = err instanceof Error ? err.message : String(err);
      audio.buzz();
    }
  }
}
