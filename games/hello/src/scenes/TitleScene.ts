import { Rectangle } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Wobble, audio, blobCharacter, partyPop, popIn } from '@interverse/engine';
import { makeText } from '../ui.js';
import { BEST_KEY, store } from '../store.js';
import { PlayScene } from './PlayScene.js';

export class TitleScene extends Scene {
  private t = 0;
  private started = false;
  private tapHint!: Text;
  private mascot!: Entity;

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;

    const title = makeText('BLOB TAP', 108, { color: partyPop.accent, letterSpacing: 4 });
    title.position.set(W / 2, H * 0.2);
    this.stage.addChild(title);

    const sub = makeText('tap the blobs before they pop away!', 30, {
      color: partyPop.inkSoft,
      weight: 'bold',
    });
    sub.position.set(W / 2, H * 0.2 + 84);
    this.stage.addChild(sub);

    this.mascot = new Entity();
    const char = blobCharacter({ radius: 130, color: partyPop.colors[0] ?? 0xff6f91, seed: 7 });
    this.mascot.addChild(char.view);
    this.mascot.position.set(W / 2, H * 0.52);
    this.mascot.addBehavior(new Wobble({ target: char.body, amount: 0.04, speed: 2.2 }));
    this.add(this.mascot);
    popIn(this.mascot, { duration: 0.5 });

    const best = store.get(BEST_KEY, 0);
    if (best > 0) {
      const bestText = makeText(`BEST  ${best}`, 34, { color: partyPop.ink, weight: 'bold' });
      bestText.position.set(W / 2, H * 0.7);
      this.stage.addChild(bestText);
    }

    this.tapHint = makeText('TAP TO START', 44, { color: partyPop.ink });
    this.tapHint.position.set(W / 2, H * 0.82);
    this.stage.addChild(this.tapHint);

    this.stage.eventMode = 'static';
    this.stage.hitArea = new Rectangle(0, 0, W, H);
    this.stage.on('pointerdown', () => this.start());
  }

  private start(): void {
    if (this.started || this.game.scenes.isTransitioning) return;
    this.started = true;
    audio.blip();
    this.game.scenes.replace(new PlayScene());
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    this.tapHint.alpha = 0.6 + Math.sin(this.t * 4) * 0.4;
    this.mascot.y = this.game.designHeight * 0.52 + Math.sin(this.t * 1.6) * 12;
  }
}
