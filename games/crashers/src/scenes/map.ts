/**
 * 🗺 The campaign map: fifteen stops, and where to spend a level-up.
 *
 * A brawler's map screen does two jobs — show how far you have got, and let
 * you go back for another run at a stage that beat you. Both are progress
 * made visible, which is most of what keeps a fifteen-stage campaign going.
 *
 * Upgrades live here too rather than on their own screen: the moment you
 * have a point to spend is the moment you are choosing the next stage, and
 * making that one decision instead of two is the whole reason to combine
 * them.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { Entity, Scene, audio, levelFromXp } from '@interverse/engine';
import type { Upgrades } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { STAGES, foeCount } from '../levels.js';
import { isUnlocked, loadRun, saveRun, spendPoint, unspentPoints } from '../save.js';

export class MapScene extends Scene {
  private hud = new Container();

  constructor(
    private readonly onPlay: (stage: number) => void,
    private readonly onMenu: () => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    this.build();
    audio.music.play('adventure');
  }

  protected override onExit(): void {
    audio.music.stop();
  }

  protected override onResize(): void {
    this.rebuild();
  }

  private rebuild(): void {
    this.stage.removeChildren();
    this.hud = new Container();
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const run = loadRun();
    const level = levelFromXp(run.xp);
    const points = unspentPoints(run);

    const bg = new Graphics().rect(0, 0, W, H).fill(0x18122a);
    this.stage.addChild(bg);

    const title = new Text({
      text: 'THE CAMPAIGN',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 34, fontWeight: '800', fill: 0xffd166 },
    });
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, 16);
    const line = new Text({
      text: `Lv ${level}  ·  ${run.xp} XP  ·  ${run.coins} 🪙  ·  ${run.cleared}/${STAGES.length} cleared`,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 19, fontWeight: '700', fill: 0x9a97b8 },
    });
    line.anchor.set(0.5, 0);
    line.position.set(W / 2, 58);
    this.stage.addChild(title, line);

    // The stage grid. Five across reads as the five acts the table is built
    // in, and keeps every node a real touch target on a phone.
    const cols = W > 900 ? 5 : 3;
    const cellW = Math.min(170, (W - 60) / cols);
    const cellH = 96;
    const rows = Math.ceil(STAGES.length / cols);
    // Centre the grid in the space between the header and the buttons, so
    // it neither collides with the stats line nor floats in a sea of empty
    // screen — both of which it did before this was measured rather than
    // guessed at.
    const headerBottom = 92;
    const footerTop = H - (points > 0 ? 190 : 110);
    const gridTop = Math.max(headerBottom + 40, (headerBottom + footerTop) / 2 - ((rows - 1) * cellH) / 2);
    const left = W / 2 - (cellW * (cols - 1)) / 2;
    STAGES.forEach((s, i) => {
      const open = isUnlocked(run, s.n);
      const done = run.cleared >= s.n;
      const node = new Container();
      const g = new Graphics();
      const w = cellW - 14;
      g.roundRect(-w / 2, -30, w, 60, 12).fill(open ? (done ? 0x2f6b45 : 0x3a2b5d) : 0x241d33);
      if (open) g.roundRect(-w / 2, -30, w, 60, 12).stroke({ color: done ? 0x8affc1 : 0xffd166, width: 3 });
      node.addChild(g);
      const label = new Text({
        text: `${s.n}. ${s.name}`,
        style: {
          fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: '800',
          fill: open ? 0xe6e4f0 : 0x5c5470, align: 'center',
          wordWrap: true, wordWrapWidth: w - 12,
        },
      });
      label.anchor.set(0.5);
      label.position.set(0, -6);
      node.addChild(label);
      // Difficulty as pips: readable without a number, and honest — it is
      // the same tier the enemies are actually scaled by.
      const pips = new Text({
        text: (done ? '✓ ' : '') + '◆'.repeat(Math.min(5, Math.ceil(s.tier / 2))) + (s.boss ? ' 👑' : ''),
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fontWeight: '700', fill: open ? 0xffd166 : 0x4a4363 },
      });
      pips.anchor.set(0.5);
      pips.position.set(0, 16);
      node.addChild(pips);
      node.position.set(left + (i % cols) * cellW, gridTop + Math.floor(i / cols) * cellH);
      if (open) {
        node.eventMode = 'static';
        node.cursor = 'pointer';
        node.hitArea = { contains: (x: number, y: number) => Math.abs(x) < w / 2 && Math.abs(y) < 30 };
        node.on('pointertap', () => {
          audio.chime();
          this.onPlay(s.n);
        });
      }
      node.alpha = open ? 1 : 0.55;
      this.stage.addChild(node);
      void foeCount(s);
    });

    const gridBottom = gridTop + rows * cellH - 30;

    // Upgrades — only shown when there is something to spend, so the screen
    // is not carrying a dead panel for most of the game.
    if (points > 0) {
      const head = new Text({
        text: `${points} upgrade point${points > 1 ? 's' : ''} to spend`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fontWeight: '800', fill: 0x8affc1 },
      });
      head.anchor.set(0.5, 0);
      head.position.set(W / 2, gridBottom + 4);
      this.stage.addChild(head);
      const specs: { key: keyof Upgrades; label: string }[] = [
        { key: 'power', label: '👊 Power' },
        { key: 'speed', label: '🏃 Speed' },
        { key: 'hearts', label: '♥ Hearts' },
      ];
      specs.forEach((sp, i) => {
        const b = new UIButton(`${sp.label} +1  (${run.upgrades[sp.key]})`, {
          width: Math.min(240, (W - 60) / 3), height: 74, fontSize: 18,
          onTap: () => {
            saveRun(spendPoint(loadRun(), sp.key));
            audio.pop(1.3);
            this.rebuild();
          },
        });
        b.position.set(W / 2 + (i - 1) * Math.min(250, (W - 40) / 3), gridBottom + 60);
        this.add(b);
      });
    }

    const back = new UIButton('◀ Change blob', {
      width: 240, height: 68, fontSize: 18, onTap: () => this.onMenu(),
    });
    back.position.set(W / 2, H - 52);
    this.add(back);
    this.stage.addChild(this.hud);
  }

  // ------------------------------------------------- headless test hooks

  debugPlay(n: number): void {
    this.onPlay(n);
  }

  debugUnlocked(): number[] {
    const run = loadRun();
    return STAGES.filter((s) => isUnlocked(run, s.n)).map((s) => s.n);
  }

  debugSpend(on: keyof Upgrades): void {
    saveRun(spendPoint(loadRun(), on));
    this.rebuild();
  }
}

/** Result screen between stages: what you earned, and where next. */
export class ResultScene extends Scene {
  constructor(
    private readonly won: boolean,
    private readonly stageName: string,
    private readonly xp: number,
    private readonly coins: number,
    private readonly onNext: () => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const e = new Entity();
    e.addChild(new Graphics().rect(0, 0, W, H).fill(this.won ? 0x1b3326 : 0x33161f));
    this.add(e);
    const title = new Text({
      text: this.won ? 'STAGE CLEAR!' : 'DEFEATED',
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: Math.min(62, W / 10), fontWeight: '800',
        fill: this.won ? 0x8affc1 : 0xff6f91,
      },
    });
    title.anchor.set(0.5);
    title.position.set(W / 2, H * 0.32);
    const sub = new Text({
      // A losing run still banks what it earned. Losing an hour of progress
      // to one bad fight is how a fifteen-stage campaign loses a player.
      text: `${this.stageName}\n+${this.xp} XP   +${this.coins} 🪙`,
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: 24, fontWeight: '700',
        fill: 0xe6e4f0, align: 'center',
      },
    });
    sub.anchor.set(0.5);
    sub.position.set(W / 2, H * 0.46);
    this.stage.addChild(title, sub);
    const go = new UIButton(this.won ? '▶ To the map' : '↻ Try again', {
      width: Math.min(340, W - 80), fill: 0xffd166, onTap: () => this.onNext(),
    });
    go.position.set(W / 2, H * 0.68);
    this.add(go);
    audio[this.won ? 'chime' : 'buzz']();
  }

  debugNext(): void {
    this.onNext();
  }
}
