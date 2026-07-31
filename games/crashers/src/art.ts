/**
 * 🎨 Everything this game draws, in the house style.
 *
 * Code-vector only: no image files, so the whole game is a few tens of
 * kilobytes and every colour can be themed per stage. The blob body comes
 * from the engine; what is here is the stage dressing and the cosmetics that
 * make one blob tell itself apart from another in a four-way scrum.
 */

import { Container, Graphics } from 'pixi.js';
import { blobCharacter, darken, depthScale, lighten } from '@interverse/engine';
import type { Biome } from './levels.js';

/** A blob with a hat and something in its hand. Cosmetics are the cheapest
 *  way to make a roster readable at phone size — colour tells you WHO, and
 *  silhouette tells you WHAT even when four of you overlap. */
export function fighter(opts: {
  radius: number;
  color: number;
  seed: number;
  hat: string;
  held: string;
}): Container {
  const root = new Container();
  const char = blobCharacter({ radius: opts.radius, color: opts.color, seed: opts.seed });
  root.addChild(char.view);
  const g = new Graphics();
  const r = opts.radius;
  drawHat(g, opts.hat, r, opts.color);
  drawHeld(g, opts.held, r);
  root.addChild(g);
  return root;
}

function drawHat(g: Graphics, hat: string, r: number, color: number): void {
  const top = -r * 1.05;
  switch (hat) {
    case 'helm':
      g.roundRect(-r * 0.8, top - r * 0.34, r * 1.6, r * 0.62, r * 0.2).fill(0xb8c4d4);
      g.rect(-r * 0.1, top - r * 0.34, r * 0.2, r * 0.62).fill(0x8b98aa);
      break;
    case 'hood':
      g.ellipse(0, top - r * 0.02, r * 0.95, r * 0.55).fill(darken(color, 0.45));
      break;
    case 'horns':
      g.poly([-r * 0.7, top, -r * 1.05, top - r * 0.75, -r * 0.3, top - r * 0.2]).fill(0xf0e6d2);
      g.poly([r * 0.7, top, r * 1.05, top - r * 0.75, r * 0.3, top - r * 0.2]).fill(0xf0e6d2);
      break;
    case 'wizard':
      g.poly([-r * 0.75, top, r * 0.75, top, 0, top - r * 1.25]).fill(0x4a3b8a);
      g.circle(0, top - r * 1.25, r * 0.14).fill(0xffd166);
      break;
    case 'crown':
      g.poly([
        -r * 0.72, top, r * 0.72, top, r * 0.72, top - r * 0.4, r * 0.36, top - r * 0.16,
        0, top - r * 0.5, -r * 0.36, top - r * 0.16, -r * 0.72, top - r * 0.4,
      ]).fill(0xffd166);
      break;
    default:
      break;
  }
}

function drawHeld(g: Graphics, held: string, r: number): void {
  const x = r * 0.95;
  const y = r * 0.1;
  switch (held) {
    case 'sword':
      g.roundRect(x, y - r * 0.95, r * 0.16, r * 1.15, r * 0.06).fill(0xd7dde8);
      g.rect(x - r * 0.16, y + r * 0.1, r * 0.48, r * 0.12).fill(0x8a6a44);
      break;
    case 'dagger':
      g.roundRect(x, y - r * 0.55, r * 0.13, r * 0.7, r * 0.05).fill(0xd7dde8);
      break;
    case 'club':
      g.roundRect(x, y - r * 0.5, r * 0.18, r * 0.9, r * 0.07).fill(0x8a6a44);
      g.circle(x + r * 0.09, y - r * 0.62, r * 0.32).fill(0x6b5540);
      break;
    case 'staff':
      g.roundRect(x, y - r * 1.05, r * 0.13, r * 1.5, r * 0.06).fill(0x8a6a44);
      g.circle(x + r * 0.06, y - r * 1.1, r * 0.2).fill(0x8affc1);
      break;
    default:
      break;
  }
}

/**
 * The stage itself: sky, a ground band, and a horizon line.
 *
 * The band is where every fight happens, so it is drawn with a hard edge at
 * the top — that line IS the wall the player cannot walk past, and making it
 * visible is the difference between a rule and a mystery.
 */
export function stageBackdrop(
  biome: Biome,
  width: number,
  horizonY: number,
  bottomY: number,
): Container {
  const root = new Container();
  const g = new Graphics();
  g.rect(0, 0, width, horizonY).fill(biome.sky);
  // A softer band just under the sky reads as distance haze.
  g.rect(0, horizonY - 90, width, 90).fill({ color: lighten(biome.ground, 0.35), alpha: 0.5 });
  g.rect(0, horizonY, width, bottomY - horizonY).fill(biome.ground);
  g.rect(0, horizonY - 4, width, 8).fill({ color: darken(biome.ground, 0.45), alpha: 0.75 });
  // Ground texture: faint stripes so movement in depth is legible.
  for (let y = horizonY + 60; y < bottomY; y += 90) {
    g.rect(0, y, width, 3).fill({ color: darken(biome.ground, 0.18), alpha: 0.35 });
  }
  root.addChild(g);
  return root;
}

/** Scenery along the back of the stage. Placed by index rather than randomly
 *  so a stage looks the same every time you replay it. */
export function scenery(biome: Biome, width: number, horizonY: number): Container {
  const root = new Container();
  root.sortableChildren = true;
  for (let i = 0; i * 380 < width; i++) {
    const x = 180 + i * 380;
    const y = horizonY + 30 + ((i * 137) % 90);
    const prop = new Graphics();
    drawProp(prop, biome, ((i * 53) % 40) / 100 + 0.85);
    prop.position.set(x, y);
    prop.scale.set(depthScale(y));
    prop.zIndex = y;
    root.addChild(prop);
  }
  return root;
}

function drawProp(g: Graphics, biome: Biome, size: number): void {
  const c = biome.prop;
  const s = 70 * size;
  switch (biome.propKind) {
    case 'tree':
      g.rect(-s * 0.12, -s * 0.5, s * 0.24, s * 0.5).fill(0x4a3826);
      g.circle(0, -s * 0.75, s * 0.5).fill(c);
      g.circle(-s * 0.3, -s * 0.55, s * 0.34).fill(darken(c, 0.12));
      break;
    case 'pillar':
      g.rect(-s * 0.26, -s * 1.5, s * 0.52, s * 1.5).fill(c);
      g.rect(-s * 0.36, -s * 1.62, s * 0.72, s * 0.16).fill(lighten(c, 0.2));
      g.rect(-s * 0.36, -s * 0.12, s * 0.72, s * 0.14).fill(darken(c, 0.25));
      break;
    case 'crystal':
      g.poly([0, -s * 1.4, s * 0.32, -s * 0.4, 0, 0, -s * 0.32, -s * 0.4]).fill(c);
      g.poly([0, -s * 1.4, s * 0.32, -s * 0.4, 0, -s * 0.5]).fill(lighten(c, 0.3));
      break;
    case 'crate':
      g.roundRect(-s * 0.36, -s * 0.72, s * 0.72, s * 0.72, s * 0.06).fill(c);
      g.moveTo(-s * 0.36, -s * 0.72).lineTo(s * 0.36, 0).stroke({ color: darken(c, 0.3), width: 3 });
      break;
    case 'torch':
      g.rect(-s * 0.08, -s * 1.1, s * 0.16, s * 1.1).fill(0x4a3826);
      g.circle(0, -s * 1.2, s * 0.22).fill(c);
      g.circle(0, -s * 1.24, s * 0.12).fill(lighten(c, 0.45));
      break;
    default:
      break;
  }
}

/** The gate that holds the player: a shimmering barrier with an arrow that
 *  only appears once it opens, so "go right" is never ambiguous. */
export function gateBarrier(height: number, color = 0xffd166): Graphics {
  const g = new Graphics();
  g.rect(-6, -height, 12, height).fill({ color, alpha: 0.35 });
  for (let y = -height; y < 0; y += 40) {
    g.rect(-10, y, 20, 18).fill({ color, alpha: 0.22 });
  }
  return g;
}
