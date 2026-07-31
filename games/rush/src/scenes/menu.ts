/**
 * 🎩 Title, and the wardrobe.
 *
 * The shop is on the title screen rather than behind a button because it IS
 * the meta-game: coins have no other use, and a runner whose only progression
 * is a number needs somewhere for that number to go.
 *
 * The preview blob rolls the whole time you are browsing. That is not
 * decoration — it is the shop demonstrating the promise, which is that
 * whatever you put on this blob stays level while the blob does not.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { Scene, audio, rollingBlob } from '@interverse/engine';
import type { RollingBlob } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { HATS, hatView } from '../hats.js';
import type { HatView } from '../hats.js';
import { BLOB_COLOR, DIM, GOLD, INK, MINT, NIGHT } from '../theme.js';
import { buyHat, canAfford, loadProfile, saveProfile, wearHat } from '../save.js';
import type { Profile } from '../save.js';

export class MenuScene extends Scene {
  private profile: Profile = loadProfile();
  private picked = 0;
  private preview!: RollingBlob;
  private previewHat: HatView | null = null;
  private cards: { root: Container; ring: Graphics; id: string }[] = [];
  private blurb!: Text;
  private coinsText!: Text;
  private buyBtn!: UIButton;

  constructor(private readonly onPlay: () => void) {
    super();
  }

  protected override onEnter(): void {
    this.profile = loadProfile();
    this.picked = Math.max(0, HATS.findIndex((h) => h.id === this.profile.wearing));
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
    this.cards = [];
    this.previewHat = null;
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.stage.addChild(new Graphics().rect(0, 0, W, H).fill(NIGHT));

    const title = text('BLOB RUSH', Math.min(72, W / 9), GOLD, '800');
    title.anchor.set(0.5);
    title.position.set(W / 2, H * 0.1);
    const sub = text(
      this.profile.best > 0 ? `best ${this.profile.best} m · ${this.profile.runs} runs` : 'swipe to survive',
      21,
      DIM,
    );
    sub.anchor.set(0.5);
    sub.position.set(W / 2, H * 0.1 + Math.min(52, W / 15));
    this.stage.addChild(title, sub);

    // The preview: a blob rolling forever, wearing whatever is selected.
    this.preview = rollingBlob({ radius: 1, color: BLOB_COLOR, seed: 4, spots: 6 });
    this.preview.view.position.set(W * 0.2, H * 0.46);
    this.preview.view.scale.set(Math.min(72, W / 18));
    this.stage.addChild(this.preview.view);
    const label = text('rolls, hat stays put', 17, DIM);
    label.anchor.set(0.5);
    label.position.set(W * 0.2, H * 0.46 + Math.min(72, W / 18) * 1.9);
    this.stage.addChild(label);

    this.coinsText = text('', 24, GOLD, '800');
    this.coinsText.anchor.set(0.5);
    this.coinsText.position.set(W * 0.2, H * 0.46 - Math.min(72, W / 18) * 2.3);
    this.stage.addChild(this.coinsText);

    // The rack. Two rows so eight hats fit on a phone without shrinking to
    // nothing.
    const cols = 4;
    const areaX = W * 0.42;
    const areaW = W * 0.54;
    const cell = Math.min(112, areaW / cols);
    for (let i = 0; i < HATS.length; i++) {
      const h = HATS[i]!;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const root = new Container();
      const ring = new Graphics();
      root.addChild(ring);
      const owned = this.profile.owned.includes(h.id);
      const view = hatView(h.id, cell * 0.3, BLOB_COLOR).view;
      view.position.set(0, cell * 0.34);
      root.addChild(view);
      if (h.id === 'none') {
        const dash = text('—', 26, DIM, '800');
        dash.anchor.set(0.5);
        root.addChild(dash);
      }
      const price = text(owned ? '✓' : `${h.price}`, 15, owned ? MINT : GOLD, '800');
      price.anchor.set(0.5);
      price.position.set(0, cell * 0.4);
      root.addChild(price);
      root.position.set(areaX + col * cell + cell / 2, H * 0.34 + row * cell * 1.1);
      root.eventMode = 'static';
      root.cursor = 'pointer';
      root.hitArea = {
        contains: (x: number, y: number) => Math.abs(x) < cell / 2 && Math.abs(y) < cell / 2,
      };
      root.on('pointertap', () => this.pick(i));
      this.stage.addChild(root);
      this.cards.push({ root, ring, id: h.id });
    }

    this.blurb = text('', 19, INK);
    this.blurb.anchor.set(0.5, 0);
    this.blurb.position.set(areaX + areaW / 2, H * 0.34 + 2 * cell * 1.1 + 6);
    this.stage.addChild(this.blurb);

    this.buyBtn = new UIButton('BUY', {
      width: 190, height: 66, fontSize: 21, fill: GOLD, onTap: () => this.buyOrWear(),
    });
    this.buyBtn.position.set(areaX + areaW / 2, H * 0.34 + 2 * cell * 1.1 + 66);
    this.add(this.buyBtn);

    const go = new UIButton('▶ RUN', {
      width: Math.min(340, W - 80), fill: MINT, onTap: () => this.play(),
    });
    go.position.set(W / 2, H * 0.88);
    this.add(go);
    this.refresh();
  }

  protected override onUpdate(dt: number): void {
    // The preview never stops rolling: the promise the shop is making is
    // easier to see than to explain.
    this.preview?.roll(dt * 2.4);
    if (this.previewHat?.spin) this.previewHat.spin.rotation += dt * 7;
  }

  private pick(i: number): void {
    this.picked = i;
    audio.blip(1.2);
    this.refresh();
  }

  private buyOrWear(): void {
    const h = HATS[this.picked]!;
    if (this.profile.owned.includes(h.id)) {
      this.profile = wearHat(this.profile, h.id);
      audio.pop(1.2);
    } else if (canAfford(this.profile, h.id)) {
      this.profile = buyHat(this.profile, h.id);
      audio.chime();
    } else {
      // Say no out loud rather than silently doing nothing, which reads as a
      // broken button.
      audio.buzz();
      return;
    }
    saveProfile(this.profile);
    this.rebuild();
  }

  private refresh(): void {
    const h = HATS[this.picked]!;
    const owned = this.profile.owned.includes(h.id);
    const worn = this.profile.wearing === h.id;
    this.coinsText.text = `🪙 ${this.profile.coins}`;
    this.blurb.text = `${h.name} — ${h.blurb}`;
    this.buyBtn.setLabel(worn ? 'WEARING' : owned ? 'WEAR' : canAfford(this.profile, h.id) ? `BUY ${h.price}` : `NEED ${h.price}`);
    this.buyBtn.alpha = worn ? 0.55 : 1;

    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i]!;
      const on = i === this.picked;
      const have = this.profile.owned.includes(c.id);
      c.ring.clear();
      if (on) c.ring.circle(0, 0, 48).stroke({ color: GOLD, width: 4 });
      if (this.profile.wearing === c.id) c.ring.circle(0, 0, 54).stroke({ color: MINT, width: 3 });
      // Locked hats are dim but never hidden — you cannot want a hat you
      // have not seen.
      c.root.alpha = have ? 1 : 0.45;
    }

    if (this.previewHat) {
      this.preview.rider.removeChild(this.previewHat.view);
      this.previewHat.view.destroy({ children: true });
    }
    this.previewHat = hatView(h.id, 1, BLOB_COLOR);
    this.preview.rider.addChild(this.previewHat.view);
  }

  private play(): void {
    saveProfile(this.profile);
    audio.chime();
    this.onPlay();
  }

  // ------------------------------------------------- headless test hooks

  debugPickHat(id: string): void {
    const i = HATS.findIndex((h) => h.id === id);
    if (i >= 0) this.pick(i);
  }

  debugBuy(): void {
    this.buyOrWear();
  }

  debugPicked(): string {
    return HATS[this.picked]!.id;
  }

  debugPlay(): void {
    this.play();
  }
}

function text(s: string, size: number, fill: number, weight: '700' | '800' = '700'): Text {
  return new Text({
    text: s,
    style: {
      fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill,
      align: 'center', wordWrap: true, wordWrapWidth: 520,
    },
  });
}
