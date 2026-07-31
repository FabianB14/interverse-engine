/**
 * Built-in code-vector ability icons for on-screen ability buttons.
 * Use by id in api.ability({ icon: 'sword' }), or pass an imported image
 * with icon: '@<assetId>'. Drawn in the house style — chunky, readable at
 * thumb size, no external files.
 */
import { Graphics } from 'pixi.js';

export const ICON_IDS = ['sword', 'fire', 'bolt', 'snow', 'shield', 'boot', 'heart', 'star'] as const;
export type IconId = (typeof ICON_IDS)[number];
/** Does this string name a drawable icon (rather than being an emoji)? */
export const isIconId = (v: string): v is IconId => (ICON_IDS as readonly string[]).includes(v);

/** Draw an icon centered on (0,0) fitting a `size`-wide box. Unknown ids
 *  fall back to a star so a typo still renders something tappable. */
export function drawIcon(id: string, size = 44): Graphics {
  const g = new Graphics();
  const s = size / 2; // half-extent
  switch (id) {
    case 'sword':
      g.poly([-s * 0.75, s * 0.75, s * 0.45, -s * 0.45, s * 0.75, -s * 0.75, s * 0.45, -s * 0.75, -s * 0.55, s * 0.55])
        .fill(0xe6e4f0)
        .rect(-s * 0.85, s * 0.35, s * 0.55, s * 0.16)
        .fill(0xffd166);
      break;
    case 'fire':
      g.moveTo(0, -s * 0.85)
        .bezierCurveTo(s * 0.8, -s * 0.1, s * 0.55, s * 0.8, 0, s * 0.85)
        .bezierCurveTo(-s * 0.55, s * 0.8, -s * 0.8, -s * 0.1, 0, -s * 0.85)
        .fill(0xff8f5b)
        .circle(0, s * 0.3, s * 0.32)
        .fill(0xffd166);
      break;
    case 'bolt':
      g.poly([s * 0.1, -s * 0.9, -s * 0.55, s * 0.15, -s * 0.05, s * 0.15, -s * 0.1, s * 0.9, s * 0.55, -s * 0.05, s * 0.05, -s * 0.05])
        .fill(0xffd166);
      break;
    case 'snow': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        g.moveTo(Math.cos(a) * -s * 0.8, Math.sin(a) * -s * 0.8)
          .lineTo(Math.cos(a) * s * 0.8, Math.sin(a) * s * 0.8)
          .stroke({ color: 0x8fd0ff, width: size * 0.12, cap: 'round' });
      }
      g.circle(0, 0, s * 0.2).fill(0xe6f7ff);
      break;
    }
    case 'shield':
      g.moveTo(0, -s * 0.85)
        .lineTo(s * 0.7, -s * 0.5)
        .lineTo(s * 0.6, s * 0.25)
        .bezierCurveTo(s * 0.45, s * 0.7, 0, s * 0.9, 0, s * 0.9)
        .bezierCurveTo(0, s * 0.9, -s * 0.45, s * 0.7, -s * 0.6, s * 0.25)
        .lineTo(-s * 0.7, -s * 0.5)
        .closePath()
        .fill(0x6fc3ff)
        .moveTo(0, -s * 0.6)
        .lineTo(0, s * 0.62)
        .stroke({ color: 0x2a5f8f, width: size * 0.08 });
      break;
    case 'boot':
      // dash chevrons »
      for (const off of [-s * 0.45, s * 0.15]) {
        g.poly([off, -s * 0.6, off + s * 0.6, 0, off, s * 0.6, off + s * 0.25, s * 0.6, off + s * 0.85, 0, off + s * 0.25, -s * 0.6])
          .fill(0x8affc1);
      }
      break;
    case 'heart':
      g.circle(-s * 0.35, -s * 0.25, s * 0.42)
        .fill(0xff6f91)
        .circle(s * 0.35, -s * 0.25, s * 0.42)
        .fill(0xff6f91)
        .poly([-s * 0.72, 0, 0, s * 0.85, s * 0.72, 0])
        .fill(0xff6f91);
      break;
    case 'star':
    default: {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s * 0.9 : s * 0.4;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.poly(pts).fill(0xffd166);
      break;
    }
  }
  return g;
}
