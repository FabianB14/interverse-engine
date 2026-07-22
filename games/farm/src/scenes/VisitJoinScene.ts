import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { addFriend, cleanCode } from '../friends.js';
import { farmNet } from '../net.js';
import { FarmScene } from './FarmScene.js';
import { FriendsScene } from './FriendsScene.js';
import '../debug.js';

// Relay code alphabet (no ambiguous letters).
const KEYS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split('');

type Mode = 'visit' | 'add';

/**
 * Code keypad, used two ways: enter a friend's 4-letter farm code to visit
 * them right now, or just save them to your friends list for later.
 */
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
  private W = 720;
  private H = 1280;

  constructor(
    initial = '',
    private readonly mode: Mode = 'visit',
  ) {
    super();
    this.code = cleanCode(initial);
  }

  protected override onResize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.layout();
  }

  private layout(): void {
    const W = this.W;
    const H = this.H;
    const land = W > H;
    this.backBtn.position.set(120, 54);
    // Keyboard sizing adapts to orientation: wide+short screens use more
    // columns and smaller keys so everything stays on screen.
    const perRow = land ? 11 : 6;
    const rows = Math.ceil(KEYS.length / perRow);
    const kw = Math.min(land ? 88 : 96, (W * 0.94 - (perRow - 1) * 10) / perRow);
    const kh = land ? Math.min(88, (H * 0.5) / rows - 10) : 96;
    const gap = 10;
    this.titleText.position.set(W / 2, land ? H * 0.09 : H * 0.12);
    this.codeText.position.set(W / 2, land ? H * 0.2 : H * 0.24);
    this.status.position.set(W / 2, land ? H * 0.3 : H * 0.32);
    const rowW = perRow * kw + (perRow - 1) * gap;
    const sx = (W - rowW) / 2 + kw / 2;
    const sy = land ? H * 0.4 : H * 0.4;
    this.keys.forEach((b, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      b.position.set(sx + c * (kw + gap), sy + r * (kh + gap));
      b.scale.set(Math.min(1, kw / 96, kh / 96));
    });
    const cy = sy + rows * (kh + gap) + (land ? 30 : 40);
    this.delBtn.position.set(W / 2 - 130, Math.min(cy, H - 60));
    this.goBtn.position.set(W / 2 + 130, Math.min(cy, H - 60));
  }

  protected override onEnter(): void {
    this.W = this.game.viewWidth;
    this.H = this.game.viewHeight;

    const bg = new Graphics();
    bg.rect(0, 0, this.W, this.H).fill(FARM.bg);
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

    this.titleText = makeText(
      this.mode === 'add' ? "Add a friend's code" : "Friend's farm code",
      38,
      { color: FARM.accent },
    );
    this.stage.addChild(this.titleText);
    this.codeText = makeText('____', 68, { color: FARM.ink, letterSpacing: 12 });
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
      height: 78,
      fontSize: 32,
      fill: 0xd9645a,
      onTap: () => this.press('⌫'),
    });
    this.add(this.delBtn);
    this.goBtn = new UIButton(this.mode === 'add' ? 'SAVE ➕' : 'VISIT →', {
      width: 240,
      height: 78,
      fontSize: 28,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => void this.go(),
    });
    this.add(this.goBtn);

    this.refresh();
    this.layout();

    window.__farm = {
      scene: () => 'visitjoin',
      setCode: (c: string) => {
        this.code = cleanCode(c);
        this.refresh();
      },
      visit: () => void this.go(),
      addFriendCode: (name: string, code: string) => addFriend(name, code),
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

  private async go(): Promise<void> {
    if (this.busy || this.game.scenes.isTransitioning) return;
    if (this.code.length !== 4) {
      this.status.text = 'enter all 4 letters';
      audio.buzz();
      return;
    }
    if (this.mode === 'add') {
      addFriend(`Farm ${this.code}`, this.code);
      audio.chime();
      this.game.scenes.replace(new FriendsScene());
      return;
    }
    this.busy = true;
    this.status.style.fill = FARM.inkSoft;
    this.status.text = 'knocking on the door…\n(a sleeping relay can take ~30s)';
    try {
      const session = await farmNet.join(this.code);
      const hostName = session.players.find((p) => p.isHost)?.name ?? `Farm ${this.code}`;
      addFriend(hostName, this.code);
      this.game.scenes.replace(new FarmScene());
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff5470;
      this.status.text = `couldn't reach that farm:\n${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
