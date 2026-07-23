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
      wrap(g().ellipse(0, -r * 1.15, r * 0.5, r * 0.16).stroke({ color: 0xffe9a8, width: Math.max(3, r * 0.1) })),
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
            -r * 0.5, -r * 0.7, -r * 0.5, -r * 1.15, -r * 0.25, -r * 0.9, 0, -r * 1.2, r * 0.25, -r * 0.9,
            r * 0.5, -r * 1.15, r * 0.5, -r * 0.7,
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
        gr.circle(Math.cos(a) * r * 0.16 - r * 0.4, Math.sin(a) * r * 0.16 - r * 0.95, r * 0.1).fill(NIGHT.violet);
      }
      gr.circle(-r * 0.4, -r * 0.95, r * 0.09).fill(NIGHT.lantern);
      c.addChild(gr);
      return c;
    },
  },
];

export const FREE_ACCESSORIES: number[] = ACCESSORIES.map((a, i) => (a.price ? -1 : i)).filter((i) => i >= 0);

/** Draw the accessory at index over a blob of `radius`. */
export function accessoryView(index: number | undefined, radius: number): Container {
  const def = ACCESSORIES[index ?? 0];
  const built = def?.draw(radius) ?? null;
  return built ?? new Container();
}
