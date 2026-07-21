import { Entity, Scene, Wobble, audio, blobCharacter, partyPop, popIn } from '@interverse/engine';
import { host } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import type { Text } from 'pixi.js';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { makeText, playerName } from '../text.js';
import { JoinScene } from './JoinScene.js';
import { PartyScene } from './PartyScene.js';

interface TapsDebug {
  scene: () => string;
  code: () => string | null;
  playerCount: () => number;
  taps: () => number;
}

declare global {
  interface Window {
    __taps?: TapsDebug;
  }
}

export class MenuScene extends Scene {
  private t = 0;
  private busy = false;
  private status: Text | null = null;

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    window.__taps = {
      scene: () => 'menu',
      code: () => null,
      playerCount: () => 0,
      taps: () => 0,
    };

    const title = makeText('TAP PARTY', 104, { color: partyPop.accent, letterSpacing: 4 });
    title.position.set(W / 2, H * 0.18);
    this.stage.addChild(title);

    const sub = makeText('everyone taps on their own phone', 30, {
      color: partyPop.inkSoft,
      weight: 'bold',
    });
    sub.position.set(W / 2, H * 0.18 + 80);
    this.stage.addChild(sub);

    const mascot = new Entity();
    const char = blobCharacter({ radius: 110, color: partyPop.colors[3] ?? 0x6fc3ff, seed: 11 });
    mascot.addChild(char.view);
    mascot.position.set(W / 2, H * 0.42);
    mascot.addBehavior(new Wobble({ target: char.body, amount: 0.04, speed: 2.3 }));
    this.add(mascot);
    popIn(mascot, { duration: 0.5 });

    const relayUrl = resolveRelayUrl();
    if (!relayUrl) {
      const warn = makeText(
        'No relay configured.\nDeploy the relay server, then open this page\nwith ?relay=wss://your-relay-url',
        30,
        { color: partyPop.inkSoft, weight: 'bold', wrapWidth: 640 },
      );
      warn.position.set(W / 2, H * 0.68);
      this.stage.addChild(warn);
      return;
    }

    const hostBtn = new UIButton('HOST A ROOM', {
      width: 460,
      height: 96,
      fontSize: 36,
      onTap: () => void this.hostRoom(relayUrl),
    });
    hostBtn.position.set(W / 2, H * 0.64);
    this.add(hostBtn);

    const joinBtn = new UIButton('JOIN WITH CODE', {
      width: 460,
      height: 96,
      fontSize: 36,
      fill: 0x8affc1,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        this.game.scenes.replace(new JoinScene());
      },
    });
    joinBtn.position.set(W / 2, H * 0.64 + 130);
    this.add(joinBtn);

    this.status = makeText('', 28, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.status.position.set(W / 2, H * 0.86);
    this.stage.addChild(this.status);

    // Playtest levers: ?host=1 auto-hosts, ?join=CODE auto-joins.
    const params = new URLSearchParams(window.location.search);
    if (params.get('host')) void this.hostRoom(relayUrl);
    const joinCode = params.get('join');
    if (joinCode) this.game.scenes.replace(new JoinScene(joinCode.toUpperCase()));
  }

  protected override onExit(): void {
    delete window.__taps;
  }

  private async hostRoom(relayUrl: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.blip();
    try {
      const session = await host({ url: relayUrl, game: GAME_TAG, name: playerName() });
      this.game.scenes.replace(new PartyScene(session));
    } catch (err) {
      this.busy = false;
      if (this.status) {
        this.status.text = `Could not reach the relay:\n${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
  }
}
