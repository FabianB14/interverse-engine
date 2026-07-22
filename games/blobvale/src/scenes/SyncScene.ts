import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio, partyPop, verium } from '@interverse/engine';
import { syncPull, syncPush } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { resolveRelayUrl } from '../config.js';
import { makeText } from '../text.js';
import { store } from '../store.js';
import { MenuScene } from './MenuScene.js';

const KEYS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split('');
const CODE_LEN = 5;

/**
 * Family wallet sync — same codes as Bloomstead's Settings page, so Verium
 * moves freely between games, devices, and installed apps (which iOS gives
 * ISOLATED storage). Receiving ADDS to your balance; each code applies once.
 */
export class SyncScene extends Scene {
  private code = '';
  private titleText!: Text;
  private codeText!: Text;
  private walletText!: Text;
  private status!: Text;
  private sendBtn!: UIButton;
  private backBtn!: UIButton;
  private keys: UIButton[] = [];
  private delBtn!: UIButton;
  private goBtn!: UIButton;
  private busy = false;
  private W = 720;
  private H = 1280;

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
    this.titleText.position.set(W / 2, land ? H * 0.08 : H * 0.1);
    this.walletText.position.set(W / 2, (land ? H * 0.08 : H * 0.1) + 48);
    this.sendBtn.position.set(W / 2, land ? H * 0.24 : H * 0.22);
    this.codeText.position.set(W / 2, land ? H * 0.34 : H * 0.3);
    this.status.position.set(W / 2, land ? H * 0.42 : H * 0.36);
    const perRow = land ? 11 : 6;
    const rows = Math.ceil(KEYS.length / perRow);
    const kw = Math.min(land ? 88 : 96, (W * 0.94 - (perRow - 1) * 10) / perRow);
    const kh = land ? Math.min(80, (H * 0.42) / rows - 10) : 92;
    const gap = 10;
    const rowW = perRow * kw + (perRow - 1) * gap;
    const sx = (W - rowW) / 2 + kw / 2;
    const sy = land ? H * 0.5 : H * 0.44;
    this.keys.forEach((b, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      b.position.set(sx + c * (kw + gap), sy + r * (kh + gap));
      b.scale.set(Math.min(1, kw / 96, kh / 96));
    });
    const cy = sy + rows * (kh + gap) + (land ? 26 : 36);
    this.delBtn.position.set(W / 2 - 130, Math.min(cy, H - 56));
    this.goBtn.position.set(W / 2 + 130, Math.min(cy, H - 56));
  }

  protected override onEnter(): void {
    this.W = this.game.viewWidth;
    this.H = this.game.viewHeight;

    window.__blobvale = {
      scene: () => 'sync',
      code: () => null,
      playerCount: () => 0,
    };

    const bg = new Graphics();
    bg.rect(0, 0, this.W, this.H).fill(0x1b1035);
    this.stage.addChild(bg);

    this.backBtn = new UIButton('← Back', {
      width: 190,
      height: 72,
      fontSize: 28,
      fill: 0x8affc1,
      textColor: 0x1c1c28,
      onTap: () => this.game.scenes.replace(new MenuScene()),
    });
    this.add(this.backBtn);

    this.titleText = makeText('🔄 Wallet Sync', 44, { color: partyPop.accent });
    this.stage.addChild(this.titleText);
    this.walletText = makeText('', 26, { color: 0x9ad8ff, weight: 'bold' });
    this.stage.addChild(this.walletText);
    this.updateWallet();

    this.sendBtn = new UIButton('📤 Send my wallet', {
      width: 420,
      height: 84,
      fontSize: 28,
      onTap: () => void this.send(),
    });
    this.add(this.sendBtn);

    this.codeText = makeText('', 52, { color: partyPop.ink, letterSpacing: 8 });
    this.stage.addChild(this.codeText);
    this.status = makeText('or enter a code from the other device below', 22, {
      color: partyPop.inkSoft,
      weight: 'bold',
      wrapWidth: 640,
    });
    this.stage.addChild(this.status);

    for (const key of KEYS) {
      const b = new UIButton(key, {
        width: 96,
        height: 92,
        fontSize: 32,
        fill: 0x2c2150,
        textColor: partyPop.ink,
        onTap: () => this.press(key),
      });
      this.add(b);
      this.keys.push(b);
    }
    this.delBtn = new UIButton('⌫', {
      width: 200,
      height: 76,
      fontSize: 30,
      fill: 0xff6f91,
      onTap: () => this.press('⌫'),
    });
    this.add(this.delBtn);
    this.goBtn = new UIButton('SYNC ✓', {
      width: 240,
      height: 76,
      fontSize: 28,
      onTap: () => void this.receive(),
    });
    this.add(this.goBtn);

    this.layout();
  }

  protected override onExit(): void {
    delete window.__blobvale;
  }

  private updateWallet(): void {
    this.walletText.text = `wallet: ⬡ ${verium.balance()}`;
  }

  private press(key: string): void {
    audio.blip(1.2);
    if (key === '⌫') this.code = this.code.slice(0, -1);
    else if (this.code.length < CODE_LEN) this.code += key;
    this.codeText.text = this.code || '';
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const relay = resolveRelayUrl();
    if (!relay) {
      this.status.text = 'no relay configured';
      return;
    }
    this.busy = true;
    this.status.text = 'uploading…';
    try {
      const code = await syncPush(relay, { verium: verium.balance() });
      this.codeText.text = code;
      this.status.text = `enter ${code} on the other device (works ~1 day)`;
      audio.chime();
    } catch (err) {
      this.status.text = `couldn't upload: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.busy = false;
  }

  private async receive(): Promise<void> {
    if (this.busy) return;
    if (this.code.length !== CODE_LEN) {
      this.status.text = `enter all ${CODE_LEN} letters`;
      audio.buzz();
      return;
    }
    const relay = resolveRelayUrl();
    if (!relay) {
      this.status.text = 'no relay configured';
      return;
    }
    this.busy = true;
    this.status.text = 'fetching…';
    try {
      const data = (await syncPull(relay, this.code)) as { verium?: number } | null;
      this.busy = false;
      if (!data) {
        this.status.text = 'no wallet under that code (typo, or it expired)';
        audio.buzz();
        return;
      }
      const applied = store.get<string[]>('syncApplied', []);
      if (applied.includes(this.code)) {
        this.status.text = 'that code was already used on this device';
        audio.buzz();
        return;
      }
      const amount = Math.max(0, Math.floor(Number(data.verium ?? 0)));
      verium.add(amount);
      applied.push(this.code);
      store.set('syncApplied', applied.slice(-20));
      this.updateWallet();
      this.status.text = `+⬡${amount} added — wallet is now ⬡${verium.balance()} 🎉`;
      audio.chime();
    } catch (err) {
      this.busy = false;
      this.status.text = `couldn't sync: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
