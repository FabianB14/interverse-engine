import { Graphics, Text } from 'pixi.js';
import { Entity, Tween, easings, makeTappable } from '@interverse/engine';

export interface UIButtonOptions {
  /** Design units. Default 320. */
  width?: number;
  /** Default 84 — roughly a 44pt touch target at typical phone scale (§4.10). */
  height?: number;
  fontSize?: number;
  fill?: number;
  textColor?: number;
  onTap: () => void;
}

/** Mobile-sized tappable button with press-squash juice. Origin at center. */
export class UIButton extends Entity {
  readonly buttonWidth: number;
  readonly buttonHeight: number;
  private readonly labelText: Text;

  constructor(label: string, opts: UIButtonOptions) {
    super();
    const width = (this.buttonWidth = opts.width ?? 320);
    const height = (this.buttonHeight = opts.height ?? 84);
    const fill = opts.fill ?? 0xffd166;
    const textColor = opts.textColor ?? 0x2b2b3a;

    const bg = new Graphics();
    bg.roundRect(-width / 2, -height / 2, width, height, height / 2).fill(fill);
    this.addChild(bg);

    const text = (this.labelText = new Text({
      text: label,
      style: {
        fontFamily: 'system-ui, "Segoe UI", sans-serif',
        fontSize: opts.fontSize ?? 32,
        fontWeight: '800',
        fill: textColor,
        align: 'center',
      },
    }));
    text.anchor.set(0.5);
    this.addChild(text);

    makeTappable(
      this,
      () => {
        this.scale.set(0.94);
        this.addBehavior(new Tween(this.scale, { x: 1, y: 1 }, 0.18, { ease: easings.outBack }));
        opts.onTap();
      },
      {
        // Oversize the hit area a touch beyond the visual.
        hitRect: {
          x: -width / 2 - 10,
          y: -height / 2 - 10,
          width: width + 20,
          height: height + 20,
        },
      },
    );
  }

  /** Update the button's label text in place. */
  setLabel(label: string): void {
    this.labelText.text = label;
  }
}
