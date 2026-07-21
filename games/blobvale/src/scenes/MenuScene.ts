import { Entity, Scene, Wobble, audio, blobCharacter, partyPop, popIn } from '@interverse/engine';
import { host } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import type { Text } from 'pixi.js';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { GAME_TITLE } from '../game.js';
import { makeText, playerName } from '../text.js';
import { JoinScene } from './JoinScene.js';
import { LobbyScene } from './LobbyScene.js';

interface LobbyDebug {
  scene: () => string;
  code: () => string | null;
  playerCount: () => number;
  myPos?: () => { x: number; y: number };
  remotePos?: (id: string) => { x: number; y: number } | null;
  remoteIds?: () => string[];
  snapsSeen?: () => number;
  chatsSeen?: () => number;
  sendChat?: (i: number) => void;
  joystickScreen?: () => { x: number; y: number };
  start?: () => void;
  cast?: () => void;
  mobCount?: () => number;
  myStats?: () => { hp: number; max: number; lvl: number; xp: number } | null;
  kills?: () => number;
  warp?: (x: number, y: number) => void;
}

declare global {
  interface Window {
    __blobvale?: LobbyDebug;
  }
}

export class MenuScene extends Scene {
  private t = 0;
  private busy = false;
  private status: Text | null = null;

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    window.__blobvale = { scene: () => 'menu', code: () => null, playerCount: () => 0 };

    const title = makeText(GAME_TITLE, 104, { color: partyPop.accent, letterSpacing: 4 });
    title.position.set(W / 2, H * 0.18);
    this.stage.addChild(title);

    const mascot = new Entity();
    const char = blobCharacter({ radius: 110, color: partyPop.colors[0] ?? 0xff6f91, seed: 4 });
    mascot.addChild(char.view);
    mascot.position.set(W / 2, H * 0.42);
    mascot.addBehavior(new Wobble({ target: char.body, amount: 0.04, speed: 2.3 }));
    this.add(mascot);
    popIn(mascot, { duration: 0.5 });

    const relayUrl = resolveRelayUrl();
    if (!relayUrl) {
      const warn = makeText(
        'No relay configured.\nOpen this page with ?relay=wss://your-relay-url',
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
    delete window.__blobvale;
  }

  private async hostRoom(relayUrl: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    audio.blip();
    if (this.status) {
      this.status.style.fill = partyPop.inkSoft;
      this.status.text = 'connecting…\n(a sleeping relay can take ~30s to wake)';
    }
    try {
      const session = await host({ url: relayUrl, game: GAME_TAG, name: playerName() });
      this.game.scenes.replace(new LobbyScene(session));
    } catch (err) {
      this.busy = false;
      if (this.status) {
        this.status.style.fill = 0xff5470;
        this.status.text = `Could not reach the relay:\n${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
  }
}
