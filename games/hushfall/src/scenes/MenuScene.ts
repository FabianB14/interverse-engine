import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Wobble, blobCharacter, popIn, verium } from '@interverse/engine';
import { host, join, listRooms } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { GAME_TITLE, GAME_VERSION } from '../game.js';
import { ClassesPanel } from '../classesPanel.js';
import { NIGHT, setMusic, setSfx, sting } from '../theme.js';
import { makeText, playerName } from '../text.js';
import {
  REDEEM_CODES,
  clearLastRoom,
  lastRoom,
  markRedeemed,
  musicPref,
  redeemedCodes,
  recordPref,
  savedName,
  setMusicPref,
  setRecordPref,
  setSfxPref,
  setVoicePref,
  sfxPref,
  voicePref,
} from '../store.js';
import { JoinScene } from './JoinScene.js';
import { LobbyScene } from './LobbyScene.js';
import '../debug.js';

export class MenuScene extends Scene {
  private busy = false;
  private status: Text | null = null;
  private mascot!: Entity;
  private titleT!: Text;
  private sub!: Text;
  private hostBtn!: UIButton;
  private joinBtn!: UIButton;
  private rejoinBtn: UIButton | null = null;
  private soundBtn: UIButton | null = null;
  private findBtn: UIButton | null = null;
  private classesBtn: UIButton | null = null;
  private finder: Container | null = null;
  private finderBg!: Graphics;
  private finderTitle!: Text;
  private finderHint!: Text;
  private finderRows: UIButton[] = [];
  private finderRefresh!: UIButton;
  private finderClose!: UIButton;
  private moon!: Graphics;
  private eyes!: Graphics;
  private versionT: Text | null = null;
  private classesPanel: ClassesPanel | null = null;
  private creditsBtn: UIButton | null = null;
  private credits: Container | null = null;
  private creditsBg!: Graphics;
  private creditsTitle!: Text;
  private creditsBody!: Text;
  private creditsClose!: UIButton;
  private settings: Container | null = null;
  private settingsBg!: Graphics;
  private settingsTitle!: Text;
  private settingsNote!: Text;
  private settingsRows: UIButton[] = [];
  private settingsClose!: UIButton;
  private t = 0;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    if (W > H) {
      // Landscape: title + mascot on the left, the action stack on the right.
      this.moon.position.set(W * 0.88, H * 0.16);
      this.titleT.position.set(W * 0.3, H * 0.2);
      this.sub.position.set(W * 0.3, H * 0.2 + 74);
      this.mascot.position.set(W * 0.3, H * 0.62);
      this.hostBtn.position.set(W * 0.72, H * 0.24);
      this.joinBtn.position.set(W * 0.72, H * 0.24 + 118);
      this.findBtn?.position.set(W * 0.72, H * 0.24 + 226);
      this.classesBtn?.position.set(W * 0.72, H * 0.24 + 330);
      this.rejoinBtn?.position.set(W * 0.72, H * 0.24 + 434);
      this.status?.position.set(W * 0.72, H * 0.9);
      this.soundBtn?.position.set(52, H - 52);
      this.creditsBtn?.position.set(126, H - 52);
      this.versionT?.position.set(W - 40, H - 24);
      this.layoutFinder(W, H);
      this.layoutSettings(W, H);
      this.layoutCredits(W, H);
      this.classesPanel?.layout();
      return;
    }
    this.moon.position.set(W * 0.78, H * 0.14);
    this.titleT.position.set(W / 2, H * 0.2);
    this.sub.position.set(W / 2, H * 0.2 + 74);
    this.mascot.position.set(W / 2, H * 0.44);
    this.hostBtn.position.set(W / 2, H * 0.6);
    this.joinBtn.position.set(W / 2, H * 0.6 + 118);
    this.findBtn?.position.set(W / 2, H * 0.6 + 226);
    this.classesBtn?.position.set(W / 2, H * 0.6 + 330);
    this.rejoinBtn?.position.set(W / 2, H * 0.6 + 434);
    this.status?.position.set(W / 2, H * 0.95);
    this.soundBtn?.position.set(52, H - 52);
    this.creditsBtn?.position.set(126, H - 52);
    this.versionT?.position.set(W - 40, H - 24);
    this.layoutFinder(W, H);
    this.layoutSettings(W, H);
    this.layoutCredits(W, H);
    this.classesPanel?.layout();
  }

  /** The Settings overlay: every comfort switch in one place. Each row is a
   *  toggle that relabels in place; prefs persist in the save. */
  private buildSettings(): void {
    this.settings = new Container();
    this.settings.visible = false;
    this.settingsBg = new Graphics();
    this.settings.addChild(this.settingsBg);
    this.settingsBg.eventMode = 'static'; // swallow taps behind the panel
    this.settingsTitle = makeText('⚙️ SETTINGS', 44, { color: NIGHT.ink });
    this.settings.addChild(this.settingsTitle);
    const mkToggle = (
      label: (on: boolean) => string,
      get: () => boolean,
      set: (on: boolean) => void,
    ): UIButton => {
      const btn = new UIButton(label(get()), {
        width: 480,
        height: 76,
        fontSize: 24,
        fill: 0x221e34,
        textColor: NIGHT.ink,
        onTap: () => {
          const on = !get();
          set(on);
          btn.setLabel(label(on));
          sting('blip');
        },
      });
      this.settings?.addChild(btn);
      this.settingsRows.push(btn);
      return btn;
    };
    const onOff = (on: boolean): string => (on ? 'ON' : 'OFF');
    mkToggle(
      (on) => `🎵 Music: ${onOff(on)}`,
      musicPref,
      (on) => {
        setMusicPref(on);
        setMusic(on);
      },
    );
    mkToggle(
      (on) => `🔔 Sound effects: ${onOff(on)}`,
      sfxPref,
      (on) => {
        setSfxPref(on);
        setSfx(on);
      },
    );
    mkToggle((on) => `🎙️ Proximity voice chat: ${onOff(on)}`, voicePref, setVoicePref);
    mkToggle((on) => `⏺ Screen record button: ${onOff(on)}`, recordPref, setRecordPref);
    // 🎟 Redeem: type a gift code, get ⬡ — once per device per code.
    const redeemBtn = new UIButton('🎟 Redeem a code', {
      width: 480,
      height: 76,
      fontSize: 24,
      fill: 0x221e34,
      textColor: NIGHT.ink,
      onTap: () => {
        const raw = window.prompt('Enter your gift code');
        if (!raw) return;
        const res = this.redeemCode(raw);
        sting(res.ok ? 'gate' : 'lose');
        redeemBtn.setLabel(res.msg);
        window.setTimeout(() => redeemBtn.setLabel('🎟 Redeem a code'), 3000);
      },
    });
    this.settings.addChild(redeemBtn);
    this.settingsRows.push(redeemBtn);
    this.settingsNote = makeText(
      'Voice chat is off unless YOU turn it on — it asks for the mic when a\nhunt starts, and only players nearby in the manor can hear you.',
      18,
      { color: NIGHT.inkSoft, weight: 'bold', wrapWidth: 620 },
    );
    this.settings.addChild(this.settingsNote);
    this.settingsClose = new UIButton('CLOSE', {
      width: 240,
      height: 76,
      fontSize: 26,
      fill: NIGHT.violet,
      textColor: 0x140f1e,
      onTap: () => {
        sting('blip');
        if (this.settings) this.settings.visible = false;
      },
    });
    this.settings.addChild(this.settingsClose);
    this.stage.addChild(this.settings);
  }

  /** The CREDITS page — who made the manors creak. */
  private buildCredits(): void {
    this.credits = new Container();
    this.credits.visible = false;
    this.creditsBg = new Graphics();
    this.creditsBg.eventMode = 'static'; // swallow taps behind the panel
    this.credits.addChild(this.creditsBg);
    this.creditsTitle = makeText('🕯️ HUSHFALL', 46, { color: NIGHT.ink });
    this.credits.addChild(this.creditsTitle);
    this.creditsBody = makeText(
      'an Interverse game\n\n' +
        'Created & directed by\nFABIAN BROOKS\n\n' +
        'Built on the Interverse Engine —\n' +
        'code-drawn art, procedural audio,\n' +
        'install-free multiplayer.\n\n' +
        'interverseengine.com\n\n' +
        'Special thanks to every blob\nwho braved the manors. 🫧',
      24,
      { color: NIGHT.inkSoft, weight: 'bold', wrapWidth: 620 },
    );
    this.credits.addChild(this.creditsBody);
    this.creditsClose = new UIButton('CLOSE', {
      width: 240,
      height: 76,
      fontSize: 26,
      fill: NIGHT.violet,
      textColor: 0x140f1e,
      onTap: () => {
        sting('blip');
        if (this.credits) this.credits.visible = false;
      },
    });
    this.credits.addChild(this.creditsClose);
    this.stage.addChild(this.credits);
  }

  private layoutCredits(W: number, H: number): void {
    if (!this.credits) return;
    this.creditsBg.clear();
    this.creditsBg.rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.97 });
    this.creditsTitle.position.set(W / 2, 96);
    this.creditsBody.position.set(W / 2, Math.min(H * 0.46, 96 + 60 + this.creditsBody.height / 2));
    this.creditsClose.position.set(W / 2, H - 80);
  }

  /** 🎟 Redeem a code for Verium. Returns a short human-readable result;
   *  each code pays out ONCE per device. */
  private redeemCode(raw: string): { ok: boolean; msg: string } {
    const code = raw.trim().toUpperCase();
    const amount = REDEEM_CODES[code];
    if (!amount) return { ok: false, msg: '🤔 that code does nothing' };
    if (redeemedCodes().includes(code)) return { ok: false, msg: '🎟 already used here' };
    markRedeemed(code);
    verium.add(amount);
    return { ok: true, msg: `🎁 +${amount.toLocaleString()} ⬡ added!` };
  }

  private openSettings(): void {
    if (!this.settings) return;
    this.settings.visible = true;
    this.layoutSettings(this.game.viewWidth, this.game.viewHeight);
  }

  private layoutSettings(W: number, H: number): void {
    if (!this.settings) return;
    this.settingsBg.clear();
    this.settingsBg.rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.97 });
    this.settingsTitle.position.set(W / 2, 84);
    this.settingsRows.forEach((row, i) => row.position.set(W / 2, 190 + i * 96));
    const below = 190 + this.settingsRows.length * 96;
    this.settingsNote.position.set(W / 2, below + 10);
    this.settingsClose.position.set(W / 2, Math.min(H - 76, below + 120));
  }

  private layoutFinder(W: number, H: number): void {
    if (!this.finder) return;
    this.finderBg.clear();
    this.finderBg.rect(0, 0, W, H).fill({ color: 0x0a0812, alpha: 0.97 });
    this.finderTitle.position.set(W / 2, 74);
    this.finderHint.position.set(W / 2, 136);
    this.finderRows.forEach((row, i) => row.position.set(W / 2, 214 + i * 92));
    this.finderRefresh.position.set(W / 2 - 140, H - 76);
    this.finderClose.position.set(W / 2 + 140, H - 76);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    window.__hushfall = {
      scene: () => 'menu',
      code: () => null,
      playerCount: () => 0,
      verium: () => verium.balance(),
      redeem: (code: string) => this.redeemCode(code).ok,
    };

    this.moon = new Graphics()
      .circle(0, 0, 120)
      .fill({ color: NIGHT.moon, alpha: 0.16 })
      .circle(0, 0, 78)
      .fill(NIGHT.moon);
    this.stage.addChild(this.moon);

    this.titleT = makeText(GAME_TITLE, 96, { color: NIGHT.ink, letterSpacing: 8 });
    this.stage.addChild(this.titleT);
    this.sub = makeText('light the lanterns · escape the dark', 24, {
      color: NIGHT.inkSoft,
      weight: 'bold',
    });
    this.stage.addChild(this.sub);

    this.mascot = new Entity();
    const char = blobCharacter({ radius: 110, color: 0x241f38, seed: 13, shadow: false });
    this.mascot.addChild(char.view);
    this.eyes = new Graphics()
      .circle(-34, -6, 12)
      .fill(NIGHT.lantern)
      .circle(34, -6, 12)
      .fill(NIGHT.lantern);
    char.body.addChild(this.eyes);
    this.mascot.addBehavior(new Wobble({ target: char.body, amount: 0.05, speed: 1.8 }));
    this.add(this.mascot);
    popIn(this.mascot, { duration: 0.5 });

    const relayUrl = resolveRelayUrl();
    if (!relayUrl) {
      const warn = makeText('No relay configured.\nOpen with ?relay=wss://your-relay-url', 30, {
        color: NIGHT.inkSoft,
        weight: 'bold',
        wrapWidth: 640,
      });
      warn.position.set(W / 2, H * 0.66);
      this.stage.addChild(warn);
      this.hostBtn = new UIButton(' ', { width: 1, height: 1, onTap: () => {} });
      this.joinBtn = new UIButton(' ', { width: 1, height: 1, onTap: () => {} });
      this.layout(W, H);
      return;
    }

    this.hostBtn = new UIButton('🩸 HOST A HUNT', {
      width: 480,
      height: 100,
      fontSize: 36,
      fill: NIGHT.blood,
      textColor: 0xffffff,
      onTap: () => void this.hostRoom(relayUrl),
    });
    this.add(this.hostBtn);

    this.joinBtn = new UIButton('🔦 JOIN WITH CODE', {
      width: 480,
      height: 100,
      fontSize: 34,
      fill: 0x2a3a4a,
      textColor: NIGHT.ink,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        sting('blip');
        this.game.scenes.replace(new JoinScene());
      },
    });
    this.add(this.joinBtn);

    this.findBtn = new UIButton('🔍 FIND A HUNT', {
      width: 480,
      height: 92,
      fontSize: 30,
      fill: NIGHT.violet,
      textColor: 0x140f1e,
      onTap: () => void this.openFinder(relayUrl),
    });
    this.add(this.findBtn);
    this.buildFinder(relayUrl);

    this.classesBtn = new UIButton('🎓 CLASSES', {
      width: 480,
      height: 84,
      fontSize: 28,
      fill: 0x3a2c4e,
      textColor: NIGHT.ink,
      onTap: () => {
        sting('blip');
        this.classesPanel ??= new ClassesPanel(this.stage, () => ({
          w: this.game.viewWidth,
          h: this.game.viewHeight,
        }));
        this.classesPanel.open();
      },
    });
    this.add(this.classesBtn);

    const rejoin = lastRoom();
    if (rejoin) {
      this.rejoinBtn = new UIButton(`↩ REJOIN ${rejoin}`, {
        width: 480,
        height: 84,
        fontSize: 30,
        fill: NIGHT.violet,
        textColor: 0x140f1e,
        onTap: () => void this.joinRoom(relayUrl, rejoin),
      });
      this.add(this.rejoinBtn);
    }

    this.status = makeText('', 28, { color: NIGHT.blood, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    // Settings gear — music/sfx/voice/recording all live in one overlay.
    setMusic(musicPref());
    setSfx(sfxPref());
    this.soundBtn = new UIButton('⚙️', {
      width: 64,
      height: 64,
      fontSize: 28,
      fill: 0x1a1826,
      textColor: NIGHT.ink,
      onTap: () => {
        sting('blip');
        this.openSettings();
      },
    });
    this.add(this.soundBtn);
    this.buildSettings();

    this.creditsBtn = new UIButton('🎬', {
      width: 64,
      height: 64,
      fontSize: 28,
      fill: 0x1a1826,
      textColor: NIGHT.ink,
      onTap: () => {
        sting('blip');
        this.credits ??= (() => {
          this.buildCredits();
          return this.credits;
        })();
        if (this.credits) {
          this.credits.visible = true;
          this.stage.addChild(this.credits); // keep above everything
          this.layoutCredits(this.game.viewWidth, this.game.viewHeight);
        }
      },
    });
    this.add(this.creditsBtn);

    // Build tag: lets players (and bug reports) confirm which deploy they run.
    this.versionT = makeText(GAME_VERSION, 18, { color: NIGHT.inkSoft });
    this.versionT.alpha = 0.6;
    this.stage.addChild(this.versionT);

    this.layout(W, H);

    window.__hushfall = {
      scene: () => 'menu',
      code: () => null,
      playerCount: () => 0,
      host: () => void this.hostRoom(relayUrl),
      verium: () => verium.balance(),
      redeem: (code: string) => this.redeemCode(code).ok,
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('host')) void this.hostRoom(relayUrl);
    const joinCode = params.get('join');
    if (joinCode) this.game.scenes.replace(new JoinScene(joinCode.toUpperCase()));
  }

  protected override onExit(): void {
    delete window.__hushfall;
  }

  // ------------------------------------------------------ room browser

  /** The Find-a-Hunt overlay: every PUBLIC Hushfall room on the relay,
   *  tap one to join. Private rooms never appear here. */
  private buildFinder(relayUrl: string): void {
    this.finder = new Container();
    this.finder.visible = false;
    this.finderBg = new Graphics();
    this.finderBg.eventMode = 'static'; // swallow taps behind the overlay
    this.finder.addChild(this.finderBg);
    this.finderTitle = makeText('🔍 OPEN HUNTS', 44, { color: NIGHT.violet });
    this.finder.addChild(this.finderTitle);
    this.finderHint = makeText('', 22, { color: NIGHT.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.finder.addChild(this.finderHint);
    this.finderRefresh = new UIButton('⟳ REFRESH', {
      width: 240,
      height: 72,
      fontSize: 24,
      fill: 0x2a3a4a,
      textColor: NIGHT.ink,
      onTap: () => void this.refreshFinder(relayUrl),
    });
    this.finder.addChild(this.finderRefresh);
    this.finderClose = new UIButton('CLOSE', {
      width: 240,
      height: 72,
      fontSize: 24,
      fill: NIGHT.blood,
      textColor: 0xffffff,
      onTap: () => {
        sting('blip');
        if (this.finder) this.finder.visible = false;
      },
    });
    this.finder.addChild(this.finderClose);
    this.stage.addChild(this.finder);
  }

  private async openFinder(relayUrl: string): Promise<void> {
    if (!this.finder) return;
    sting('blip');
    this.finder.visible = true;
    this.stage.addChild(this.finder); // keep it on top
    await this.refreshFinder(relayUrl);
  }

  private async refreshFinder(relayUrl: string): Promise<void> {
    if (!this.finder) return;
    for (const row of this.finderRows) {
      this.finder.removeChild(row);
      row.destroy({ children: true });
    }
    this.finderRows = [];
    this.finderHint.text = 'searching the dark…';
    const found = await listRooms(relayUrl, GAME_TAG);
    if (!this.finder.visible) return;
    this.finderHint.text = found.length
      ? 'tap a hunt to join'
      : 'no open hunts right now — host one and flip it 🌐 PUBLIC!';
    found.slice(0, 6).forEach((r) => {
      const full = r.players >= r.max;
      const row = new UIButton(`🏚️ ${r.label} · ${r.info} · ${r.players}/${r.max}`, {
        width: 600,
        height: 78,
        fontSize: 23,
        fill: full ? 0x1a1826 : 0x2a3a4a,
        textColor: full ? NIGHT.inkSoft : NIGHT.ink,
        onTap: () => {
          if (!full) void this.joinRoom(relayUrl, r.code);
        },
      });
      this.finder!.addChild(row);
      this.finderRows.push(row);
    });
    this.layoutFinder(this.game.viewWidth, this.game.viewHeight);
  }

  private async hostRoom(relayUrl: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sting('blip');
    if (this.status) {
      this.status.style.fill = NIGHT.inkSoft;
      this.status.text = 'summoning a room…\n(a sleeping relay can take ~30s to wake)';
    }
    try {
      const session = await host({
        url: relayUrl,
        game: GAME_TAG,
        name: savedName() ?? playerName(),
      });
      this.game.scenes.replace(new LobbyScene(session));
    } catch (err) {
      this.busy = false;
      if (this.status) {
        this.status.style.fill = NIGHT.blood;
        this.status.text = `Could not reach the relay:\n${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  private async joinRoom(relayUrl: string, code: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sting('blip');
    if (this.status) {
      this.status.style.fill = NIGHT.inkSoft;
      this.status.text = 'rejoining…';
    }
    try {
      const session = await join(code, savedName() ?? playerName(), {
        url: relayUrl,
        game: GAME_TAG,
      });
      this.game.scenes.replace(new LobbyScene(session));
    } catch (err) {
      this.busy = false;
      clearLastRoom();
      if (this.rejoinBtn) this.rejoinBtn.visible = false;
      if (this.status) {
        this.status.style.fill = NIGHT.blood;
        this.status.text = `That room is gone.\n${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    if (this.eyes) this.eyes.alpha = Math.sin(this.t * 3) > 0.9 ? 0.3 : 1;
  }
}
