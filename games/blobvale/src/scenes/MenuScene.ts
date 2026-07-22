import { Entity, Scene, Wobble, audio, blobCharacter, partyPop, popIn } from '@interverse/engine';
import { host } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import type { Text } from 'pixi.js';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { GAME_TITLE } from '../game.js';
import { makeText, playerName } from '../text.js';
import { JoinScene } from './JoinScene.js';
import { NameScene } from './NameScene.js';
import { NAME_KEY, cleanName, lastRoom, savedName, store } from '../store.js';
import { LobbyScene } from './LobbyScene.js';
import { SyncScene } from './SyncScene.js';

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
  myStats?: () => { hp: number; max: number; lvl: number; xp: number; mods?: string[] } | null;
  kills?: () => number;
  warp?: (x: number, y: number) => void;
  names?: () => string[];
  classes?: () => Record<string, string>;
  pick?: (cls: string) => void;
  bossHp?: () => number | null;
  revive?: () => void;
  looks?: () => Record<string, number>;
  setLook?: (i: number) => void;
  accs?: () => Record<string, number>;
  setAcc?: (i: number) => void;
  voices?: () => Record<string, number>;
  setVoice?: (i: number) => void;
  upgradeOpen?: () => boolean;
  pickUpgrade?: (i: number) => void;
  dmgMul?: () => number;
  casts?: () => number;
  booms?: () => number;
  giveMod?: (id: string) => void;
  zone?: () => number;
  portalOpen?: () => boolean;
  killBoss?: () => void;
  enterPortal?: () => void;
  verium?: () => number;
  veriumEarned?: () => number;
  partySize?: () => number;
  mobInfo?: () => Array<{
    v: string;
    fz: boolean;
    ci: boolean;
    po: boolean;
    bu: boolean;
    sh: boolean;
  }>;
  zapNearest?: (kind: 'freeze' | 'poison' | 'burn' | 'shock') => boolean | null;
  grantVerium?: (n: number) => number;
  owned?: () => number[];
  buyAcc?: (i: number) => void;
  previewStore?: (i: number) => void;
  previewingAcc?: () => number | null;
  openCustomize?: () => void;
  customizeOpen?: () => boolean;
  setReady?: (r: boolean) => void;
  ready?: () => Record<string, boolean>;
  countdown?: () => number | null;
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
  private title: Text | null = null;
  private mascot: Entity | null = null;
  private rejoinBtn: UIButton | null = null;
  private syncBtn: UIButton | null = null;
  private hostBtn: UIButton | null = null;
  private joinBtn: UIButton | null = null;
  private nameBtn: UIButton | null = null;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    this.title?.position.set(W / 2, H * 0.16);
    this.mascot?.position.set(W / 2, H * 0.44);
    this.rejoinBtn?.position.set(W / 2, H * 0.58);
    this.syncBtn?.position.set(150, 54);
    this.hostBtn?.position.set(W / 2, H * 0.66);
    this.joinBtn?.position.set(W / 2, H * 0.66 + 124);
    this.status?.position.set(W / 2, H * 0.9);
    this.nameBtn?.position.set(W / 2, H * 0.66 + 218);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    window.__blobvale = { scene: () => 'menu', code: () => null, playerCount: () => 0 };

    // Playtest lever ?name=Ana, and first-launch flow: pick a name first.
    const params0 = new URLSearchParams(window.location.search);
    const qName = params0.get('name');
    if (qName && cleanName(qName)) store.set(NAME_KEY, cleanName(qName));
    if (!savedName()) {
      this.game.scenes.replace(new NameScene());
      return;
    }

    this.title = makeText(GAME_TITLE, 104, { color: partyPop.accent, letterSpacing: 4 });
    this.stage.addChild(this.title);

    const mascot = new Entity();
    this.mascot = mascot;
    const char = blobCharacter({ radius: 110, color: partyPop.colors[0] ?? 0xff6f91, seed: 4 });
    mascot.addChild(char.view);

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

    // Rejoin: if we were knocked out of a room, offer a one-tap way back in.
    const rejoinCode = lastRoom();
    if (rejoinCode) {
      this.rejoinBtn = new UIButton(`🔄 REJOIN ${rejoinCode}`, {
        width: 460,
        height: 82,
        fontSize: 32,
        fill: 0xffd166,
        textColor: 0x1c1c28,
        onTap: () => {
          if (this.busy || this.game.scenes.isTransitioning) return;
          audio.blip();
          this.game.scenes.replace(new JoinScene(rejoinCode));
        },
      });
      this.add(this.rejoinBtn);
    }

    this.hostBtn = new UIButton('HOST A ROOM', {
      width: 460,
      height: 96,
      fontSize: 36,
      onTap: () => void this.hostRoom(relayUrl),
    });
    this.add(this.hostBtn);

    this.joinBtn = new UIButton('JOIN WITH CODE', {
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
    this.add(this.joinBtn);

    this.status = makeText('', 28, { color: 0xff5470, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.status);

    this.syncBtn = new UIButton('🔄 Wallet', {
      width: 230,
      height: 68,
      fontSize: 24,
      fill: 0x2c2150,
      textColor: 0xb8a8e0,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        this.game.scenes.replace(new SyncScene());
      },
    });
    this.add(this.syncBtn);

    this.nameBtn = new UIButton(`playing as ${savedName() ?? '?'} Blob — tap to change`, {
      width: 560,
      height: 66,
      fontSize: 22,
      fill: 0x2c2150,
      textColor: 0xb8a8e0,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        this.game.scenes.replace(new NameScene());
      },
    });
    this.add(this.nameBtn);
    this.layout(W, H);

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
