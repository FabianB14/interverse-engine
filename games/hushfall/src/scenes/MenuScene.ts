import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Wobble, blobCharacter, popIn } from '@interverse/engine';
import { host, join } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { GAME_TITLE } from '../game.js';
import { NIGHT, sting } from '../theme.js';
import { makeText, playerName } from '../text.js';
import { clearLastRoom, lastRoom, savedName } from '../store.js';
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
  private moon!: Graphics;
  private eyes!: Graphics;
  private t = 0;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    this.moon.position.set(W * 0.78, H * 0.14);
    this.titleT.position.set(W / 2, H * 0.2);
    this.sub.position.set(W / 2, H * 0.2 + 74);
    this.mascot.position.set(W / 2, H * 0.44);
    this.hostBtn.position.set(W / 2, H * 0.64);
    this.joinBtn.position.set(W / 2, H * 0.64 + 130);
    this.rejoinBtn?.position.set(W / 2, H * 0.64 + 252);
    this.status?.position.set(W / 2, H * 0.92);
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
