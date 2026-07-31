/**
 * 🎩 The hats.
 *
 * These are the whole reason the blob's body and its cosmetics are separate
 * transforms. The body rolls — a full turn every `2πr` of road — and every
 * one of these sits dead level on top of it the entire way, because they are
 * parented to the rider rather than the wheel.
 *
 * Each is drawn at a unit radius of 1 and scaled to the blob, so a hat looks
 * right on the 46-unit runner and on the 90-unit one in the shop without
 * anybody maintaining two versions of it.
 *
 * `spin` is the exception that proves the rule: the propeller turns because
 * it is a propeller, on its own axis, at its own rate — not because the blob
 * underneath it happens to be rolling.
 */

import { Container, Graphics } from 'pixi.js';

export interface Hat {
  id: string;
  name: string;
  /** Coins to unlock. 0 = you start with it. */
  price: number;
  /** Something cheeky in the shop, so browsing is a small pleasure. */
  blurb: string;
}

export const HATS: readonly Hat[] = [
  { id: 'none', name: 'Bare', price: 0, blurb: 'Aerodynamic. Allegedly.' },
  { id: 'cap', name: 'Cap', price: 60, blurb: 'Worn backwards, obviously.' },
  { id: 'party', name: 'Party Cone', price: 150, blurb: 'Every run is an occasion.' },
  { id: 'horns', name: 'Horns', price: 260, blurb: 'For rolling with intent.' },
  { id: 'crown', name: 'Crown', price: 420, blurb: 'Heavy is the blob.' },
  { id: 'top', name: 'Top Hat', price: 600, blurb: 'Dreadfully overdressed.' },
  { id: 'halo', name: 'Halo', price: 850, blurb: 'Did not help. Still fell in a pit.' },
  { id: 'prop', name: 'Propeller', price: 1200, blurb: 'Does not work. Spins anyway.' },
];

export function hat(id: string): Hat {
  return HATS.find((h) => h.id === id) ?? HATS[0]!;
}

/**
 * A hat as a container you can bolt onto a rider.
 *
 * `spin`, when present, is the piece that turns on its own — kept as a
 * separate child so the caller can rotate it without touching the brim.
 */
export interface HatView {
  view: Container;
  spin?: Container;
}

export function hatView(id: string, radius: number, blobColor: number): HatView {
  const view = new Container();
  const g = new Graphics();
  // Everything below is authored against a blob of radius 1, sitting with
  // its crown at y = -1, then scaled once at the end.
  const top = -1;
  let spin: Container | undefined;

  switch (id) {
    case 'cap':
      g.ellipse(0, top - 0.16, 0.78, 0.34).fill(0xff6f91);
      // Backwards, so the peak reads against the direction of travel.
      g.ellipse(-0.72, top - 0.02, 0.42, 0.13).fill(0xe0537a);
      g.circle(0, top - 0.44, 0.1).fill(0xffd166);
      break;

    case 'party':
      g.poly([-0.62, top + 0.06, 0.62, top + 0.06, 0, top - 1.25]).fill(0x8affc1);
      g.poly([-0.3, top - 0.5, 0.34, top - 0.34, 0, top - 1.25]).fill(0xffd166);
      g.circle(0, top - 1.3, 0.14).fill(0xff6f91);
      break;

    case 'horns':
      g.poly([-0.62, top + 0.1, -1.0, top - 0.72, -0.24, top - 0.14]).fill(0xf0e6d2);
      g.poly([0.62, top + 0.1, 1.0, top - 0.72, 0.24, top - 0.14]).fill(0xf0e6d2);
      break;

    case 'crown':
      g.poly([
        -0.7, top + 0.04, 0.7, top + 0.04, 0.7, top - 0.42,
        0.35, top - 0.16, 0, top - 0.54, -0.35, top - 0.16, -0.7, top - 0.42,
      ]).fill(0xffd166);
      g.circle(0, top - 0.12, 0.11).fill(0xff6f91);
      break;

    case 'top':
      g.ellipse(0, top - 0.02, 0.86, 0.2).fill(0x2b2b3a);
      g.roundRect(-0.44, top - 1.0, 0.88, 1.0, 0.06).fill(0x3a3a4d);
      g.rect(-0.44, top - 0.36, 0.88, 0.16).fill(0xff6f91);
      break;

    case 'halo':
      // Floats clear of the head — a halo resting on a blob is a hat.
      g.ellipse(0, top - 0.62, 0.6, 0.2).stroke({ color: 0xffe9a8, width: 0.13 });
      g.ellipse(0, top - 0.62, 0.6, 0.2).stroke({ color: 0xffffff, width: 0.05, alpha: 0.8 });
      break;

    case 'prop': {
      g.ellipse(0, top - 0.1, 0.62, 0.26).fill(0x6ec5ff);
      g.rect(-0.05, top - 0.52, 0.1, 0.44).fill(0x4a4763);
      const blades = new Graphics();
      blades.ellipse(-0.42, 0, 0.42, 0.11).fill(0xff6f91);
      blades.ellipse(0.42, 0, 0.42, 0.11).fill(0xffd166);
      blades.circle(0, 0, 0.09).fill(0x4a4763);
      blades.position.set(0, top - 0.56);
      spin = blades;
      break;
    }

    default:
      // 'none' — an empty container, so callers never branch on it.
      break;
  }

  view.addChild(g);
  if (spin) view.addChild(spin);
  view.scale.set(radius);
  // Tint-free by design: a hat that recoloured itself per blob would stop
  // being a thing you own and start being a palette.
  void blobColor;
  return spin ? { view, spin } : { view };
}
