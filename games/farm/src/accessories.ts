import { Container, Graphics } from 'pixi.js';
import { darken, lighten, verium } from '@interverse/engine';
import { store } from './store.js';

/**
 * Farm accessories — code-drawn hats, ears and bows you wear on your avatar.
 * Each draw() is positioned relative to a head circle centered at (0,0) with
 * its top around -radius, so the same art works on a blob (head = whole body)
 * and on a person (translated onto the head). Cozy-flavored and all free —
 * pick one and it's saved to your farm.
 */
export interface AccessoryDef {
  id: string;
  name: string;
  emoji: string;
  /** Verium price in the cosmetic shop; omit for free starter accessories. */
  price?: number;
  /** Code-drawn decoration, sized to a head of `radius`. */
  draw: (radius: number) => Container;
}

function none(): Container {
  return new Container();
}

function strawHat(r: number): Container {
  const c = new Container();
  const straw = 0xd9b56b;
  const band = 0xc06a3a;
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 0.56, r * 1.12, r * 0.3)
      .fill(straw)
      .ellipse(0, -r * 0.56, r * 1.12, r * 0.3)
      .stroke({ color: darken(straw, 0.22), width: Math.max(2, r * 0.05) })
      .arc(0, -r * 0.6, r * 0.52, Math.PI, 0)
      .fill(lighten(straw, 0.08))
      .rect(-r * 0.52, -r * 0.68, r * 1.04, r * 0.12)
      .fill(band),
  );
  return c;
}

function sunHat(r: number): Container {
  const c = new Container();
  const cloth = 0xf3d17a;
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 0.56, r * 1.0, r * 0.26)
      .fill(cloth)
      .ellipse(0, -r * 0.56, r * 1.0, r * 0.26)
      .stroke({ color: darken(cloth, 0.2), width: Math.max(2, r * 0.05) })
      .arc(0, -r * 0.6, r * 0.5, Math.PI, 0)
      .fill(lighten(cloth, 0.06))
      .arc(0, -r * 0.6, r * 0.5, Math.PI, 0)
      .stroke({ color: 0xff9fb2, width: Math.max(3, r * 0.09) }),
  );
  return c;
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

function flowerCrown(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  const petals = [0xff9fb2, 0xffd166, 0xc77dff, 0xf2ffe9, 0x9ad8ff];
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    const x = t * r * 0.62;
    const y = -r * 0.62 - Math.cos(t * 1.4) * r * 0.14;
    const col = petals[i] ?? 0xff9fb2;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.circle(x + Math.cos(a) * r * 0.1, y + Math.sin(a) * r * 0.1, r * 0.08).fill(col);
    }
    g.circle(x, y, r * 0.07).fill(0xffd166);
  }
  return (c.addChild(g), c);
}

function cap(r: number): Container {
  const c = new Container();
  const blue = 0x3a6d9c;
  c.addChild(
    new Graphics()
      .arc(0, -r * 0.6, r * 0.62, Math.PI, 0)
      .fill(blue)
      .roundRect(-r * 1.15, -r * 0.66, r * 0.5, r * 0.16, r * 0.06)
      .fill(darken(blue, 0.12))
      .circle(0, -r * 1.18, r * 0.1)
      .fill(0xffd166),
  );
  return c;
}

function beanie(r: number): Container {
  const c = new Container();
  const knit = 0xd9645a;
  c.addChild(
    new Graphics()
      .arc(0, -r * 0.55, r * 0.66, Math.PI, 0)
      .fill(knit)
      .rect(-r * 0.66, -r * 0.6, r * 1.32, r * 0.14)
      .fill(lighten(knit, 0.15))
      .circle(0, -r * 1.2, r * 0.14)
      .fill(0xf2ffe9),
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
      .fill(0x8fd06a)
      .roundRect(r * 0.8, -r * 0.22, r * 0.12, r * 0.3, r * 0.05)
      .fill(0x8fd06a),
  );
  return c;
}

function chefHat(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(-r * 0.45, -r * 0.72, r * 0.9, r * 0.24, r * 0.06).fill(0xf2f2ee);
  g.circle(-r * 0.34, -r * 0.95, r * 0.3).fill(0xf2f2ee);
  g.circle(r * 0.34, -r * 0.95, r * 0.3).fill(0xf2f2ee);
  g.circle(0, -r * 1.05, r * 0.34).fill(0xffffff);
  return (c.addChild(g), c);
}

function cowboyHat(r: number): Container {
  const c = new Container();
  const tan = 0xb98a4b;
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 0.6, r * 1.05, r * 0.24)
      .fill(darken(tan, 0.1))
      .roundRect(-r * 0.4, -r * 1.12, r * 0.8, r * 0.56, r * 0.18)
      .fill(tan)
      .ellipse(0, -r * 0.62, r * 0.42, r * 0.1)
      .fill(darken(tan, 0.22)),
  );
  return c;
}

function catEars(r: number): Container {
  const c = new Container();
  const fur = 0x4a4a55;
  const g = new Graphics();
  for (const s of [-1, 1]) {
    g.poly([s * r * 0.55, -r * 0.5, s * r * 0.72, -r * 1.16, s * r * 0.18, -r * 0.7]).fill(fur);
    g.poly([s * r * 0.5, -r * 0.58, s * r * 0.62, -r * 0.98, s * r * 0.32, -r * 0.72]).fill(
      0xff9fb2,
    );
  }
  return (c.addChild(g), c);
}

function bunnyEars(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  for (const s of [-1, 1]) {
    g.ellipse(s * r * 0.3, -r * 1.02, r * 0.16, r * 0.5).fill(0xf2f2ee);
    g.ellipse(s * r * 0.3, -r * 1.02, r * 0.08, r * 0.36).fill(0xff9fb2);
  }
  return (c.addChild(g), c);
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

function starHat(r: number): Container {
  const c = new Container();
  const blue = 0x3a4fb0;
  const g = new Graphics();
  g.poly([-r * 0.5, -r * 0.6, r * 0.5, -r * 0.6, 0, -r * 1.45]).fill(blue);
  g.roundRect(-r * 0.62, -r * 0.68, r * 1.24, r * 0.2, r * 0.08).fill(darken(blue, 0.2));
  for (const [sx, sy, sr] of [
    [-r * 0.12, -r * 0.95, r * 0.09],
    [r * 0.14, -r * 1.15, r * 0.07],
    [0, -r * 1.45, r * 0.11],
  ] as const) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      g.circle(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr, sr * 0.5).fill(0xffd166);
    }
  }
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
      .fill(0xe9c46a),
  );
  return c;
}

function tiara(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.moveTo(-r * 0.5, -r * 0.62)
    .quadraticCurveTo(0, -r * 0.9, r * 0.5, -r * 0.62)
    .stroke({ color: 0xffd166, width: Math.max(4, r * 0.12) });
  g.circle(0, -r * 0.85, r * 0.12).fill(0xff6f91);
  g.circle(-r * 0.32, -r * 0.66, r * 0.08).fill(0x9ad8ff);
  g.circle(r * 0.32, -r * 0.66, r * 0.08).fill(0x9ad8ff);
  return (c.addChild(g), c);
}

function halo(r: number): Container {
  const c = new Container();
  c.addChild(
    new Graphics()
      .ellipse(0, -r * 1.08, r * 0.5, r * 0.16)
      .stroke({ color: 0xffe08a, width: Math.max(4, r * 0.13) })
      .ellipse(0, -r * 1.08, r * 0.5, r * 0.16)
      .stroke({ color: 0xffffff, width: Math.max(1, r * 0.04), alpha: 0.8 }),
  );
  return c;
}

function propellerCap(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.arc(0, -r * 0.55, r * 0.6, Math.PI, 0).fill(0x59d0c0);
  g.rect(-r * 0.6, -r * 0.6, r * 1.2, r * 0.14).fill(0xffd166);
  g.rect(-r * 0.5, -r * 1.2, r * 1.0, r * 0.1).fill(0x2b2b33);
  g.rect(-r * 0.06, -r * 1.32, r * 0.12, r * 0.24).fill(0x2b2b33);
  return (c.addChild(g), c);
}

/**
 * Cozy wardrobe. Free starters first (no price), then premium cosmetics
 * you unlock in the shop with Verium — the straw hat is the farm signature.
 */
export const ACCESSORIES: AccessoryDef[] = [
  { id: 'none', name: 'None', emoji: '🚫', draw: none },
  { id: 'straw', name: 'Straw Hat', emoji: '👒', draw: strawHat },
  { id: 'sun', name: 'Sun Hat', emoji: '🎩', draw: sunHat },
  { id: 'flower', name: 'Flower', emoji: '🌼', draw: flower },
  { id: 'crown_flower', name: 'Flower Crown', emoji: '🌸', draw: flowerCrown },
  { id: 'bow', name: 'Bow', emoji: '🎀', draw: bow },
  { id: 'crown', name: 'Crown', emoji: '👑', draw: crown },
  { id: 'cap', name: 'Cap', emoji: '🧢', draw: cap },
  { id: 'beanie', name: 'Beanie', emoji: '🧶', draw: beanie },
  { id: 'cowboy', name: 'Cowboy Hat', emoji: '🤠', draw: cowboyHat },
  { id: 'chef', name: 'Chef Hat', emoji: '🧑‍🍳', draw: chefHat },
  { id: 'headphones', name: 'Headphones', emoji: '🎧', draw: headphones },
  { id: 'catears', name: 'Cat Ears', emoji: '🐱', draw: catEars },
  { id: 'bunnyears', name: 'Bunny Ears', emoji: '🐰', draw: bunnyEars },
  { id: 'star', name: 'Star Hat', emoji: '🌟', draw: starHat },
  { id: 'party', name: 'Party Hat', emoji: '🎉', draw: partyHat },
  // Premium — unlock in the cosmetic shop with Verium.
  { id: 'tophat', name: 'Top Hat', emoji: '🎩', price: 120, draw: topHat },
  { id: 'tiara', name: 'Tiara', emoji: '👸', price: 160, draw: tiara },
  { id: 'propeller', name: 'Propeller Cap', emoji: '🚁', price: 220, draw: propellerCap },
  { id: 'halo', name: 'Halo', emoji: '😇', price: 300, draw: halo },
];

export function accessoryIndex(id: string): number {
  const i = ACCESSORIES.findIndex((a) => a.id === id);
  return i >= 0 ? i : 0;
}

/** Ids that cost Verium (everything with a price). */
export const PREMIUM_ACCESSORIES = ACCESSORIES.filter((a) => a.price).map((a) => a.id);

export function accessoryById(id: string): AccessoryDef {
  return ACCESSORIES[accessoryIndex(id)]!;
}

/** Draw the accessory `id` for a head of `radius`; empty container for 'none'. */
export function accessoryView(id: string, radius: number): Container {
  return accessoryById(id).draw(radius);
}

// --- Cosmetic ownership (premium accessories unlocked with Verium) ---
const OWNED_KEY = 'ownedAcc';

/** Free starters are always owned; premium ones once bought. */
export function isAccessoryOwned(id: string): boolean {
  const def = accessoryById(id);
  if (!def.price) return true;
  return store.get<string[]>(OWNED_KEY, []).includes(id);
}

export function ownedAccessoryIds(): string[] {
  return ACCESSORIES.filter((a) => isAccessoryOwned(a.id)).map((a) => a.id);
}

/** Buy a premium accessory with Verium; false if free, owned, or too poor. */
export function buyAccessory(id: string): boolean {
  const def = accessoryById(id);
  if (!def.price || isAccessoryOwned(id)) return false;
  if (!verium.spend(def.price)) return false;
  const owned = store.get<string[]>(OWNED_KEY, []);
  owned.push(id);
  store.set(OWNED_KEY, owned);
  return true;
}
