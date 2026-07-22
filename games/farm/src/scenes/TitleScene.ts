import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Tween, Wobble, easings } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { FARM } from '../theme.js';
import { makeText } from '../text.js';
import { music } from '../music.js';
import { GAME_TITLE } from '../game.js';
import { FarmScene } from './FarmScene.js';
import '../debug.js';

/** Cozy title card with a growing sprout and a Play button. */
export class TitleScene extends Scene {
  private title!: Text;
  private sub!: Text;
  private mascot!: Entity;
  private playBtn!: UIButton;
  private busy = false;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    this.title.position.set(W / 2, H * 0.24);
    this.sub.position.set(W / 2, H * 0.24 + 74);
    this.mascot.position.set(W / 2, H * 0.52);
    this.playBtn.position.set(W / 2, H * 0.76);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;

    // Soft sky-to-field backdrop.
    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill(FARM.bg);
    bg.rect(0, H * 0.62, W, H * 0.38).fill(FARM.grassDark);
    bg.ellipse(W / 2, H * 0.62, W, H * 0.12).fill(FARM.grass);
    this.stage.addChild(bg);

    this.title = makeText(GAME_TITLE, 96, { color: FARM.accent, letterSpacing: 2 });
    this.stage.addChild(this.title);
    this.sub = makeText('plant · water · harvest · relax', 26, {
      color: FARM.inkSoft,
      weight: 'bold',
    });
    this.stage.addChild(this.sub);

    this.mascot = this.makeSprout();
    this.add(this.mascot);

    this.playBtn = new UIButton('🌱  PLAY', {
      width: 420,
      height: 104,
      fontSize: 42,
      fill: FARM.grass,
      textColor: 0x1c2a12,
      onTap: () => this.play(),
    });
    this.add(this.playBtn);

    this.layout(W, H);

    window.__farm = { scene: () => 'title', play: () => this.play(), musicOn: () => music.playing };
  }

  protected override onExit(): void {
    delete window.__farm;
  }

  private makeSprout(): Entity {
    const e = new Entity();
    const body = new Container();
    const g = new Graphics();
    // pot
    g.moveTo(-58, 40).lineTo(58, 40).lineTo(46, 104).lineTo(-46, 104).closePath().fill(0xb5673a);
    g.rect(-62, 26, 124, 20).fill(0xc9793f);
    // stem + leaves
    g.moveTo(0, 40).lineTo(0, -40).stroke({ color: 0x5f9c4a, width: 10 });
    g.ellipse(-34, -6, 30, 16).fill(0x7bab54);
    g.ellipse(34, -22, 30, 16).fill(0x8fbf5a);
    g.circle(0, -52, 20).fill(0xe9c46a);
    body.addChild(g);
    e.addChild(body);
    e.addBehavior(new Wobble({ target: body, amount: 0.05, speed: 1.8 }));
    return e;
  }

  private play(): void {
    if (this.busy || this.game.scenes.isTransitioning) return;
    this.busy = true;
    music.start(); // user gesture — safe to begin audio here
    const go = new Entity();
    go.addBehavior(new Timer(0.02, () => this.game.scenes.replace(new FarmScene())));
    this.add(go);
    if (this.playBtn) {
      this.playBtn.scale.set(0.94);
      this.playBtn.addBehavior(
        new Tween(this.playBtn.scale, { x: 1, y: 1 }, 0.2, { ease: easings.outBack }),
      );
    }
  }
}
