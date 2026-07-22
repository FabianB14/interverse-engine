import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Scene, audio, verium } from '@interverse/engine';
import { syncPush } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { music } from '../music.js';
import { store } from '../store.js';
import { resolveRelayUrl } from '../config.js';
import { TitleScene } from './TitleScene.js';
import { SyncEnterScene } from './SyncEnterScene.js';
import '../debug.js';

export function musicPref(): boolean {
  return store.get<boolean>('musicOn', true);
}

export function sfxPref(): boolean {
  return store.get<boolean>('sfxOn', true);
}

/** Apply the saved sound preferences to the live audio systems. */
export function applySoundPrefs(): void {
  audio.volume = sfxPref() ? 0.6 : 0;
  if (!musicPref() && music.playing) music.stop();
}

/** ⚙️ Settings: sound toggles + family wallet sync between devices/apps. */
export class SettingsScene extends Scene {
  private titleText!: Text;
  private musicBtn!: UIButton;
  private sfxBtn!: UIButton;
  private sendBtn!: UIButton;
  private receiveBtn!: UIButton;
  private backBtn!: UIButton;
  private codeText!: Text;
  private status!: Text;
  private busy = false;
  private W = 720;
  private H = 1280;

  protected override onResize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.layout();
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
      onTap: () => this.game.scenes.replace(new TitleScene()),
    });
    this.add(this.backBtn);

    this.titleText = makeText('⚙️ Settings', 48, { color: FARM.accent });
    this.stage.addChild(this.titleText);

    this.musicBtn = new UIButton('', {
      width: 480,
      height: 88,
      fontSize: 28,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toggleMusic(),
    });
    this.add(this.musicBtn);
    this.sfxBtn = new UIButton('', {
      width: 480,
      height: 88,
      fontSize: 28,
      fill: FARM.panel,
      textColor: FARM.ink,
      onTap: () => this.toggleSfx(),
    });
    this.add(this.sfxBtn);

    this.sendBtn = new UIButton('📤 Send my wallet', {
      width: 480,
      height: 88,
      fontSize: 28,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => void this.send(),
    });
    this.add(this.sendBtn);
    this.receiveBtn = new UIButton('📥 Receive with a code', {
      width: 480,
      height: 88,
      fontSize: 28,
      fill: 0x8fd06a,
      textColor: 0x1c2a12,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        this.game.scenes.replace(new SyncEnterScene());
      },
    });
    this.add(this.receiveBtn);

    this.codeText = makeText('', 54, { color: FARM.ink, letterSpacing: 8, weight: '900' });
    this.stage.addChild(this.codeText);
    this.status = makeText('', 22, { color: FARM.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    this.refreshLabels();
    this.layout();

    window.__farm = {
      scene: () => 'settings',
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      musicOn: () => musicPref(),
      toggleMusic: () => {
        this.toggleMusic();
        return musicPref();
      },
      sfxOn: () => sfxPref(),
      syncSend: () => this.send(),
      openReceive: () => this.game.scenes.replace(new SyncEnterScene()),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private layout(): void {
    const W = this.W;
    const H = this.H;
    const land = W > H;
    this.backBtn.position.set(120, 54);
    this.titleText.position.set(W / 2, land ? H * 0.14 : H * 0.12);
    const lx = land ? W * 0.28 : W / 2;
    const rx = land ? W * 0.72 : W / 2;
    this.musicBtn.position.set(lx, land ? H * 0.36 : H * 0.26);
    this.sfxBtn.position.set(lx, (land ? H * 0.36 : H * 0.26) + 104);
    this.sendBtn.position.set(rx, land ? H * 0.36 : H * 0.52);
    this.receiveBtn.position.set(rx, (land ? H * 0.36 : H * 0.52) + 104);
    this.codeText.position.set(rx, (land ? H * 0.36 : H * 0.52) + 208);
    this.status.position.set(W / 2, H * 0.9);
  }

  private refreshLabels(): void {
    this.musicBtn.setLabel(`🎵 Music: ${musicPref() ? 'ON' : 'OFF'}`);
    this.sfxBtn.setLabel(`🔔 Sounds: ${sfxPref() ? 'ON' : 'OFF'}`);
  }

  private toggleMusic(): void {
    store.set('musicOn', !musicPref());
    if (!musicPref()) music.stop();
    this.refreshLabels();
    audio.blip();
  }

  private toggleSfx(): void {
    store.set('sfxOn', !sfxPref());
    applySoundPrefs();
    this.refreshLabels();
    audio.blip();
  }

  /** Upload the wallet and show the transfer code to read out loud. */
  private async send(): Promise<string> {
    if (this.busy) return '';
    const relay = resolveRelayUrl();
    if (!relay) {
      this.status.text = 'no relay configured';
      return '';
    }
    this.busy = true;
    this.status.style.fill = FARM.inkSoft;
    this.status.text = 'uploading…';
    try {
      const code = await syncPush(relay, { verium: verium.balance() });
      this.codeText.text = code;
      this.status.text =
        `on the other device: Settings → 📥 Receive, enter ${code}.\n` +
        'the code works for about a day.';
      audio.chime();
      this.busy = false;
      return code;
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff5470;
      this.status.text = `couldn't upload: ${err instanceof Error ? err.message : String(err)}`;
      return '';
    }
  }
}
