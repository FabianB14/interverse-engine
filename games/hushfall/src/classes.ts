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

function snowMark(r: number): Container {
  // Frost: a six-point snowflake hovering above the head.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.95;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tipX = Math.cos(a) * r * 0.42;
    const tipY = cy + Math.sin(a) * r * 0.42;
    g.moveTo(0, cy).lineTo(tipX, tipY).stroke({ color: 0x9fe8ff, width: Math.max(3, r * 0.08) });
    // little side barbs
    g.moveTo(tipX * 0.6, cy + (tipY - cy) * 0.6)
      .lineTo(tipX * 0.6 + Math.cos(a + 1.1) * r * 0.14, cy + (tipY - cy) * 0.6 + Math.sin(a + 1.1) * r * 0.14)
      .stroke({ color: 0x9fe8ff, width: Math.max(2, r * 0.06) });
  }
  g.circle(0, cy, r * 0.08).fill(0xffffff);
  return (c.addChild(g), c);
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

function webMark(r: number): Container {
  // Weaver: a spun web crest above the head.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.95;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.moveTo(0, cy)
      .lineTo(Math.cos(a) * r * 0.44, cy + Math.sin(a) * r * 0.44)
      .stroke({ color: 0xd8d4e8, width: Math.max(2, r * 0.06) });
  }
  for (const ring of [0.18, 0.32]) {
    g.circle(0, cy, r * ring).stroke({ color: 0xd8d4e8, width: Math.max(2, r * 0.05) });
  }
  return (c.addChild(g), c);
}

function bowMark(r: number, color: number): Container {
  // Siren: a big soft bow perched on the head.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.82;
  g.poly([0, cy, -r * 0.52, cy - r * 0.3, -r * 0.52, cy + r * 0.3]).fill(color);
  g.poly([0, cy, r * 0.52, cy - r * 0.3, r * 0.52, cy + r * 0.3]).fill(color);
  g.poly([0, cy, -r * 0.4, cy - r * 0.2, -r * 0.4, cy + r * 0.2]).fill(darken(color, 0.18));
  g.poly([0, cy, r * 0.4, cy - r * 0.2, r * 0.4, cy + r * 0.2]).fill(darken(color, 0.18));
  g.circle(0, cy, r * 0.14).fill(lighten(color, 0.25));
  return (c.addChild(g), c);
}

function nestMark(r: number, color: number): Container {
  // Nester: a twiggy little nest resting on the head.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.78;
  g.ellipse(0, cy, r * 0.5, r * 0.24).fill(darken(color, 0.35));
  g.ellipse(0, cy - r * 0.06, r * 0.4, r * 0.16).fill({ color: 0x140f1e, alpha: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = -0.5 + (i / 4) * (Math.PI + 1);
    g.moveTo(Math.cos(a) * r * 0.44, cy + Math.sin(a) * r * 0.18)
      .lineTo(Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.3 - r * 0.08)
      .stroke({ color: darken(color, 0.2), width: Math.max(2, r * 0.05) });
  }
  g.circle(0, cy - r * 0.12, r * 0.1).fill(color); // one round egg peeking out
  return (c.addChild(g), c);
}

function twinMark(r: number): Container {
  // Twin: two mirrored crescent moons above the head.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.95;
  g.circle(-r * 0.26, cy, r * 0.26).fill(NIGHT.bone);
  g.circle(-r * 0.14, cy - r * 0.06, r * 0.22).fill(0x2a2036);
  g.circle(r * 0.26, cy, r * 0.26).fill(NIGHT.bone);
  g.circle(r * 0.14, cy - r * 0.06, r * 0.22).fill(0x2a2036);
  return (c.addChild(g), c);
}

function wraithMark(r: number): Container {
  // Wraith: a tattered hood of shadow with two pinprick eyes.
  const c = new Container();
  const g = new Graphics();
  g.poly([-r * 0.6, -r * 0.4, 0, -r * 1.3, r * 0.6, -r * 0.4, r * 0.4, -r * 0.52, r * 0.2, -r * 0.42, 0, -r * 0.56, -r * 0.2, -r * 0.42, -r * 0.4, -r * 0.52])
    .fill({ color: 0x1a1030, alpha: 0.95 });
  g.circle(-r * 0.16, -r * 0.78, r * 0.06).fill(0xb7ff5e);
  g.circle(r * 0.16, -r * 0.78, r * 0.06).fill(0xb7ff5e);
  return (c.addChild(g), c);
}

function trapMark(r: number): Container {
  // Trapper: a toothy jaw-trap badge.
  const c = new Container();
  const g = new Graphics();
  const cy = -r * 0.9;
  g.arc(0, cy, r * 0.4, Math.PI * 0.1, Math.PI * 0.9).stroke({ color: 0xbfc6d0, width: Math.max(3, r * 0.09) });
  g.arc(0, cy, r * 0.4, Math.PI * 1.1, Math.PI * 1.9).stroke({ color: 0xbfc6d0, width: Math.max(3, r * 0.09) });
  for (let i = 0; i < 4; i++) {
    const x = -r * 0.28 + (i / 3) * r * 0.56;
    g.poly([x - r * 0.05, cy - r * 0.3, x + r * 0.05, cy - r * 0.3, x, cy - r * 0.12]).fill(0xbfc6d0);
    g.poly([x - r * 0.05, cy + r * 0.3, x + r * 0.05, cy + r * 0.3, x, cy + r * 0.12]).fill(0xbfc6d0);
  }
  return (c.addChild(g), c);
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
      cooldown: 16,
      blurb: 'Every hider leaves a glowing TRAIL on the ground for a while.',
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
    blurb: 'Its unblinking eye pierces the dark.',
    ability: {
      id: 'thirdeye',
      name: 'Third Eye',
      emoji: '👁️',
      cooldown: 12,
      blurb: 'See far into the gloom for a few seconds.',
    },
    accessory: wardenEye,
  },
  {
    id: 'weaver',
    role: 'seeker',
    name: 'Weaver',
    emoji: '🕸️',
    color: 0xd8d4e8,
    speed: 282,
    blurb: 'Spits webs that slow the prey.',
    ability: {
      id: 'web',
      name: 'Web Bolt',
      emoji: '🕸️',
      cooldown: 9,
      blurb: 'Snare the nearest hider in webbing — they crawl for a bit.',
    },
    accessory: webMark,
  },
  {
    id: 'trapper',
    role: 'seeker',
    name: 'Trapper',
    emoji: '🪤',
    color: 0x8a6a3b,
    speed: 288,
    blurb: 'Seeds the manor with hidden snares.',
    ability: {
      id: 'snare',
      name: 'Snare Trap',
      emoji: '🪤',
      cooldown: 12,
      blurb: 'Lay a trap that roots whoever steps in.',
    },
    accessory: trapMark,
  },
  {
    id: 'twin',
    role: 'seeker',
    name: 'Twin',
    emoji: '🌗',
    color: 0x9a86c8,
    speed: 288,
    blurb: 'Hunts as TWO — you and your echo.',
    ability: {
      id: 'swap',
      name: 'Trade Places',
      emoji: '🔁',
      cooldown: 14,
      blurb: 'Swap positions with your echo — be where they least expect.',
    },
    accessory: twinMark,
  },
  {
    id: 'wraith',
    role: 'seeker',
    name: 'Wraith',
    emoji: '🌫️',
    color: 0x4a5a3a,
    speed: 285,
    blurb: 'Turns one hider to the dark; walks unseen.',
    ability: {
      id: 'cloak',
      name: 'Cloak',
      emoji: '🫥',
      cooldown: 15,
      blurb: 'Vanish from every hider’s sight for a few seconds.',
    },
    accessory: wraithMark,
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
    blurb: 'Carries a flashlight to cut the dark.',
    ability: {
      id: 'flashlight',
      name: 'Flashlight',
      emoji: '🔦',
      cooldown: 12,
      blurb: 'See much farther for a few seconds.',
    },
    accessory: torchHood,
  },
  {
    id: 'sprinter',
    role: 'hider',
    name: 'Sprinter',
    emoji: '👟',
    // Dark navy — so Sprinter, Frost and Ghost stop reading as triplets.
    color: 0x2f55b8,
    speed: 286,
    blurb: 'Fastest legs alive. Dashes clear.',
    ability: { id: 'dash', name: 'Dash', emoji: '💨', cooldown: 8, blurb: 'Burst of speed.' },
    accessory: (r) => capMark(r, 0x2f55b8),
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
      blurb: 'Instantly lift a downed ally — even from across the room.',
    },
    accessory: (r) => crossMark(r, 0x8affc1),
  },
  {
    id: 'ghost',
    role: 'hider',
    name: 'Ghost',
    emoji: '👻',
    // Sheet-white, like a proper ghost.
    color: 0xf4f2fa,
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
      cooldown: 24,
      blurb: 'Fully light the nearest lantern in one surge.',
    },
    accessory: wrenchMark,
  },
  {
    id: 'lookout',
    role: 'hider',
    name: 'Lookout',
    emoji: '🦉',
    // Owl-feather orange — used to be a near-twin of Trickster's violet.
    color: 0xff9e64,
    speed: 264,
    blurb: 'Senses lanterns and tracks the Seeker.',
    ability: {
      id: 'sense',
      name: 'Sense',
      emoji: '👀',
      cooldown: 13,
      blurb: 'Reveal lanterns + an arrow that TRACKS the Seeker for a while.',
    },
    accessory: owlMark,
  },
  {
    id: 'frost',
    role: 'hider',
    name: 'Frost',
    emoji: '❄️',
    color: 0x9fe8ff,
    speed: 262,
    blurb: 'Snaps the Seeker frozen — briefly.',
    ability: {
      id: 'freeze',
      name: 'Ice Snap',
      emoji: '🧊',
      cooldown: 22,
      blurb: 'Freeze the Seeker for a moment.',
    },
    accessory: snowMark,
  },
  {
    id: 'siren',
    role: 'hider',
    name: 'Siren',
    emoji: '🎀',
    color: 0xffb6d5,
    speed: 264,
    blurb: 'Her dazzling flash steals the Seeker’s sight.',
    ability: {
      id: 'blind',
      name: 'Dazzle',
      emoji: '💥',
      cooldown: 22,
      blurb: 'Blind a nearby Seeker — white-out their screen for a moment.',
    },
    accessory: (r) => bowMark(r, 0xffb6d5),
  },
  {
    id: 'nester',
    role: 'hider',
    name: 'Nester',
    emoji: '🪺',
    color: 0xd9b8ff,
    speed: 262,
    blurb: 'Weaves pop-up dens to duck into anywhere.',
    ability: {
      id: 'nest',
      name: 'Pop-up Den',
      emoji: '🛖',
      cooldown: 18,
      blurb: 'Conjure a hiding spot where you stand (max 3 — the oldest fades).',
    },
    accessory: (r) => nestMark(r, 0xd9b8ff),
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
