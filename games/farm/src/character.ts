import { Container, Graphics } from 'pixi.js';
import { blobCharacter, darken, lighten } from '@interverse/engine';
import { accessoryView } from './accessories.js';

export type CharType = 'blob' | 'person';

export interface Character {
  view: Container;
  /** The part to squash/stretch for a walk bob. */
  body: Container;
}

/** A little code-drawn person: legs, shirt (in `color`), head + face. */
function personCharacter(color: number, r: number): Character {
  const view = new Container();
  const shadow = new Graphics().ellipse(0, r * 1.2, r * 0.8, r * 0.28).fill({
    color: 0x000000,
    alpha: 0.18,
  });
  view.addChild(shadow);

  const body = new Container();
  const g = new Graphics();
  // legs
  g.roundRect(-r * 0.42, r * 0.5, r * 0.34, r * 0.7, r * 0.14).fill(0x4a4a55);
  g.roundRect(r * 0.08, r * 0.5, r * 0.34, r * 0.7, r * 0.14).fill(0x4a4a55);
  // shoes
  g.roundRect(-r * 0.46, r * 1.12, r * 0.4, r * 0.2, r * 0.08).fill(0x2b2b33);
  g.roundRect(r * 0.06, r * 1.12, r * 0.4, r * 0.2, r * 0.08).fill(0x2b2b33);
  // torso (shirt = chosen color)
  g.roundRect(-r * 0.66, -r * 0.5, r * 1.32, r * 1.1, r * 0.34).fill(color);
  g.roundRect(-r * 0.66, -r * 0.5, r * 1.32, r * 1.1, r * 0.34).stroke({
    color: darken(color, 0.25),
    width: Math.max(2, r * 0.06),
  });
  // arms
  g.circle(-r * 0.66, r * 0.05, r * 0.2).fill(color);
  g.circle(r * 0.66, r * 0.05, r * 0.2).fill(color);
  // head
  const skin = 0xf2c79a;
  g.circle(0, -r * 0.95, r * 0.62).fill(skin);
  g.circle(0, -r * 0.95, r * 0.62).stroke({
    color: darken(skin, 0.2),
    width: Math.max(2, r * 0.05),
  });
  // hair
  g.arc(0, -r * 0.95, r * 0.62, Math.PI, Math.PI * 2).fill(0x6b4a2f);
  g.rect(-r * 0.62, -r * 1.0, r * 1.24, r * 0.12).fill(0x6b4a2f);
  // face
  g.circle(-r * 0.22, -r * 0.9, r * 0.09).fill(0x2b2b33);
  g.circle(r * 0.22, -r * 0.9, r * 0.09).fill(0x2b2b33);
  g.ellipse(-r * 0.3, -r * 0.72, r * 0.1, r * 0.06).fill({ color: 0xff9fa0, alpha: 0.6 });
  g.ellipse(r * 0.3, -r * 0.72, r * 0.1, r * 0.06).fill({ color: 0xff9fa0, alpha: 0.6 });
  body.addChild(g);
  view.addChild(body);
  return { view, body };
}

/** Build the player/NPC avatar in the chosen style, optionally wearing an
 *  accessory. Accessory art is drawn relative to a head circle centered at
 *  (0,0); we translate/scale it onto the head so it fits both avatar types. */
export function makeCharacter(
  type: CharType,
  color: number,
  r = 30,
  seed = 5,
  accessory = 'none',
): Character {
  const char =
    type === 'person'
      ? personCharacter(color, r)
      : (() => {
          const b = blobCharacter({ radius: r, color, seed, strokeWidth: 4 });
          return { view: b.view, body: b.body };
        })();

  if (accessory && accessory !== 'none') {
    // Head geometry differs by avatar: the blob's head is its whole body
    // (center 0,0 radius r); the person's head sits above the torso.
    const head =
      type === 'person' ? { cx: 0, cy: -r * 0.95, hr: r * 0.62 } : { cx: 0, cy: 0, hr: r };
    const acc = accessoryView(accessory, head.hr);
    acc.position.set(head.cx, head.cy);
    char.body.addChild(acc);
  }
  return char;
}

/** A soft daylight shade of a color, for gentle avatars. */
export function softShade(color: number): number {
  return lighten(color, 0.06);
}
