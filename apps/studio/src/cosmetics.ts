/**
 * Cosmetics & attachments — code-vector hats and held items that snap onto
 * any character actor (blob, story character, monster, boss). Drawn into
 * one Graphics layer per actor so outfits can be restyled live
 * (api.outfit) without rebuilding the entity — the base for unlockable
 * cosmetics shops.
 */
import { Graphics } from 'pixi.js';
import { darken, lighten } from '@interverse/engine';
import type { EntityDef } from './model.js';

export const HATS = ['', 'cap', 'crown', 'wizard', 'bow', 'horns', 'halo'] as const;
export const HELD_ITEMS = ['', 'sword', 'shield', 'staff', 'lantern', 'flower'] as const;

/** (Re)draw an actor's outfit into its dedicated Graphics layer. */
export function drawOutfit(g: Graphics, def: Pick<EntityDef, 'hat' | 'held' | 'radius' | 'color'>): void {
  g.clear();
  const r = def.radius;
  const top = -r * 0.95;
  switch (def.hat) {
    case 'cap':
      g.moveTo(-r * 0.55, top).arc(0, top, r * 0.55, Math.PI, 0).fill(0x6fc3ff);
      g.roundRect(0, top - 2, r * 0.8, 8, 4).fill(darken(0x6fc3ff, 0.2));
      break;
    case 'crown':
      g.poly([-r * 0.5, top, -r * 0.5, top - r * 0.45, -r * 0.25, top - r * 0.2, 0, top - r * 0.5, r * 0.25, top - r * 0.2, r * 0.5, top - r * 0.45, r * 0.5, top])
        .fill(0xffd166)
        .circle(0, top - r * 0.5, 3)
        .fill(0xff6f91);
      break;
    case 'wizard':
      g.poly([-r * 0.55, top, r * 0.55, top, r * 0.1, top - r * 0.95]).fill(0x9d4edd);
      g.circle(r * 0.1, top - r * 0.95, 4).fill(0xffd166);
      g.roundRect(-r * 0.7, top - 3, r * 1.4, 7, 3).fill(darken(0x9d4edd, 0.25));
      break;
    case 'bow':
      g.circle(-r * 0.45, top, r * 0.22).fill(0xff6f91);
      g.circle(-r * 0.13, top, r * 0.22).fill(0xff6f91);
      g.circle(-r * 0.29, top, r * 0.1).fill(darken(0xff6f91, 0.3));
      break;
    case 'horns':
      g.poly([-r * 0.5, top + 4, -r * 0.85, top - r * 0.55, -r * 0.25, top - r * 0.15]).fill(0xe6e4f0);
      g.poly([r * 0.5, top + 4, r * 0.85, top - r * 0.55, r * 0.25, top - r * 0.15]).fill(0xe6e4f0);
      break;
    case 'halo':
      g.ellipse(0, top - r * 0.35, r * 0.5, r * 0.16).stroke({ color: 0xffe9a8, width: 4 });
      break;
  }
  const hx = r * 1.05; // held items sit in the right "hand"
  switch (def.held) {
    case 'sword':
      g.poly([hx - 3, 6, hx + 3, 6, hx + 2, -r * 0.9, hx - 2, -r * 0.9]).fill(0xe6e4f0);
      g.rect(hx - 8, 2, 16, 4).fill(0xffd166);
      g.rect(hx - 2, 6, 4, 10).fill(0x8a6a44);
      break;
    case 'shield':
      g.roundRect(hx - 10, -r * 0.45, 20, r * 0.9, 8).fill(0x6fc3ff);
      g.roundRect(hx - 10, -r * 0.45, 20, r * 0.9, 8).stroke({ color: darken(0x6fc3ff, 0.35), width: 3 });
      break;
    case 'staff':
      g.roundRect(hx - 2, -r * 1.05, 4, r * 1.8, 2).fill(0x8a6a44);
      g.circle(hx, -r * 1.05, 7).fill(0x8affc1);
      g.circle(hx, -r * 1.05, 10).fill({ color: 0x8affc1, alpha: 0.25 });
      break;
    case 'lantern':
      g.rect(hx - 1, -r * 0.4, 2, 10).fill(0x2a2740);
      g.roundRect(hx - 7, -r * 0.4 + 10, 14, 16, 4).fill(lighten(0xffd166, 0.2));
      g.roundRect(hx - 7, -r * 0.4 + 10, 14, 16, 4).stroke({ color: 0xffd166, width: 2 });
      break;
    case 'flower':
      g.roundRect(hx - 1, -6, 2, 18, 1).fill(0x2f8d4a);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.circle(hx + Math.cos(a) * 6, -8 + Math.sin(a) * 6, 4).fill(0xffd1e0);
      }
      g.circle(hx, -8, 3.5).fill(0xffd166);
      break;
  }
}
