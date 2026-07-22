import { Container, Graphics } from 'pixi.js';
import { blobCharacter, darken, lighten } from '@interverse/engine';
import { accessoryView } from './accessories.js';

export type CharType = 'blob' | 'person';
export type HairStyle = 'short' | 'long' | 'pony';

export interface Character {
  view: Container;
  /** The part to squash/stretch for a walk bob. */
  body: Container;
}

/** Default skin tone if none is chosen. */
export const DEFAULT_SKIN = 0xf0c08a;

// Person head geometry as multiples of `r` — shared so accessories line up.
const PERSON_HEAD_Y = -0.98;
const PERSON_HEAD_R = 0.6;

/** A clearly human little farmer: legs, shirt (in `color`), head in `skin`. */
function personCharacter(color: number, r: number, skin: number, hair: HairStyle): Character {
  const view = new Container();
  view.addChild(
    new Graphics().ellipse(0, r * 1.24, r * 0.66, r * 0.22).fill({ color: 0x000000, alpha: 0.18 }),
  );

  const body = new Container();
  const g = new Graphics();
  const hairColor = 0x5b3d27;
  const hy = PERSON_HEAD_Y * r;
  const hr = PERSON_HEAD_R * r;

  // legs (trousers) + shoes
  g.roundRect(-r * 0.34, r * 0.56, r * 0.28, r * 0.64, r * 0.12).fill(0x4a5568);
  g.roundRect(r * 0.06, r * 0.56, r * 0.28, r * 0.64, r * 0.12).fill(0x4a5568);
  g.roundRect(-r * 0.38, r * 1.12, r * 0.34, r * 0.18, r * 0.08).fill(0x2b2b33);
  g.roundRect(r * 0.04, r * 1.12, r * 0.34, r * 0.18, r * 0.08).fill(0x2b2b33);

  // arms (sleeves in shirt color) with skin-tone hands
  g.roundRect(-r * 0.58, -r * 0.28, r * 0.18, r * 0.72, r * 0.09).fill(color);
  g.roundRect(r * 0.4, -r * 0.28, r * 0.18, r * 0.72, r * 0.09).fill(color);
  g.circle(-r * 0.49, r * 0.46, r * 0.12).fill(skin);
  g.circle(r * 0.49, r * 0.46, r * 0.12).fill(skin);

  // torso — a shirt: shoulders in, hem out (trapezoid), so it reads as a body
  g.poly([-r * 0.4, -r * 0.34, r * 0.4, -r * 0.34, r * 0.5, r * 0.62, -r * 0.5, r * 0.62]).fill(
    color,
  );
  g.poly([-r * 0.4, -r * 0.34, r * 0.4, -r * 0.34, r * 0.5, r * 0.62, -r * 0.5, r * 0.62]).stroke({
    color: darken(color, 0.25),
    width: Math.max(2, r * 0.06),
  });

  // neck
  g.rect(-r * 0.13, hy + hr * 0.7, r * 0.26, r * 0.24).fill(darken(skin, 0.06));

  // long styles put a soft mass BEHIND the head first
  const hairC = hairColor;
  if (hair === 'long') {
    g.roundRect(-hr * 1.08, hy - hr * 0.5, hr * 0.42, hr * 1.9, hr * 0.2).fill(hairC);
    g.roundRect(hr * 0.66, hy - hr * 0.5, hr * 0.42, hr * 1.9, hr * 0.2).fill(hairC);
  } else if (hair === 'pony') {
    g.roundRect(hr * 0.7, hy - hr * 0.2, hr * 0.36, hr * 1.7, hr * 0.18).fill(hairC);
    g.circle(hr * 0.88, hy - hr * 0.3, hr * 0.24).fill(darken(hairC, 0.12));
  }
  // head
  g.circle(0, hy, hr).fill(skin);
  g.circle(0, hy, hr).stroke({ color: darken(skin, 0.22), width: Math.max(2, r * 0.05) });
  // hair — a tidy cap over just the crown, with an arched hairline so the
  // whole face (forehead down) stays clear skin.
  g.moveTo(-hr, hy);
  g.arc(0, hy, hr, Math.PI, Math.PI * 2, false);
  g.quadraticCurveTo(0, hy - hr * 0.22, -hr, hy);
  g.fill(hairC);
  if (hair === 'long') {
    // face-framing strands over the cap edges
    g.ellipse(-hr * 0.86, hy + hr * 0.1, hr * 0.18, hr * 0.42).fill(hairC);
    g.ellipse(hr * 0.86, hy + hr * 0.1, hr * 0.18, hr * 0.42).fill(hairC);
  }
  // face — sits on skin, below the hairline
  g.circle(-hr * 0.32, hy + hr * 0.18, r * 0.075).fill(0x2b2b33);
  g.circle(hr * 0.32, hy + hr * 0.18, r * 0.075).fill(0x2b2b33);
  g.circle(-hr * 0.29, hy + hr * 0.14, r * 0.024).fill(0xffffff);
  g.circle(hr * 0.35, hy + hr * 0.14, r * 0.024).fill(0xffffff);
  g.moveTo(-hr * 0.26, hy + hr * 0.46)
    .quadraticCurveTo(0, hy + hr * 0.66, hr * 0.26, hy + hr * 0.46)
    .stroke({ color: darken(skin, 0.4), width: Math.max(2, r * 0.05), cap: 'round' });
  g.ellipse(-hr * 0.48, hy + hr * 0.4, r * 0.1, r * 0.06).fill({ color: 0xff9fa0, alpha: 0.5 });
  g.ellipse(hr * 0.48, hy + hr * 0.4, r * 0.1, r * 0.06).fill({ color: 0xff9fa0, alpha: 0.5 });

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
  skin: number = DEFAULT_SKIN,
  hair: HairStyle = 'short',
): Character {
  const char =
    type === 'person'
      ? personCharacter(color, r, skin, hair)
      : (() => {
          const b = blobCharacter({ radius: r, color, seed, strokeWidth: 4 });
          return { view: b.view, body: b.body };
        })();

  if (accessory && accessory !== 'none') {
    // Head geometry differs by avatar: the blob's head is its whole body
    // (center 0,0 radius r); the person's head sits above the torso.
    const head =
      type === 'person'
        ? { cx: 0, cy: PERSON_HEAD_Y * r, hr: PERSON_HEAD_R * r }
        : { cx: 0, cy: 0, hr: r };
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
