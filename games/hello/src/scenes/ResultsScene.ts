import { Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Wobble, audio, blobCharacter, partyPop, popIn } from '@interverse/engine';
import { makeText } from '../ui.js';
import { BEST_KEY, store } from '../store.js';
import { PlayScene } from './PlayScene.js';

export class ResultsScene extends Scene {
  private t = 0;
  private again = false;
  private tapHint!: Text;
  private newBestText: Text | null = null;

  constructor(private readonly score: number) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    const prevBest = store.get(BEST_KEY, 0);
    const isNewBest = this.score > prevBest;
    if (isNewBest) store.set(BEST_KEY, this.score);
    const best = Math.max(prevBest, this.score);

    const title = makeText("TIME'S UP!", 72, { color: partyPop.ink, letterSpacing: 2 });
    title.position.set(W / 2, H * 0.17);
    this.stage.addChild(title);

    const scoreText = makeText(String(this.score), 150, { color: partyPop.accent });
    scoreText.position.set(W / 2, H * 0.31);
    this.stage.addChild(scoreText);

    const bestText = makeText(`BEST  ${best}`, 36, { color: partyPop.inkSoft, weight: 'bold' });
    bestText.position.set(W / 2, H * 0.42);
    this.stage.addChild(bestText);

    if (isNewBest && this.score > 0) {
      this.newBestText = makeText('NEW BEST!', 52, { color: 0x8affc1 });
      this.newBestText.position.set(W / 2, H * 0.5);
      this.stage.addChild(this.newBestText);
      audio.chime();
    }

    // A little mascot to keep it friendly.
    const mascot = new Entity();
    const char = blobCharacter({ radius: 90, color: partyPop.colors[0] ?? 0xff6f91, seed: 7 });
    mascot.addChild(char.view);
    mascot.position.set(W / 2, H * 0.66);
    mascot.addBehavior(new Wobble({ target: char.body, amount: 0.05, speed: 2.4 }));
    this.add(mascot);
    popIn(mascot, { duration: 0.45 });

    this.tapHint = makeText('TAP TO PLAY AGAIN', 42, { color: partyPop.ink });
    this.tapHint.position.set(W / 2, H * 0.84);
    this.stage.addChild(this.tapHint);

    this.stage.eventMode = 'static';
    this.stage.hitArea = new Rectangle(0, 0, W, H);
    this.stage.on('pointerdown', () => this.replay());
  }

  private replay(): void {
    if (this.again || this.game.scenes.isTransitioning) return;
    this.again = true;
    audio.blip();
    this.game.scenes.replace(new PlayScene());
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.tapHint.alpha = 0.6 + Math.sin(this.t * 4) * 0.4;
    if (this.newBestText) {
      const s = 1 + Math.sin(this.t * 6) * 0.06;
      this.newBestText.scale.set(s);
    }
  }
}
