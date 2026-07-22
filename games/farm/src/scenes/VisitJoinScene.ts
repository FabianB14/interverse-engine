import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio } from '@interverse/engine';
import { join } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { savedName } from '../store.js';
import { addFriend, cleanCode } from '../friends.js';
import { VisitScene } from './VisitScene.js';
import { FriendsScene } from './FriendsScene.js';
import '../debug.js';

// Relay code alphabet (no ambiguous letters).
const KEYS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split('');

/** Enter a friend's 4-letter farm code to drop by their farm. */
export class VisitJoinScene extends Scene {
  private code = '';
  private titleText!: Text;
  private codeText!: Text;
  private status!: Text;
  private keys: UIButton[] = [];
  private delBtn!: UIButton;
  private goBtn!: UIButton;
  private backBtn!: UIButton;
  private busy = false;

  constructor(initial = '') {
    super();
    this.code = cleanCode(initial);
  }

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    this.backBtn.position.set(120, 54);
    this.titleText.position.set(W / 2, H * 0.12);
    this.codeText.position.set(W / 2, H * 0.24);
    this.status.position.set(W / 2, H * 0.32);
    const perRow = 6;
    const kw = 96;
    const kh = 96;
    const gap = 12;
    const rowW = perRow * kw + (perRow - 1) * gap;
    const sx = (W - rowW) / 2 + kw / 2;
    const sy = H * 0.4;
    this.keys.forEach((b, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      b.position.set(sx + c * (kw + gap), sy + r * (kh + gap));
    });
    const rows = Math.ceil(this.keys.length / perRow);
    const cy = sy + rows * (kh + gap) + 20;
    this.delBtn.position.set(W / 2 - 130, cy);
    this.goBtn.position.set(W / 2 + 130, cy);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    this.stage.addChild(bg);

    this.backBtn = new UIButton('← Back', {
      width: 190,
      height: 72,
      fontSize: 28,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.game.scenes.replace(new FriendsScene()),
    });
    this.add(this.backBtn);

    this.titleText = makeText("Friend's farm code", 40, { color: FARM.accent });
    this.stage.addChild(this.titleText);
    this.codeText = makeText('____', 72, { color: FARM.ink, letterSpacing: 12 });
    this.stage.addChild(this.codeText);
    this.status = makeText('', 26, { color: FARM.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    for (const key of KEYS) {
      const b = new UIButton(key, {
        width: 96,
        height: 96,
        fontSize: 34,
        fill: FARM.panel,
        textColor: FARM.ink,
        onTap: () => this.press(key),
      });
      this.add(b);
      this.keys.push(b);
    }
    this.delBtn = new UIButton('⌫', {
      width: 200,
      height: 84,
      fontSize: 34,
      fill: 0xd9645a,
      onTap: () => this.press('⌫'),
    });
    this.add(this.delBtn);
    this.goBtn = new UIButton('VISIT →', {
      width: 240,
      height: 84,
      fontSize: 30,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => void this.visit(),
    });
    this.add(this.goBtn);

    this.refresh();
    this.layout(W, H);

    window.__farm = {
      scene: () => 'visitjoin',
      setCode: (c: string) => {
        this.code = cleanCode(c);
        this.refresh();
      },
      visit: () => void this.visit(),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private press(key: string): void {
    audio.blip(1.2);
    if (key === '⌫') this.code = this.code.slice(0, -1);
    else if (this.code.length < 4) this.code += key;
    this.refresh();
  }

  private refresh(): void {
    this.codeText.text = (this.code + '____').slice(0, 4);
  }

  private async visit(): Promise<void> {
    if (this.busy || this.game.scenes.isTransitioning) return;
    if (this.code.length !== 4) {
      this.status.text = 'enter all 4 letters';
      audio.buzz();
      return;
    }
    const relay = resolveRelayUrl();
    if (!relay) {
      this.status.text = 'no relay configured (add ?relay=…)';
      return;
    }
    this.busy = true;
    this.status.style.fill = FARM.inkSoft;
    this.status.text = 'knocking on the door…\n(a sleeping relay can take ~30s)';
    try {
      const session = await join(this.code, savedName() ?? 'Visitor', {
        url: relay,
        game: GAME_TAG,
      });
      const hostName = session.players.find((p) => p.isHost)?.name ?? this.code;
      addFriend(hostName, this.code);
      this.game.scenes.replace(new VisitScene(session));
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff5470;
      this.status.text = `couldn't reach that farm:\n${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
