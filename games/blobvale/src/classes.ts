import { Container, Graphics } from 'pixi.js';
import { darken, lighten } from '@interverse/engine';

/**
 * The five starting classes (Milestone 1: identity + speed; abilities land
 * in Milestone 2). Colors are class identity, not decoration — they stay
 * consistent across every screen.
 */
export interface ClassDef {
  id: string;
  name: string;
  emoji: string;
  color: number;
  /** Movement speed, design units/sec. */
  speed: number;
  /** One-line role note shown in the class picker. */
  blurb: string;
  /** Code-drawn class accessory, positioned relative to a blob of `radius`. */
  accessory: (radius: number) => Container;
}

function knightHelm(r: number): Container {
  const c = new Container();
  const steel = 0xb8c4d0;
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.62, -r * 0.72, r * 1.24, r * 0.42, r * 0.2)
      .fill(steel)
      .roundRect(-r * 0.1, -r * 0.98, r * 0.2, r * 0.4, r * 0.08)
      .fill(darken(steel, 0.2)),
  );
  return c;
}

function archerQuiver(r: number): Container {
  const c = new Container();
  const wood = 0x8a6a3b;
  const g = new Graphics();
  g.roundRect(r * 0.45, -r * 0.85, r * 0.3, r * 0.7, r * 0.12).fill(wood);
  for (let i = 0; i < 3; i++) {
    g.circle(r * 0.53 + i * r * 0.07, -r * 0.92, r * 0.06).fill(0xf2ffe9);
  }
  return (c.addChild(g), c);
}

function mageHat(r: number): Container {
  const c = new Container();
  const purple = 0x7b5bd6;
  c.addChild(
    new Graphics()
      .poly([-r * 0.55, -r * 0.6, r * 0.55, -r * 0.6, 0, -r * 1.35])
      .fill(purple)
      .roundRect(-r * 0.7, -r * 0.68, r * 1.4, r * 0.22, r * 0.1)
      .fill(darken(purple, 0.2))
      .circle(0, -r * 1.35, r * 0.12)
      .fill(0xffd166),
  );
  return c;
}

function clericHalo(r: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 1.05, r * 0.5, r * 0.16)
      .stroke({ color: 0xffd166, width: Math.max(3, r * 0.1) }),
  );
  return c;
}

function rogueBandana(r: number): Container {
  const c = new Container();
  const red = 0x9c2f3f;
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.62, -r * 0.6, r * 1.24, r * 0.3, r * 0.14)
      .fill(red)
      .poly([r * 0.5, -r * 0.45, r * 0.95, -r * 0.25, r * 0.6, -r * 0.2])
      .fill(darken(red, 0.15)),
  );
  return c;
}

export const CLASSES: ClassDef[] = [
  {
    id: 'knight',
    name: 'Knight',
    emoji: '🛡️',
    color: 0x8fa3b8,
    speed: 220,
    blurb: 'Tough shield-bearer. Slow but sturdy.',
    accessory: knightHelm,
  },
  {
    id: 'archer',
    name: 'Archer',
    emoji: '🏹',
    color: 0x8fbf6b,
    speed: 265,
    blurb: 'Quick, strikes from afar.',
    accessory: archerQuiver,
  },
  {
    id: 'mage',
    name: 'Mage',
    emoji: '🔮',
    color: 0xa98fe0,
    speed: 240,
    blurb: 'Big magic, big booms.',
    accessory: mageHat,
  },
  {
    id: 'cleric',
    name: 'Cleric',
    emoji: '💚',
    color: 0xf2cc8f,
    speed: 240,
    blurb: 'Keeps the party healthy.',
    accessory: clericHalo,
  },
  {
    id: 'rogue',
    name: 'Rogue',
    emoji: '🗡️',
    color: 0xd98a9c,
    speed: 285,
    blurb: 'Fastest blob alive. Sneaky.',
    accessory: rogueBandana,
  },
];

export function classById(id: string | undefined): ClassDef {
  return CLASSES.find((c) => c.id === id) ?? (CLASSES[0] as ClassDef);
}

/** Customization: 5 shades of a class color (0 lightest .. 4 darkest, 2 = base). */
export function shadeFor(color: number, shade: number): number {
  switch (shade) {
    case 0:
      return lighten(color, 0.3);
    case 1:
      return lighten(color, 0.15);
    case 3:
      return darken(color, 0.16);
    case 4:
      return darken(color, 0.32);
    default:
      return color;
  }
}

export function lighterClassColor(id: string): number {
  return lighten(classById(id).color, 0.25);
}
