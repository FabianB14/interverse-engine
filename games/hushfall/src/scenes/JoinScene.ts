import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene } from '@interverse/engine';
import { join } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { NIGHT, sting } from '../theme.js';
import { makeText, playerName } from '../text.js';
import { savedName } from '../store.js';
import { LobbyScene } from './LobbyScene.js';
import { MenuScene } from './MenuScene.js';
import '../debug.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const SLOT_W = 110;
const SLOT_H = 130;
const SLOT_GAP = 22;
const KEY_W = 76;
const KEY_H = 84;
const KEY_GAP = 10;

export class JoinScene extends Scene {
  private code = '';
  private busy = false;
  private title!: Text;
  private slotViews: { box: Graphics; ch: Text }[] = [];
  private status!: Text;
  private keyBtns: UIButton[] = [];
  private back!: UIButton;

  constructor(private readonly prefill = '') {
    super();
  }

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  /** Portrait: stacked. Landscape: code + status on the left, keyboard on the
   *  right, BACK tucked bottom-left — nothing overlaps at either aspect. */
  private layout(W: number, H: number): void {
    const landscape = W > H;
    const codeCx = landscape ? W * 0.26 : W / 2;
    this.title.position.set(codeCx, landscape ? 120 : 120);
    const total = CODE_LENGTH * SLOT_W + (CODE_LENGTH - 1) * SLOT_GAP;
    this.slotViews.forEach((s, i) => {
      const x = codeCx - total / 2 + SLOT_W / 2 + i * (SLOT_W + SLOT_GAP);
      const y = landscape ? 250 : 255;
      s.box.position.set(x, y);
      s.ch.position.set(x, y);
    });
    this.status.position.set(codeCx, landscape ? 400 : 380);
    const perRow = 8;
    const rowW = perRow * KEY_W + (perRow - 1) * KEY_GAP;
    const keysCx = landscape ? W * 0.68 : W / 2;
    const keysTop = landscape ? 160 : 470;
    this.keyBtns.forEach((btn, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      btn.position.set(keysCx - rowW / 2 + KEY_W / 2 + col * (KEY_W + KEY_GAP), keysTop + row * (KEY_H + KEY_GAP));
    });
    this.back.position.set(landscape ? codeCx : W / 2, H - (landscape ? 90 : 110));
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    window.__hushfall = { scene: () => 'join', code: () => this.code, playerCount: () => 0 };

    this.title = makeText('ENTER ROOM CODE', 52, { color: NIGHT.ink });
    this.stage.addChild(this.title);

    for (let i = 0; i < CODE_LENGTH; i++) {
      const box = new Graphics()
        .roundRect(-SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, 18)
        .fill({ color: 0xffffff, alpha: 0.06 })
        .roundRect(-SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, 18)
        .stroke({ color: NIGHT.inkSoft, alpha: 0.4, width: 3 });
      this.stage.addChild(box);
      const ch = makeText('', 72, { color: NIGHT.ink });
      this.stage.addChild(ch);
      this.slotViews.push({ box, ch });
    }

    this.status = makeText('', 28, { color: NIGHT.blood, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    const keys = [...ALPHABET.split(''), '⌫'];
    for (const key of keys) {
      const btn = new UIButton(key, {
        width: KEY_W,
        height: KEY_H,
        fontSize: 34,
        fill: key === '⌫' ? NIGHT.blood : 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.press(key),
      });
      this.add(btn);
      this.keyBtns.push(btn);
    }

    this.back = new UIButton('BACK', {
      width: 240,
      height: 84,
      fontSize: 30,
      fill: 0x2a3a4a,
      textColor: NIGHT.ink,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        sting('blip');
        window.history.replaceState(null, '', window.location.pathname);
        this.game.scenes.replace(new MenuScene());
      },
    });
    this.add(this.back);

    this.layout(W, H);

    if (this.prefill) for (const ch of this.prefill.slice(0, CODE_LENGTH)) this.press(ch, true);
  }

  protected override onExit(): void {
    delete window.__hushfall;
  }

  private press(key: string, silent = false): void {
    if (this.busy) return;
    if (!silent) sting('blip');
    if (key === '⌫') this.code = this.code.slice(0, -1);
    else if (this.code.length < CODE_LENGTH && ALPHABET.includes(key)) this.code += key;
    this.slotViews.forEach((s, i) => (s.ch.text = this.code[i] ?? ''));
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
    this.status.style.fill = NIGHT.inkSoft;
    this.status.text = 'joining…';
    try {
      const session = await join(this.code, savedName() ?? playerName(), { url: relayUrl, game: GAME_TAG });
      this.game.scenes.replace(new LobbyScene(session));
    } catch (err) {
      this.busy = false;
      this.code = '';
      this.slotViews.forEach((s) => (s.ch.text = ''));
      this.status.style.fill = NIGHT.blood;
      this.status.text = err instanceof Error ? err.message : String(err);
      sting('lose');
    }
  }
}
