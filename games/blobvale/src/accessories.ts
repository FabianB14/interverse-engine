import { Container, Graphics } from 'pixi.js';
import { darken } from '@interverse/engine';

/**
 * Blob accessories (M5 customization): code-drawn hats, bows and shades you
 * stack on top of your class look. A mix of cute and cool so everyone finds
 * something. Each draw() is positioned relative to a blob of `radius`, with
 * the blob centered at (0,0) and its top around -radius.
 */
export interface AccessoryDef {
  id: string;
  name: string;
  emoji: string;
  /** Code-drawn decoration, sized to a blob of `radius`. */
  draw: (radius: number) => Container;
}

function none(): Container {
  return new Container();
}

function bow(r: number): Container {
  const c = new Container();
  const pink = 0xff8fb0;
  const g = new Graphics();
  const x = r * 0.5;
  const y = -r * 0.72;
  g.poly([x, y, x - r * 0.34, y - r * 0.24, x - r * 0.34, y + r * 0.24]).fill(pink);
  g.poly([x, y, x + r * 0.34, y - r * 0.24, x + r * 0.34, y + r * 0.24]).fill(pink);
  g.circle(x, y, r * 0.12).fill(darken(pink, 0.18));
  return (c.addChild(g), c);
}

function flower(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  const x = -r * 0.5;
  const y = -r * 0.62;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.circle(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18, r * 0.14).fill(0xff9fb2);
  }
  g.circle(x, y, r * 0.13).fill(0xffd166);
  return (c.addChild(g), c);
}

function topHat(r: number): Container {
  const c = new Container();
  const black = 0x2b2b33;
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.75, -r * 0.78, r * 1.5, r * 0.18, r * 0.08)
      .fill(black)
      .roundRect(-r * 0.42, -r * 1.5, r * 0.84, r * 0.78, r * 0.08)
      .fill(black)
      .roundRect(-r * 0.42, -r * 1.02, r * 0.84, r * 0.14, r * 0.04)
      .fill(0xd94f6a),
  );
  return c;
}

function cap(r: number): Container {
  const c = new Container();
  const blue = 0x3a6d9c;
  c.addChild(
    new Graphics()
      // dome
      .arc(0, -r * 0.6, r * 0.62, Math.PI, 0)
      .fill(blue)
      // backwards brim (sticks out the left)
      .roundRect(-r * 1.15, -r * 0.66, r * 0.5, r * 0.16, r * 0.06)
      .fill(darken(blue, 0.12))
      .circle(0, -r * 1.18, r * 0.1)
      .fill(0xffd166),
  );
  return c;
}

function crown(r: number): Container {
  const c = new Container();
  const gold = 0xffd166;
  const g = new Graphics();
  g.poly([
    -r * 0.55,
    -r * 0.6,
    -r * 0.55,
    -r * 1.02,
    -r * 0.28,
    -r * 0.78,
    0,
    -r * 1.12,
    r * 0.28,
    -r * 0.78,
    r * 0.55,
    -r * 1.02,
    r * 0.55,
    -r * 0.6,
  ]).fill(gold);
  g.circle(0, -r * 0.78, r * 0.09).fill(0xff5470);
  return (c.addChild(g), c);
}

function shades(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  const y = -r * 0.06;
  g.roundRect(-r * 0.58, y, r * 0.46, r * 0.34, r * 0.08).fill(0x1c1c28);
  g.roundRect(r * 0.12, y, r * 0.46, r * 0.34, r * 0.08).fill(0x1c1c28);
  g.rect(-r * 0.12, y + r * 0.1, r * 0.24, r * 0.06).fill(0x1c1c28);
  g.roundRect(-r * 0.5, y + r * 0.05, r * 0.14, r * 0.1, r * 0.04).fill(0x6fd0ff);
  return (c.addChild(g), c);
}

function headphones(r: number): Container {
  const c = new Container();
  const dark = 0x33333a;
  c.addChild(
    new Graphics()
      .arc(0, -r * 0.1, r * 0.86, Math.PI * 1.15, Math.PI * 1.85)
      .stroke({ color: dark, width: Math.max(5, r * 0.14) })
      .roundRect(-r * 0.96, -r * 0.32, r * 0.28, r * 0.5, r * 0.1)
      .fill(dark)
      .roundRect(r * 0.68, -r * 0.32, r * 0.28, r * 0.5, r * 0.1)
      .fill(dark)
      .roundRect(-r * 0.92, -r * 0.22, r * 0.12, r * 0.3, r * 0.05)
      .fill(0xff5470)
      .roundRect(r * 0.8, -r * 0.22, r * 0.12, r * 0.3, r * 0.05)
      .fill(0xff5470),
  );
  return c;
}

function partyHat(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([-r * 0.4, -r * 0.66, r * 0.4, -r * 0.66, 0, -r * 1.5]).fill(0x59d0c0);
  for (let i = 0; i < 3; i++) {
    g.circle(-r * 0.2 + i * r * 0.2, -r * (0.82 + i * 0.14), r * 0.07).fill(0xffd166);
  }
  g.circle(0, -r * 1.5, r * 0.12).fill(0xff5470);
  return (c.addChild(g), c);
}

export const ACCESSORIES: AccessoryDef[] = [
  { id: 'none', name: 'None', emoji: '🚫', draw: none },
  { id: 'bow', name: 'Bow', emoji: '🎀', draw: bow },
  { id: 'flower', name: 'Flower', emoji: '🌸', draw: flower },
  { id: 'tophat', name: 'Top Hat', emoji: '🎩', draw: topHat },
  { id: 'cap', name: 'Cap', emoji: '🧢', draw: cap },
  { id: 'crown', name: 'Crown', emoji: '👑', draw: crown },
  { id: 'shades', name: 'Shades', emoji: '🕶️', draw: shades },
  { id: 'headphones', name: 'Headphones', emoji: '🎧', draw: headphones },
  { id: 'party', name: 'Party Hat', emoji: '🎉', draw: partyHat },
];

/** Draw accessory `i` for a blob of `radius`; empty container if out of range. */
export function accessoryView(i: number | undefined, radius: number): Container {
  const def = ACCESSORIES[i ?? 0] ?? ACCESSORIES[0];
  return def ? def.draw(radius) : new Container();
}
