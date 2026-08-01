/**
 * 🏁 How it ended.
 *
 * Three jobs, in order of how much they matter: say the number, say whether
 * it was your best, and put RUN AGAIN under your thumb. A run ends in about
 * a minute, so anything that stands between the end of one and the start of
 * the next is friction paid many times over.
 */

import { Graphics, Text } from 'pixi.js';
import { Scene, audio } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { DIM, GOLD, INK, MINT, NIGHT, ROSE, ZONES } from '../theme.js';
import type { RunResult } from './run.js';

const CAUSE: Record<RunResult['cause'], string> = {
  hit: 'Caught!',
  pit: 'Straight down a hole.',
  corner: 'Missed the turn.',
};

export class ResultScene extends Scene {
  constructor(
    private readonly result: RunResult,
    private readonly best: boolean,
    private readonly coinsTotal: number,
    private readonly onAgain: () => void,
    private readonly onMenu: () => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    this.build();
    if (this.best) audio.chime();
  }

  protected override onResize(): void {
    this.stage.removeChildren();
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.stage.addChild(new Graphics().rect(0, 0, W, H).fill(NIGHT));

    const head = label(this.best ? 'NEW BEST!' : CAUSE[this.result.cause], 38, this.best ? MINT : ROSE, '800');
    head.anchor.set(0.5);
    head.position.set(W / 2, H * 0.16);

    // The number, as big as it will go. It is the only thing anybody looks at.
    const metres = label(`${this.result.metres} m`, Math.min(110, W / 6), INK, '800');
    metres.anchor.set(0.5);
    metres.position.set(W / 2, H * 0.4);

    const line = label(
      `🪙 ${this.result.coins} collected  ·  ${this.coinsTotal} in the pocket`,
      20,
      DIM,
    );
    // How far through the journey, not just where you stopped. "Sunken Ruins"
    // means nothing on its own; "3 of 8" is a thing to beat.
    const got = label(
      `reached ${this.result.zoneN} of ${ZONES.length} — ${this.result.zone}`,
      22,
      this.result.zoneN >= ZONES.length ? MINT : GOLD,
      '800',
    );
    got.anchor.set(0.5);
    got.position.set(W / 2, H * 0.66);
    this.stage.addChild(got);
    line.anchor.set(0.5);
    line.position.set(W / 2, H * 0.58);
    this.stage.addChild(head, metres, line);

    const again = new UIButton('▶ RUN AGAIN', {
      width: Math.min(340, W - 220), fill: MINT, onTap: () => this.onAgain(),
    });
    again.position.set(W / 2, H * 0.78);
    this.add(again);

    const shop = new UIButton('🎩 HATS', {
      width: 170, height: 66, fontSize: 20, fill: GOLD, onTap: () => this.onMenu(),
    });
    shop.position.set(W / 2, H * 0.9);
    this.add(shop);
  }

  // ------------------------------------------------- headless test hooks

  debugAgain(): void {
    this.onAgain();
  }

  debugMenu(): void {
    this.onMenu();
  }

  debugMetres(): number {
    return this.result.metres;
  }
}

function label(s: string, size: number, fill: number, weight: '700' | '800' = '700'): Text {
  return new Text({
    text: s,
    style: {
      fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill,
      align: 'center', wordWrap: true, wordWrapWidth: 900,
    },
  });
}
