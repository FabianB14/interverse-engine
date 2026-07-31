/**
 * 🏰 Title and character select.
 *
 * Four classes, shown as the blobs you will actually be — same art, same
 * cosmetics, same colour. A select screen that previews something other than
 * the thing you get is a select screen that lies, and in a co-op brawler the
 * colour you pick here is how your friends will find you for the next hour.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { BRAWLER_CLASSES, Entity, Scene, audio, statsFor } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { fighter } from '../art.js';
import { loadRun, saveRun } from '../save.js';

export class MenuScene extends Scene {
  private picked = 0;
  private cards: Container[] = [];
  private blurb!: Text;
  private stats!: Text;

  constructor(private readonly onStart: () => void) {
    super();
  }

  protected override onEnter(): void {
    const run = loadRun();
    this.picked = Math.max(0, BRAWLER_CLASSES.findIndex((c) => c.id === run.classId));
    this.build();
    audio.music.play('adventure');
  }

  protected override onExit(): void {
    audio.music.stop();
  }

  protected override onResize(): void {
    this.stage.removeChildren();
    this.cards = [];
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const bg = new Graphics().rect(0, 0, W, H).fill(0x1a1226);
    bg.rect(0, H * 0.62, W, H * 0.38).fill(0x2b1f3d);
    this.stage.addChild(bg);

    const title = new Text({
      text: 'BLOB CRASHERS',
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: Math.min(72, W / 9), fontWeight: '800',
        fill: 0xffd166, stroke: { color: 0x1a1226, width: 8 },
      },
    });
    title.anchor.set(0.5);
    title.position.set(W / 2, H * 0.12);
    const sub = new Text({
      text: '15 stages · pick your blob',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0x9a97b8 },
    });
    sub.anchor.set(0.5);
    sub.position.set(W / 2, H * 0.12 + Math.min(52, W / 14));
    this.stage.addChild(title, sub);

    // The roster, laid out across whatever width the device gives us.
    const gap = Math.min(190, (W - 80) / BRAWLER_CLASSES.length);
    const left = W / 2 - (gap * (BRAWLER_CLASSES.length - 1)) / 2;
    BRAWLER_CLASSES.forEach((cls, i) => {
      const card = new Container();
      const ring = new Graphics();
      card.addChild(ring);
      const art = fighter({ radius: 44, color: cls.color, seed: 3 + i, hat: cls.hat, held: cls.held });
      card.addChild(art);
      const name = new Text({
        text: cls.name,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '800', fill: 0xe6e4f0 },
      });
      name.anchor.set(0.5);
      name.position.set(0, 76);
      card.addChild(name);
      card.position.set(left + i * gap, H * 0.42);
      // Whole card is the target: a 44-unit blob is not a touch target.
      card.eventMode = 'static';
      card.cursor = 'pointer';
      card.hitArea = { contains: (x: number, y: number) => Math.abs(x) < gap / 2 && y > -70 && y < 100 };
      card.on('pointertap', () => this.pick(i));
      this.cards.push(card);
      this.stage.addChild(card);
    });

    this.blurb = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: 21, fontWeight: '600',
        fill: 0xe6e4f0, align: 'center', wordWrap: true, wordWrapWidth: Math.min(620, W - 60),
      },
    });
    this.blurb.anchor.set(0.5, 0);
    this.blurb.position.set(W / 2, H * 0.66);
    this.stats = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 19, fontWeight: '700', fill: 0x9a97b8 },
    });
    this.stats.anchor.set(0.5, 0);
    this.stats.position.set(W / 2, H * 0.66 + 62);
    this.stage.addChild(this.blurb, this.stats);

    const go = new UIButton('▶ START', {
      width: Math.min(360, W - 80), fill: 0x8affc1, onTap: () => this.start(),
    });
    go.position.set(W / 2, H * 0.86);
    this.add(go);
    this.refresh();
  }

  private pick(i: number): void {
    this.picked = i;
    audio.blip(1.2);
    this.refresh();
  }

  private refresh(): void {
    this.cards.forEach((card, i) => {
      const on = i === this.picked;
      const ring = card.children[0] as Graphics;
      ring.clear();
      if (on) ring.circle(0, 6, 62).stroke({ color: 0xffd166, width: 5 });
      card.scale.set(on ? 1.12 : 0.92);
      card.alpha = on ? 1 : 0.72;
    });
    const cls = BRAWLER_CLASSES[this.picked]!;
    const run = loadRun();
    const s = statsFor(cls, run.upgrades);
    this.blurb.text = cls.blurb;
    // Real numbers, because "power 1.6" means nothing and "5 hearts" does.
    this.stats.text = `♥ ${s.hearts}   👊 ${s.power.toFixed(1)}×   🏃 ${Math.round(s.speed)}   ↔ ${Math.round(s.reach)}`;
  }

  private start(): void {
    const cls = BRAWLER_CLASSES[this.picked]!;
    saveRun({ ...loadRun(), classId: cls.id });
    audio.chime();
    this.onStart();
  }

  // ------------------------------------------------- headless test hooks

  debugPick(i: number): void {
    this.pick(i);
  }

  debugStart(): void {
    this.start();
  }

  debugPicked(): string {
    return BRAWLER_CLASSES[this.picked]!.id;
  }
}

/** Shared helper for the other screens: a plain full-screen backdrop. */
export function screenBg(scene: Scene, w: number, h: number, top = 0x1a1226): Entity {
  const e = new Entity();
  e.addChild(new Graphics().rect(0, 0, w, h).fill(top));
  scene.add(e);
  return e;
}
