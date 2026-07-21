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
  private status!: Text;

  constructor(private readonly prefill = '') {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    window.__blobvale = { scene: () => 'join', code: () => this.code, playerCount: () => 0 };

    const title = makeText('ENTER ROOM CODE', 52, { color: partyPop.accent });
    title.position.set(W / 2, 120);
    this.stage.addChild(title);

    const slotW = 110;
    const gap = 22;
    const total = CODE_LENGTH * slotW + (CODE_LENGTH - 1) * gap;
    for (let i = 0; i < CODE_LENGTH; i++) {
      const x = (W - total) / 2 + i * (slotW + gap);
      const box = new Graphics()
        .roundRect(x, 190, slotW, 130, 18)
        .fill({ color: 0xffffff, alpha: 0.08 })
        .roundRect(x, 190, slotW, 130, 18)
        .stroke({ color: 0xffffff, alpha: 0.3, width: 3 });
      this.stage.addChild(box);
      const ch = makeText('', 72, { color: partyPop.ink });
      ch.position.set(x + slotW / 2, 190 + 65);
      this.stage.addChild(ch);
      this.slots.push(ch);
    }

    this.status = makeText('', 28, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.status.position.set(W / 2, 380);
    this.stage.addChild(this.status);

    const perRow = 8;
    const keyW = 76;
    const keyH = 84;
    const keyGap = 10;
    const rowW = perRow * keyW + (perRow - 1) * keyGap;
    const startX = (W - rowW) / 2 + keyW / 2;
    const startY = 470;
    const keys = [...ALPHABET.split(''), '⌫'];
    keys.forEach((key, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const btn = new UIButton(key, {
        width: keyW,
        height: keyH,
        fontSize: 34,
        fill: key === '⌫' ? 0xff6f91 : 0xffffff,
        onTap: () => this.press(key),
      });
      btn.position.set(startX + col * (keyW + keyGap), startY + row * (keyH + keyGap));
      this.add(btn);
    });

    const back = new UIButton('BACK', {
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
    back.position.set(W / 2, H - 110);
    this.add(back);

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
