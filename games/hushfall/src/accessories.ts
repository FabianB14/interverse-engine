import { Container, Graphics } from 'pixi.js';
import { darken } from '@interverse/engine';
import { NIGHT } from './theme.js';

/**
 * Cosmetic head accessories, worn over the class mark. Index 0 is "none".
 * A few are free; the rest unlock with Verium in the lobby wardrobe.
 */
export interface AccessoryDef {
  id: string;
  name: string;
  emoji: string;
  /** Verium price; omit for free/default. */
  price?: number;
  draw: (r: number) => Container | null;
}

function g(): Graphics {
  return new Graphics();
}
function wrap(gr: Graphics | null): Container {
  const c = new Container();
  if (gr) c.addChild(gr);
  return c;
}

export const ACCESSORIES: AccessoryDef[] = [
  { id: 'none', name: 'None', emoji: '🚫', draw: () => null },
  {
    id: 'witch',
    name: 'Witch Hat',
    emoji: '🧙',
    draw: (r) =>
      wrap(
        g()
          .poly([-r * 0.7, -r * 0.55, r * 0.7, -r * 0.55, 0, -r * 1.6])
          .fill(0x2a2140)
          .roundRect(-r * 0.9, -r * 0.62, r * 1.8, r * 0.22, r * 0.1)
          .fill(darken(0x2a2140, 0.2)),
      ),
  },
  {
    id: 'pumpkin',
    name: 'Pumpkin',
    emoji: '🎃',
    draw: (r) =>
      wrap(
        g()
          .circle(0, -r * 1.05, r * 0.34)
          .fill(0xff7a3b)
          .moveTo(0, -r * 1.4)
          .lineTo(0, -r * 1.28)
          .stroke({ color: 0x3b2b16, width: Math.max(3, r * 0.08) }),
      ),
  },
  {
    id: 'horns',
    name: 'Horns',
    emoji: '😈',
    draw: (r) =>
      wrap(
        g()
          .poly([-r * 0.5, -r * 0.6, -r * 0.85, -r * 1.2, -r * 0.28, -r * 0.72])
          .fill(NIGHT.blood)
          .poly([r * 0.5, -r * 0.6, r * 0.85, -r * 1.2, r * 0.28, -r * 0.72])
          .fill(NIGHT.blood),
      ),
  },
  {
    id: 'halo',
    name: 'Halo',
    emoji: '😇',
    draw: (r) =>
      wrap(
        g()
          .ellipse(0, -r * 1.15, r * 0.5, r * 0.16)
          .stroke({ color: 0xffe9a8, width: Math.max(3, r * 0.1) }),
      ),
  },
  {
    id: 'top',
    name: 'Top Hat',
    emoji: '🎩',
    price: 60,
    draw: (r) =>
      wrap(
        g()
          .roundRect(-r * 0.45, -r * 1.5, r * 0.9, r * 0.8, r * 0.06)
          .fill(0x14121e)
          .roundRect(-r * 0.85, -r * 0.78, r * 1.7, r * 0.16, r * 0.06)
          .fill(0x14121e)
          .roundRect(-r * 0.45, -r * 0.98, r * 0.9, r * 0.14, 2)
          .fill(NIGHT.blood),
      ),
  },
  {
    id: 'crown',
    name: 'Crown',
    emoji: '👑',
    price: 120,
    draw: (r) =>
      wrap(
        g()
          .poly([
            -r * 0.5,
            -r * 0.7,
            -r * 0.5,
            -r * 1.15,
            -r * 0.25,
            -r * 0.9,
            0,
            -r * 1.2,
            r * 0.25,
            -r * 0.9,
            r * 0.5,
            -r * 1.15,
            r * 0.5,
            -r * 0.7,
          ])
          .fill(NIGHT.lantern),
      ),
  },
  {
    id: 'bow',
    name: 'Bow',
    emoji: '🎀',
    price: 40,
    draw: (r) =>
      wrap(
        g()
          .poly([0, -r * 0.85, -r * 0.5, -r * 1.1, -r * 0.5, -r * 0.6])
          .fill(0xff6f91)
          .poly([0, -r * 0.85, r * 0.5, -r * 1.1, r * 0.5, -r * 0.6])
          .fill(0xff6f91)
          .circle(0, -r * 0.85, r * 0.12)
          .fill(darken(0xff6f91, 0.15)),
      ),
  },
  {
    id: 'antenna',
    name: 'Antennae',
    emoji: '🐜',
    price: 40,
    draw: (r) =>
      wrap(
        g()
          .moveTo(-r * 0.2, -r * 0.6)
          .lineTo(-r * 0.4, -r * 1.2)
          .moveTo(r * 0.2, -r * 0.6)
          .lineTo(r * 0.4, -r * 1.2)
          .stroke({ color: NIGHT.ink, width: Math.max(2, r * 0.06) })
          .circle(-r * 0.4, -r * 1.24, r * 0.1)
          .fill(NIGHT.ghost)
          .circle(r * 0.4, -r * 1.24, r * 0.1)
          .fill(NIGHT.ghost),
      ),
  },
  {
    id: 'candle',
    name: 'Candle',
    emoji: '🕯️',
    price: 80,
    draw: (r) =>
      wrap(
        g()
          .roundRect(-r * 0.1, -r * 1.3, r * 0.2, r * 0.5, r * 0.04)
          .fill(NIGHT.bone)
          .ellipse(0, -r * 1.36, r * 0.09, r * 0.16)
          .fill(NIGHT.lantern),
      ),
  },
  {
    id: 'skull',
    name: 'Skull Cap',
    emoji: '💀',
    price: 100,
    draw: (r) =>
      wrap(
        g()
          .circle(0, -r * 0.95, r * 0.32)
          .fill(NIGHT.bone)
          .circle(-r * 0.12, -r * 0.98, r * 0.07)
          .fill(0x140f1e)
          .circle(r * 0.12, -r * 0.98, r * 0.07)
          .fill(0x140f1e),
      ),
  },
  {
    id: 'flower',
    name: 'Nightbloom',
    emoji: '🌸',
    price: 40,
    draw: (r) => {
      const c = new Container();
      const gr = g();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        gr.circle(
          Math.cos(a) * r * 0.16 - r * 0.4,
          Math.sin(a) * r * 0.16 - r * 0.95,
          r * 0.1,
        ).fill(NIGHT.violet);
      }
      gr.circle(-r * 0.4, -r * 0.95, r * 0.09).fill(NIGHT.lantern);
      c.addChild(gr);
      return c;
    },
  },
  {
    id: 'catears',
    name: 'Cat Ears',
    emoji: '🐱',
    price: 60,
    draw: (r) =>
      wrap(
        g()
          .poly([-r * 0.62, -r * 0.5, -r * 0.5, -r * 1.1, -r * 0.14, -r * 0.66])
          .fill(0x2b2436)
          .poly([r * 0.62, -r * 0.5, r * 0.5, -r * 1.1, r * 0.14, -r * 0.66])
          .fill(0x2b2436)
          .poly([-r * 0.48, -r * 0.62, -r * 0.44, -r * 0.94, -r * 0.24, -r * 0.66])
          .fill(0xff8fa8)
          .poly([r * 0.48, -r * 0.62, r * 0.44, -r * 0.94, r * 0.24, -r * 0.66])
          .fill(0xff8fa8),
      ),
  },
  {
    id: 'mushroom',
    name: 'Toadstool',
    emoji: '🍄',
    price: 70,
    draw: (r) =>
      wrap(
        g()
          .roundRect(-r * 0.12, -r * 1.05, r * 0.24, r * 0.28, r * 0.06)
          .fill(NIGHT.bone)
          .ellipse(0, -r * 1.1, r * 0.42, r * 0.24)
          .fill(0xd6335a)
          .circle(-r * 0.18, -r * 1.14, r * 0.07)
          .fill(NIGHT.bone)
          .circle(r * 0.14, -r * 1.06, r * 0.06)
          .fill(NIGHT.bone)
          .circle(r * 0.02, -r * 1.22, r * 0.05)
          .fill(NIGHT.bone),
      ),
  },
  {
    id: 'spider',
    name: 'Pet Spider',
    emoji: '🕷️',
    price: 80,
    draw: (r) => {
      const c = new Container();
      const gr = g();
      const sy = -r * 1.15;
      gr.moveTo(r * 0.45, sy - r * 0.35)
        .lineTo(r * 0.45, sy)
        .stroke({ color: 0x8a86a0, width: Math.max(2, r * 0.04) });
      gr.circle(r * 0.45, sy + r * 0.08, r * 0.11).fill(0x1a1526);
      gr.circle(r * 0.45, sy - r * 0.04, r * 0.07).fill(0x1a1526);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          gr.moveTo(r * 0.45, sy + r * 0.06)
            .lineTo(r * 0.45 + s * r * 0.16, sy + (i - 1) * r * 0.09 + r * 0.06)
            .stroke({ color: 0x1a1526, width: Math.max(2, r * 0.035) });
        }
      }
      gr.circle(r * 0.42, sy + r * 0.05, r * 0.025).fill(NIGHT.blood);
      gr.circle(r * 0.48, sy + r * 0.05, r * 0.025).fill(NIGHT.blood);
      c.addChild(gr);
      return c;
    },
  },
  {
    id: 'wreath',
    name: 'Moon Wreath',
    emoji: '🌼',
    price: 90,
    draw: (r) => {
      const c = new Container();
      const gr = g();
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        const x = Math.cos(a) * r * 0.62;
        const y = -r * 0.72 + Math.sin(a) * r * 0.3;
        gr.circle(x, y, r * 0.09).fill(i % 2 ? 0xffc75f : NIGHT.violet);
        gr.circle(x, y, r * 0.04).fill(NIGHT.bone);
      }
      c.addChild(gr);
      return c;
    },
  },
  {
    id: 'pirate',
    name: 'Corsair',
    emoji: '🏴‍☠️',
    price: 100,
    draw: (r) =>
      wrap(
        g()
          .poly([-r * 0.78, -r * 0.5, r * 0.78, -r * 0.5, r * 0.5, -r * 1.0, -r * 0.5, -r * 1.0])
          .fill(0x1c1826)
          .poly([r * 0.72, -r * 0.52, r * 1.05, -r * 0.3, r * 0.8, -r * 0.66])
          .fill(0x1c1826)
          .circle(0, -r * 0.76, r * 0.13)
          .fill(NIGHT.bone)
          .moveTo(-r * 0.12, -r * 0.64)
          .lineTo(r * 0.12, -r * 0.88)
          .moveTo(-r * 0.12, -r * 0.88)
          .lineTo(r * 0.12, -r * 0.64)
          .stroke({ color: NIGHT.bone, width: Math.max(2, r * 0.05) }),
      ),
  },
  {
    id: 'bat',
    name: 'Roost Bat',
    emoji: '🦇',
    price: 120,
    draw: (r) =>
      wrap(
        g()
          .poly([
            -r * 0.12,
            -r * 1.02,
            -r * 0.55,
            -r * 1.25,
            -r * 0.4,
            -r * 1.02,
            -r * 0.55,
            -r * 0.9,
          ])
          .fill(0x241a38)
          .poly([r * 0.12, -r * 1.02, r * 0.55, -r * 1.25, r * 0.4, -r * 1.02, r * 0.55, -r * 0.9])
          .fill(0x241a38)
          .ellipse(0, -r * 1.02, r * 0.15, r * 0.19)
          .fill(0x241a38)
          .poly([-r * 0.1, -r * 1.16, -r * 0.16, -r * 1.32, -r * 0.03, -r * 1.2])
          .fill(0x241a38)
          .poly([r * 0.1, -r * 1.16, r * 0.16, -r * 1.32, r * 0.03, -r * 1.2])
          .fill(0x241a38)
          .circle(-r * 0.06, -r * 1.05, r * 0.03)
          .fill(NIGHT.lantern)
          .circle(r * 0.06, -r * 1.05, r * 0.03)
          .fill(NIGHT.lantern),
      ),
  },
  {
    id: 'fox',
    name: 'Fox Mask',
    emoji: '🦊',
    price: 140,
    draw: (r) =>
      wrap(
        g()
          .poly([-r * 0.55, -r * 0.6, 0, -r * 1.25, r * 0.55, -r * 0.6, 0, -r * 0.42])
          .fill(0xe08a3b)
          .poly([-r * 0.5, -r * 0.66, -r * 0.42, -r * 1.05, -r * 0.16, -r * 0.72])
          .fill(NIGHT.bone)
          .poly([r * 0.5, -r * 0.66, r * 0.42, -r * 1.05, r * 0.16, -r * 0.72])
          .fill(NIGHT.bone)
          .circle(-r * 0.2, -r * 0.72, r * 0.05)
          .fill(0x140f1e)
          .circle(r * 0.2, -r * 0.72, r * 0.05)
          .fill(0x140f1e)
          .poly([-r * 0.06, -r * 0.5, r * 0.06, -r * 0.5, 0, -r * 0.4])
          .fill(0x140f1e),
      ),
  },
  {
    id: 'moon',
    name: 'Crescent',
    emoji: '🌙',
    price: 160,
    draw: (r) =>
      wrap(
        g()
          .circle(0, -r * 1.1, r * 0.34)
          .fill(0xd7dcff)
          .circle(r * 0.14, -r * 1.16, r * 0.28)
          .fill(0x0b0a14)
          .circle(-r * 0.1, -r * 1.02, r * 0.035)
          .fill(NIGHT.lantern)
          .circle(-r * 0.26, -r * 1.24, r * 0.028)
          .fill(NIGHT.lantern),
      ),
  },
  {
    id: 'firefly',
    name: 'Firefly Halo',
    emoji: '✨',
    price: 200,
    draw: (r) => {
      const c = new Container();
      const gr = g();
      gr.ellipse(0, -r * 1.12, r * 0.55, r * 0.18).stroke({
        color: NIGHT.lantern,
        width: Math.max(2, r * 0.04),
        alpha: 0.4,
      });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * r * 0.55;
        const y = -r * 1.12 + Math.sin(a) * r * 0.18;
        gr.circle(x, y, r * 0.06).fill({ color: NIGHT.lantern, alpha: 0.95 });
        gr.circle(x, y, r * 0.11).fill({ color: NIGHT.lantern, alpha: 0.25 });
      }
      c.addChild(gr);
      return c;
    },
  },
  {
    id: 'shadowcrown',
    name: 'Shadow Crown',
    emoji: '🖤',
    price: 250,
    draw: (r) =>
      wrap(
        g()
          .poly([
            -r * 0.52,
            -r * 0.66,
            -r * 0.52,
            -r * 1.2,
            -r * 0.26,
            -r * 0.88,
            0,
            -r * 1.3,
            r * 0.26,
            -r * 0.88,
            r * 0.52,
            -r * 1.2,
            r * 0.52,
            -r * 0.66,
          ])
          .fill(0x1c1826)
          .poly([
            -r * 0.52,
            -r * 0.66,
            -r * 0.52,
            -r * 1.2,
            -r * 0.26,
            -r * 0.88,
            0,
            -r * 1.3,
            r * 0.26,
            -r * 0.88,
            r * 0.52,
            -r * 1.2,
            r * 0.52,
            -r * 0.66,
          ])
          .stroke({ color: NIGHT.violet, width: Math.max(2, r * 0.05) })
          .circle(0, -r * 1.02, r * 0.08)
          .fill(NIGHT.violet)
          .circle(-r * 0.34, -r * 0.86, r * 0.05)
          .fill(NIGHT.blood)
          .circle(r * 0.34, -r * 0.86, r * 0.05)
          .fill(NIGHT.blood),
      ),
  },
];

export const FREE_ACCESSORIES: number[] = ACCESSORIES.map((a, i) => (a.price ? -1 : i)).filter(
  (i) => i >= 0,
);

/** Draw the accessory at index over a blob of `radius`. */
export function accessoryView(index: number | undefined, radius: number): Container {
  const def = ACCESSORIES[index ?? 0];
  const built = def?.draw(radius) ?? null;
  return built ?? new Container();
}
