import { Container, Graphics } from 'pixi.js';
import type { TileMapData } from './TileMap.js';

/**
 * A tile painter draws one tile with code-drawn vector art (§4.5 + §4.6) —
 * no tileset images required. `rng` is deterministic per tile so variation
 * (knots, stitches, leaf placement) is stable across frames and reloads.
 */
export type TilePainter = (
  g: Graphics,
  px: number,
  py: number,
  size: number,
  rng: () => number,
) => void;

function tileRng(tx: number, ty: number): () => number {
  let a = ((tx * 73856093) ^ (ty * 19349663) ^ 0x9e3779b9) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render a tilemap's ground layer into a single static Graphics, then cache
 * it as one texture — the whole floor becomes a single textured quad, which
 * keeps fill cost flat no matter how detailed the tile painters are.
 */
export function buildTileMapView(
  map: TileMapData,
  painters: Record<number, TilePainter>,
): Container {
  const view = new Container();
  const g = new Graphics();
  const ts = map.tileSize;
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const id = map.ground[ty]?.[tx] ?? 0;
      if (id === 0) continue;
      const paint = painters[id];
      paint?.(g, tx * ts, ty * ts, ts, tileRng(tx, ty));
    }
  }
  view.addChild(g);
  view.cacheAsTexture(true);
  return view;
}
