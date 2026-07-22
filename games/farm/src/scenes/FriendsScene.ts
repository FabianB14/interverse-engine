import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, audio, darken, makeTappable } from '@interverse/engine';
import { host } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { GAME_TAG, resolveRelayUrl } from '../config.js';
import { savedName } from '../store.js';
import { friends, removeFriend } from '../friends.js';
import type { Friend } from '../friends.js';
import { VisitScene } from './VisitScene.js';
import { VisitJoinScene } from './VisitJoinScene.js';
import { TitleScene } from './TitleScene.js';
import '../debug.js';

/** Friends hub: open your farm for visitors, or drop by a friend's farm. */
export class FriendsScene extends Scene {
  private uiLayer!: Container;
  private listLayer!: Container;
  private titleText!: Text;
  private status!: Text;
  private backBtn!: UIButton;
  private hostBtn!: UIButton;
  private visitBtn!: UIButton;
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
    bg.rect(0, this.H * 0.62, this.W, this.H * 0.38).fill(FARM.grassDark);
    this.stage.addChild(bg);

    this.listLayer = new Container();
    this.uiLayer = new Container();
    this.stage.addChild(this.listLayer, this.uiLayer);

    this.titleText = makeText('👥 Friends', 56, { color: FARM.accent });
    this.uiLayer.addChild(this.titleText);
    this.status = makeText('', 24, { color: FARM.inkSoft, weight: 'bold', wrapWidth: 640 });
    this.uiLayer.addChild(this.status);

    this.backBtn = new UIButton('← Back', {
      width: 190,
      height: 72,
      fontSize: 28,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.game.scenes.replace(new TitleScene()),
    });
    this.add(this.backBtn, this.uiLayer);

    this.hostBtn = new UIButton('🏡 Open My Farm', {
      width: 500,
      height: 96,
      fontSize: 34,
      fill: FARM.accent,
      textColor: 0x2a2016,
      onTap: () => void this.openMyFarm(),
    });
    this.add(this.hostBtn, this.uiLayer);

    this.visitBtn = new UIButton('🚪 Visit by Code', {
      width: 500,
      height: 96,
      fontSize: 34,
      fill: 0x8fd06a,
      textColor: 0x1c2a12,
      onTap: () => {
        if (this.busy || this.game.scenes.isTransitioning) return;
        audio.blip();
        this.game.scenes.replace(new VisitJoinScene());
      },
    });
    this.add(this.visitBtn, this.uiLayer);

    this.buildList();
    this.layout();

    window.__farm = {
      scene: () => 'friends',
      openFarm: () => void this.openMyFarm(),
      friends: () => friends().map((f) => f.code),
      visitByCode: (c: string) => this.game.scenes.replace(new VisitJoinScene(c)),
    };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private layout(): void {
    const W = this.W;
    this.backBtn.position.set(120, 54);
    this.titleText.position.set(W / 2, this.H * 0.1);
    this.hostBtn.position.set(W / 2, this.H * 0.24);
    this.visitBtn.position.set(W / 2, this.H * 0.24 + 116);
    this.status.position.set(W / 2, this.H * 0.9);
    this.buildList();
  }

  private buildList(): void {
    if (!this.listLayer) return;
    for (const old of this.listLayer.removeChildren()) old.destroy({ children: true });
    const list = friends();
    const heading = makeText(
      list.length ? 'recent farms — tap to visit' : 'no friends yet — visit a code to add one',
      22,
      { color: FARM.inkSoft, weight: '800' },
    );
    heading.position.set(this.W / 2, this.H * 0.46);
    this.listLayer.addChild(heading);
    list.slice(0, 6).forEach((f, i) => {
      const row = this.friendRow(f);
      row.position.set(this.W / 2, this.H * 0.52 + i * 84);
      this.listLayer.addChild(row);
    });
  }

  private friendRow(f: Friend): Container {
    const row = new Container();
    const w = Math.min(560, this.W * 0.86);
    const bg = new Graphics();
    bg.roundRect(-w / 2, -34, w, 68, 16).fill(FARM.panel);
    bg.roundRect(-w / 2, -34, w, 68, 16).stroke({ color: darken(FARM.panel, 0.3), width: 2 });
    row.addChild(bg);
    const name = makeText(`${f.name}  ·  ${f.code}`, 26, { color: FARM.ink, weight: '800' });
    name.anchor.set(0, 0.5);
    name.position.set(-w / 2 + 24, 0);
    row.addChild(name);
    // Tapping the row visits; a small ✕ removes.
    const hit = new Entity();
    makeTappable(hit, () => this.visitFriend(f.code), {
      hitRect: { x: -w / 2, y: -34, width: w - 70, height: 68 },
    });
    row.addChild(hit);
    const del = new UIButton('✕', {
      width: 56,
      height: 56,
      fontSize: 24,
      fill: 0x5a4632,
      textColor: FARM.ink,
      onTap: () => {
        removeFriend(f.code);
        this.buildList();
      },
    });
    del.position.set(w / 2 - 40, 0);
    this.add(del, row);
    return row;
  }

  private visitFriend(code: string): void {
    if (this.busy || this.game.scenes.isTransitioning) return;
    audio.blip();
    this.game.scenes.replace(new VisitJoinScene(code));
  }

  private async openMyFarm(): Promise<void> {
    if (this.busy || this.game.scenes.isTransitioning) return;
    const relay = resolveRelayUrl();
    if (!relay) {
      this.status.text = 'no relay configured (add ?relay=…)';
      return;
    }
    this.busy = true;
    audio.blip();
    this.status.style.fill = FARM.inkSoft;
    this.status.text = 'opening your farm…\n(a sleeping relay can take ~30s)';
    try {
      const session = await host({ url: relay, game: GAME_TAG, name: savedName() ?? 'Farmer' });
      this.game.scenes.replace(new VisitScene(session));
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff5470;
      this.status.text = `couldn't open your farm:\n${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
