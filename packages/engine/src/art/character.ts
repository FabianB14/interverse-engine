import { Container, Graphics } from 'pixi.js';
import { drawBlob } from './blob.js';
import { darken } from './palettes.js';

export interface BlobCharacterOptions {
  radius: number;
  color: number;
  seed?: number;
  wobble?: number;
  stroke?: number;
  strokeWidth?: number;
  eyeColor?: number;
  /** Draw eyes + cheeks. Default true. */
  face?: boolean;
  /** Draw a soft drop shadow. Default true. */
  shadow?: boolean;
}

export interface BlobCharacter {
  /** Position/scale this. */
  view: Container;
  /** The blob body (face included) — squash/wobble this for juice. */
  body: Container;
}

/**
 * A simple code-drawn blob character (§4.5): organic body, eyes, cheeks,
 * soft shadow. No sprite assets required.
 */
export function blobCharacter(opts: BlobCharacterOptions): BlobCharacter {
  const {
    radius,
    color,
    seed = 1,
    wobble = 0.16,
    stroke = 0xffffff,
    strokeWidth = Math.max(3, radius * 0.06),
    eyeColor = 0x2b2b3a,
    face = true,
    shadow = true,
  } = opts;

  const view = new Container();
  const body = new Container();

  if (shadow) {
    const s = new Graphics();
    drawBlob(s, { radius, seed, wobble, color: 0x000000 });
    s.alpha = 0.18;
    s.position.set(0, radius * 0.14);
    view.addChild(s);
  }

  const skin = new Graphics();
  drawBlob(skin, { radius, seed, wobble, color, stroke, strokeWidth });
  body.addChild(skin);

  if (face) {
    const featureR = radius * 0.12;
    const eyeL = new Graphics().circle(-radius * 0.3, -radius * 0.18, featureR).fill(eyeColor);
    const eyeR = new Graphics().circle(radius * 0.3, -radius * 0.18, featureR).fill(eyeColor);
    const cheekColor = darken(color, 0.22);
    const cheekL = new Graphics()
      .circle(-radius * 0.44, radius * 0.14, featureR)
      .fill({ color: cheekColor, alpha: 0.6 });
    const cheekR = new Graphics()
      .circle(radius * 0.44, radius * 0.14, featureR)
      .fill({ color: cheekColor, alpha: 0.6 });
    body.addChild(cheekL, cheekR, eyeL, eyeR);
  }

  view.addChild(body);
  return { view, body };
}
