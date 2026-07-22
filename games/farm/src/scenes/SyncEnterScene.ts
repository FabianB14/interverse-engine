import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio, verium } from '@interverse/engine';
import { syncPull } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { store } from '../store.js';
import { resolveRelayUrl } from '../config.js';
import { SettingsScene } from './SettingsScene.js';
import '../debug.js';

const KEYS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'.split('');
const CODE_LEN = 5;

/**
 * Apply a wallet-sync payload: ADDS the received balance to the local one
 * (money from both devices is kept), guarded so the same code can only be
 * applied once on this device.
 */
export function applyWalletSync(code: string, data: unknown): number | null {
  const payload = data as { verium?: number } | null;
  const amount = Math.max(0, Math.floor(Number(payload?.verium ?? 0)));
  const applied = store.get<string[]>('syncApplied', []);
  if (applied.includes(code)) return null;
  verium.add(amount);
  applied.push(code);
  store.set('syncApplied', applied.slice(-20));
  return amount;
}

/** Keypad for a wallet-sync code from another device. */
export class SyncEnterScene extends Scene {
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
    const sy = H * 0.4;
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
      onTap: () => this.game.scenes.replace(new SettingsScene()),
    });
    this.add(this.backBtn);

    this.titleText = makeText('Enter the sync code', 38, { color: FARM.accent });
    this.stage.addChild(this.titleText);
    this.codeText = makeText('_____', 62, { color: FARM.ink, letterSpacing: 10 });
    this.stage.addChild(this.codeText);
    this.status = makeText('', 24, { color: FARM.inkSoft, weight: 'bold', wrapWidth: 620 });
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
    this.goBtn = new UIButton('SYNC ✓', {
      width: 240,
      height: 78,
      fontSize: 28,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => void this.sync(),
    });
    this.add(this.goBtn);

    this.refresh();
    this.layout();

    window.__farm = {
      scene: () => 'syncenter',
      verium: () => verium.balance(),
      setCode: (c: string) => {
        this.code = c
          .toUpperCase()
          .replace(/[^A-Z2-9]/g, '')
          .slice(0, CODE_LEN);
        this.refresh();
      },
      syncApply: () => void this.sync(),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private press(key: string): void {
    audio.blip(1.2);
    if (key === '⌫') this.code = this.code.slice(0, -1);
    else if (this.code.length < CODE_LEN) this.code += key;
    this.refresh();
  }

  private refresh(): void {
    this.codeText.text = (this.code + '_'.repeat(CODE_LEN)).slice(0, CODE_LEN);
  }

  private async sync(): Promise<void> {
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
    this.status.style.fill = FARM.inkSoft;
    this.status.text = 'fetching…';
    try {
      const data = await syncPull(relay, this.code);
      this.busy = false;
      if (data === null) {
        this.status.style.fill = 0xff5470;
        this.status.text = 'no wallet under that code (typo, or it expired)';
        audio.buzz();
        return;
      }
      const added = applyWalletSync(this.code, data);
      if (added === null) {
        this.status.style.fill = 0xff5470;
        this.status.text = 'that code was already used on this device';
        audio.buzz();
        return;
      }
      audio.chime();
      this.status.style.fill = FARM.inkSoft;
      this.status.text = `+⬡${added} added — wallet is now ⬡${verium.balance()} 🎉`;
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff5470;
      this.status.text = `couldn't sync: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
