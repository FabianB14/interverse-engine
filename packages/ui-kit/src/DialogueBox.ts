import { Graphics, Text } from 'pixi.js';
import { Entity, audio, darken, lighten, makeTappable } from '@interverse/engine';
import type { DialogueRunner, Palette } from '@interverse/engine';
import { partyPop } from '@interverse/engine';
import { drawPanel } from './Panel.js';
import { UIButton } from './Button.js';

export interface DialogueBoxOptions {
  /** Design units. Default 656 wide x 300 tall. */
  width?: number;
  height?: number;
  palette?: Palette;
  /** Typewriter speed. Default 45. */
  charsPerSecond?: number;
}

/**
 * Dialogue presentation (§4.7 + §4.10): speaker pill, typewriter text,
 * tap-to-advance, choice buttons. Drive it with a DialogueRunner:
 *
 *   box.open(runner);          // runner.start(...) must have been called
 *   box.onClosed = () => ...;  // fires when the conversation ends
 *
 * Origin is the panel's top-left; position it yourself (e.g. bottom of the
 * design space). Add via scene.add(box, uiLayer) so it receives updates.
 */
export class DialogueBox extends Entity {
  onClosed: (() => void) | null = null;

  private readonly w: number;
  private readonly h: number;
  private readonly cps: number;
  private readonly palette: Palette;
  private readonly speakerPill: Graphics;
  private readonly speakerText: Text;
  private readonly bodyText: Text;
  private readonly moreIndicator: Text;
  private runner: DialogueRunner | null = null;
  private full = '';
  private shown = 0;
  private t = 0;
  private choiceButtons: UIButton[] = [];

  constructor(opts: DialogueBoxOptions = {}) {
    super();
    this.w = opts.width ?? 656;
    this.h = opts.height ?? 300;
    this.cps = opts.charsPerSecond ?? 45;
    this.palette = opts.palette ?? partyPop;

    const panel = new Graphics();
    drawPanel(panel, this.w, this.h, {
      fill: lighten(this.palette.bg, 0.08),
      stroke: this.palette.ink,
      radius: 28,
    });
    this.addChild(panel);

    this.speakerPill = new Graphics();
    this.speakerPill.position.set(24, -24);
    this.addChild(this.speakerPill);
    this.speakerText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: 28,
        fontWeight: '900',
        fill: darken(this.palette.bg, 0.3),
      },
    });
    this.speakerText.position.set(44, -18);
    this.addChild(this.speakerText);

    this.bodyText = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: 32,
        fontWeight: 'bold',
        fill: this.palette.ink,
        wordWrap: true,
        wordWrapWidth: this.w - 56,
        lineHeight: 42,
      },
    });
    this.bodyText.position.set(28, 34);
    this.addChild(this.bodyText);

    this.moreIndicator = new Text({
      text: '▼',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fill: this.palette.accent },
    });
    this.moreIndicator.anchor.set(0.5);
    this.moreIndicator.position.set(this.w - 44, this.h - 40);
    this.addChild(this.moreIndicator);

    makeTappable(this, () => this.tap(), {
      hitRect: { x: 0, y: 0, width: this.w, height: this.h },
    });

    this.visible = false;
  }

  get isOpen(): boolean {
    return this.runner !== null;
  }

  /** Screen position of a visible choice button (for tests/tools). */
  choiceScreenPos(index: number): { x: number; y: number } | null {
    const b = this.choiceButtons[index];
    if (!b) return null;
    const p = b.getGlobalPosition();
    return { x: p.x, y: p.y };
  }

  open(runner: DialogueRunner): void {
    this.runner = runner;
    this.visible = true;
    this.showNode();
  }

  close(): void {
    if (!this.runner) return;
    this.runner = null;
    this.visible = false;
    this.clearChoices();
    this.onClosed?.();
  }

  override update(dt: number): void {
    super.update(dt);
    this.t += dt;
    if (!this.runner) return;

    if (this.shown < this.full.length) {
      this.shown = Math.min(this.full.length, this.shown + dt * this.cps);
      this.bodyText.text = this.full.slice(0, Math.floor(this.shown));
      if (this.shown >= this.full.length) this.onTextComplete();
    }

    const waiting =
      this.shown >= this.full.length && (this.runner.node?.choices?.length ?? 0) === 0;
    this.moreIndicator.visible = waiting;
    if (waiting) this.moreIndicator.alpha = 0.5 + Math.sin(this.t * 6) * 0.5;

    for (const b of this.choiceButtons) b.update(dt);
  }

  private tap(): void {
    const runner = this.runner;
    if (!runner) return;
    if (this.shown < this.full.length) {
      // Reveal the rest immediately.
      this.shown = this.full.length;
      this.bodyText.text = this.full;
      this.onTextComplete();
      return;
    }
    if ((runner.node?.choices?.length ?? 0) > 0) return; // must pick a choice
    audio.blip(1.3);
    runner.advance();
    if (runner.done) {
      this.close();
    } else {
      this.showNode();
    }
  }

  private showNode(): void {
    const node = this.runner?.node;
    if (!node) {
      this.close();
      return;
    }
    this.clearChoices();
    this.full = node.text;
    this.shown = 0;
    this.bodyText.text = '';

    const name = node.speaker ?? '';
    this.speakerText.text = name;
    this.speakerPill.clear();
    const visible = name.length > 0;
    this.speakerPill.visible = visible;
    this.speakerText.visible = visible;
    if (visible) {
      this.speakerPill
        .roundRect(0, 0, this.speakerText.width + 40, 46, 23)
        .fill(this.palette.accent);
    }
  }

  private onTextComplete(): void {
    const node = this.runner?.node;
    if (!node?.choices?.length || this.choiceButtons.length > 0) return;
    const bw = this.w - 56;
    const bh = 76;
    const gap = 14;
    const count = node.choices.length;
    node.choices.forEach((choice, i) => {
      const b = new UIButton(choice.text, {
        width: bw,
        height: bh,
        fontSize: 28,
        fill: this.palette.accent,
        textColor: darken(this.palette.bg, 0.3),
        onTap: () => this.pick(i),
      });
      b.position.set(this.w / 2, this.h - 24 - (count - 1 - i) * (bh + gap) - bh / 2);
      this.addChild(b);
      this.choiceButtons.push(b);
    });
  }

  private pick(index: number): void {
    const runner = this.runner;
    if (!runner) return;
    audio.pop(1.2);
    runner.choose(index);
    if (runner.done) {
      this.close();
    } else {
      this.showNode();
    }
  }

  private clearChoices(): void {
    for (const b of this.choiceButtons) {
      b.parent?.removeChild(b);
      b.destroy({ children: true });
    }
    this.choiceButtons = [];
  }
}
