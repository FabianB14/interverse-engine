import { Container, Graphics } from 'pixi.js';
import { darken, lighten } from '@interverse/engine';
import { NIGHT } from './theme.js';

export type Role = 'seeker' | 'hider';

export interface AbilityDef {
  id: string;
  name: string;
  emoji: string;
  /** Seconds between uses. */
  cooldown: number;
  blurb: string;
}

export interface ClassDef {
  id: string;
  role: Role;
  name: string;
  emoji: string;
  color: number;
  /** Movement speed (design units/sec). */
  speed: number;
  blurb: string;
  ability: AbilityDef;
  /** Code-drawn class mark, positioned relative to a blob of `radius`. */
  accessory: (radius: number) => Container;
}

// ---- code-drawn class marks --------------------------------------------

function spiderMark(r: number): Container {
  // Stalker: eight little legs fanning off the head.
  const c = new Container();
  const g = new Graphics();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5 - r * 0.2)
      .lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15 - r * 0.2)
      .stroke({ color: 0x1a1526, width: Math.max(3, r * 0.08) });
  }
  return (c.addChild(g), c);
}

function wolfEars(r: number): Container {
  const c = new Container();
  const fur = NIGHT.bone;
  c.addChild(
    new Graphics()
      .poly([-r * 0.66, -r * 0.5, -r * 0.36, -r * 1.24, -r * 0.06, -r * 0.62])
      .fill(fur)
      .poly([r * 0.66, -r * 0.5, r * 0.36, -r * 1.24, r * 0.06, -r * 0.62])
      .fill(fur)
      .poly([-r * 0.5, -r * 0.6, -r * 0.32, -r * 0.98, -r * 0.18, -r * 0.64])
      .fill(darken(fur, 0.35))
      .poly([r * 0.5, -r * 0.6, r * 0.32, -r * 0.98, r * 0.18, -r * 0.64])
      .fill(darken(fur, 0.35)),
  );
  return c;
}

function wardenEye(r: number): Container {
  // Warden: a single floating eye above the head.
  const c = new Container();
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 1.05, r * 0.34, r * 0.22)
      .fill(NIGHT.bone)
      .circle(0, -r * 1.05, r * 0.13)
      .fill(NIGHT.violet)
      .circle(0, -r * 1.05, r * 0.05)
      .fill(0x140f1e),
  );
  return c;
}

function torchHood(r: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.6, -r * 0.72, r * 1.2, r * 0.34, r * 0.14)
      .fill(0x2a3a4a)
      .circle(r * 0.5, -r * 0.9, r * 0.14)
      .fill(NIGHT.lantern),
  );
  return c;
}

function capMark(r: number, color: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .poly([-r * 0.6, -r * 0.56, r * 0.6, -r * 0.56, 0, -r * 1.28])
      .fill(color)
      .roundRect(-r * 0.7, -r * 0.64, r * 1.4, r * 0.2, r * 0.09)
      .fill(darken(color, 0.2)),
  );
  return c;
}

function crossMark(r: number, color: number): Container {
  // Medic: a little cross badge.
  const c = new Container();
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.12, -r * 1.15, r * 0.24, r * 0.6, r * 0.05)
      .fill(color)
      .roundRect(-r * 0.3, -r * 0.97, r * 0.6, r * 0.24, r * 0.05)
      .fill(color),
  );
  return c;
}

function sheetMark(r: number): Container {
  // Ghost: a wavy sheet crown.
  const c = new Container();
  const g = new Graphics();
  g.moveTo(-r * 0.7, -r * 0.5);
  for (let i = 0; i <= 6; i++) {
    const x = -r * 0.7 + (i / 6) * r * 1.4;
    g.lineTo(x, -r * 0.9 - (i % 2 === 0 ? r * 0.12 : 0));
  }
  g.lineTo(r * 0.7, -r * 0.5).closePath().fill({ color: NIGHT.bone, alpha: 0.85 });
  return (c.addChild(g), c);
}

function maskMark(r: number): Container {
  // Trickster: a half comedy/tragedy mask.
  const c = new Container();
  c.addChild(
    new Graphics()
      .ellipse(-r * 0.28, -r * 0.85, r * 0.28, r * 0.34)
      .fill(NIGHT.lantern)
      .ellipse(r * 0.28, -r * 0.85, r * 0.28, r * 0.34)
      .fill(NIGHT.violet),
  );
  return c;
}

function wrenchMark(r: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .roundRect(-r * 0.08, -r * 1.2, r * 0.16, r * 0.6, r * 0.05)
      .fill(0xbfc6d0)
      .circle(0, -r * 1.2, r * 0.16)
      .stroke({ color: 0xbfc6d0, width: Math.max(3, r * 0.09) }),
  );
  return c;
}

function owlMark(r: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .poly([-r * 0.5, -r * 0.5, -r * 0.6, -r * 1.05, -r * 0.14, -r * 0.62])
      .fill(0x8a6a3b)
      .poly([r * 0.5, -r * 0.5, r * 0.6, -r * 1.05, r * 0.14, -r * 0.62])
      .fill(0x8a6a3b)
      .circle(-r * 0.22, -r * 0.62, r * 0.12)
      .fill(NIGHT.lantern)
      .circle(r * 0.22, -r * 0.62, r * 0.12)
      .fill(NIGHT.lantern),
  );
  return c;
}

// ---- class roster -------------------------------------------------------

export const SEEKERS: ClassDef[] = [
  {
    id: 'stalker',
    role: 'seeker',
    name: 'Stalker',
    emoji: '🕷️',
    color: NIGHT.blood,
    speed: 300,
    blurb: 'Relentless. Lunges to close the gap.',
    ability: { id: 'lunge', name: 'Lunge', emoji: '💨', cooldown: 6, blurb: 'Dash forward fast.' },
    accessory: spiderMark,
  },
  {
    id: 'howler',
    role: 'seeker',
    name: 'Howler',
    emoji: '🐺',
    color: 0x9a8f7a,
    speed: 285,
    blurb: 'Screams to reveal every hider.',
    ability: {
      id: 'screech',
      name: 'Screech',
      emoji: '📢',
      cooldown: 13,
      blurb: 'Reveal all hiders for a moment.',
    },
    accessory: wolfEars,
  },
  {
    id: 'warden',
    role: 'seeker',
    name: 'Warden',
    emoji: '👁️',
    color: NIGHT.violet,
    speed: 285,
    blurb: 'Sets snares that root the careless.',
    ability: {
      id: 'snare',
      name: 'Snare',
      emoji: '🕸️',
      cooldown: 9,
      blurb: 'Drop a trap that roots a hider.',
    },
    accessory: wardenEye,
  },
];

export const HIDERS: ClassDef[] = [
  {
    id: 'scout',
    role: 'hider',
    name: 'Scout',
    emoji: '🔦',
    color: NIGHT.lantern,
    speed: 268,
    blurb: 'Pings the Seeker for the whole team.',
    ability: {
      id: 'ping',
      name: 'Ping',
      emoji: '📍',
      cooldown: 14,
      blurb: "Reveal the Seeker's spot to everyone.",
    },
    accessory: torchHood,
  },
  {
    id: 'sprinter',
    role: 'hider',
    name: 'Sprinter',
    emoji: '👟',
    color: 0x6fc3ff,
    speed: 286,
    blurb: 'Fastest legs alive. Dashes clear.',
    ability: { id: 'dash', name: 'Dash', emoji: '💨', cooldown: 8, blurb: 'Burst of speed.' },
    accessory: (r) => capMark(r, 0x6fc3ff),
  },
  {
    id: 'medic',
    role: 'hider',
    name: 'Medic',
    emoji: '💊',
    color: 0x8affc1,
    speed: 262,
    blurb: 'Revives faster; mends allies instantly.',
    ability: {
      id: 'mend',
      name: 'Mend',
      emoji: '➕',
      cooldown: 16,
      blurb: 'Instantly lift a downed ally.',
    },
    accessory: (r) => crossMark(r, 0x8affc1),
  },
  {
    id: 'ghost',
    role: 'hider',
    name: 'Ghost',
    emoji: '👻',
    color: NIGHT.ghost,
    speed: 264,
    blurb: 'Fades from sight when it counts.',
    ability: {
      id: 'vanish',
      name: 'Vanish',
      emoji: '🫥',
      cooldown: 16,
      blurb: 'Invisible to the Seeker briefly.',
    },
    accessory: sheetMark,
  },
  {
    id: 'trickster',
    role: 'hider',
    name: 'Trickster',
    emoji: '🎭',
    color: NIGHT.violet,
    speed: 266,
    blurb: 'Drops decoys to bait the hunt.',
    ability: {
      id: 'decoy',
      name: 'Decoy',
      emoji: '🃏',
      cooldown: 14,
      blurb: 'Leave a fake blob to distract.',
    },
    accessory: maskMark,
  },
  {
    id: 'engineer',
    role: 'hider',
    name: 'Engineer',
    emoji: '🔧',
    color: 0xffc75f,
    speed: 260,
    blurb: 'Lights lanterns faster; can overcharge one.',
    ability: {
      id: 'overcharge',
      name: 'Overcharge',
      emoji: '⚡',
      cooldown: 16,
      blurb: 'Jump the nearest lantern ahead.',
    },
    accessory: wrenchMark,
  },
  {
    id: 'lookout',
    role: 'hider',
    name: 'Lookout',
    emoji: '🦉',
    color: 0xb98cff,
    speed: 264,
    blurb: 'Senses lanterns and the Seeker.',
    ability: {
      id: 'sense',
      name: 'Sense',
      emoji: '👀',
      cooldown: 13,
      blurb: 'Reveal lanterns + Seeker to you.',
    },
    accessory: owlMark,
  },
];

export const ALL_CLASSES: ClassDef[] = [...SEEKERS, ...HIDERS];

export function classById(id: string | undefined): ClassDef {
  return ALL_CLASSES.find((c) => c.id === id) ?? (HIDERS[0] as ClassDef);
}

export function defaultClassFor(role: Role): string {
  return role === 'seeker' ? 'stalker' : 'scout';
}

/** 5 shades of a class color (0 lightest .. 4 darkest, 2 = base). */
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
