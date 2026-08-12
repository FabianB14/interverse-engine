import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Wobble, blobCharacter, popIn } from '@interverse/engine';
import { host, join, listRooms } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { GAME_TITLE } from '../game.js';
import { NIGHT, setMusic, sting } from '../theme.js';
import { makeText, playerName } from '../text.js';
import { clearLastRoom, lastRoom, musicPref, savedName, setMusicPref } from '../store.js';
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
  private finder: Container | null = null;
  private finderBg!: Graphics;
  private finderTitle!: Text;
  private finderHint!: Text;
  private finderRows: UIButton[] = [];
  private finderRefresh!: UIButton;
  private finderClose!: UIButton;
  private moon!: Graphics;
  private eyes!: Graphics;
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
      this.rejoinBtn?.position.set(W * 0.72, H * 0.24 + 330);
      this.status?.position.set(W * 0.72, H * 0.9);
      this.soundBtn?.position.set(52, H - 52);
      this.layoutFinder(W, H);
      return;
    }
    this.moon.position.set(W * 0.78, H * 0.14);
    this.titleT.position.set(W / 2, H * 0.2);
    this.sub.position.set(W / 2, H * 0.2 + 74);
    this.mascot.position.set(W / 2, H * 0.44);
    this.hostBtn.position.set(W / 2, H * 0.6);
    this.joinBtn.position.set(W / 2, H * 0.6 + 118);
    this.findBtn?.position.set(W / 2, H * 0.6 + 226);
    this.rejoinBtn?.position.set(W / 2, H * 0.6 + 330);
    this.status?.position.set(W / 2, H * 0.95);
    this.soundBtn?.position.set(52, H - 52);
    this.layoutFinder(W, H);
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
    window.__hushfall = { scene: () => 'menu', code: () => null, playerCount: () => 0 };

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
    this.eyes = new Graphics().circle(-34, -6, 12).fill(NIGHT.lantern).circle(34, -6, 12).fill(NIGHT.lantern);
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

    // The atmosphere toggle the save always had a slot for.
    setMusic(musicPref());
    this.soundBtn = new UIButton(musicPref() ? '🔊' : '🔇', {
      width: 64,
      height: 64,
      fontSize: 28,
      fill: 0x1a1826,
      textColor: NIGHT.ink,
      onTap: () => {
        const on = !musicPref();
        setMusicPref(on);
        setMusic(on);
        this.soundBtn?.setLabel(on ? '🔊' : '🔇');
        sting('blip');
      },
    });
    this.add(this.soundBtn);

    this.layout(W, H);

    window.__hushfall = {
      scene: () => 'menu',
      code: () => null,
      playerCount: () => 0,
      host: () => void this.hostRoom(relayUrl),
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
      const session = await host({ url: relayUrl, game: GAME_TAG, name: savedName() ?? playerName() });
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
      const session = await join(code, savedName() ?? playerName(), { url: relayUrl, game: GAME_TAG });
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
