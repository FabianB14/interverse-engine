import { Container, Graphics } from 'pixi.js';
import type { TileMapData } from '@interverse/core';

/**
 * A tile painter draws one tile with code-drawn vector art (§4.5 + §4.6) —
 * no tileset images required. `rng` is deterministic per tile so variation
 * (knots, stitches, leaf placement) is stable across frames and reloads.
 * `mask` is the autotile neighbor mask (1=N 2=E 4=S 8=W, bit set = the
 * neighbor is the SAME terrain) — 15 when autotiling is off, so painters
 * that ignore it keep working unchanged.
 */
export type TilePainter = (
  g: Graphics,
  px: number,
  py: number,
  size: number,
  rng: () => number,
  mask?: number,
) => void;

/** Autotiling: which 4-neighbors count as the same terrain as (tx, ty).
 *  Out-of-bounds counts as same so map borders don't grow edge fringes. */
export function neighborMask(
  map: TileMapData,
  tx: number,
  ty: number,
  same: (a: number, b: number) => boolean,
): number {
  const id = map.ground[ty]?.[tx] ?? 0;
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return id;
    return map.ground[y]?.[x] ?? 0;
  };
  let m = 0;
  if (same(id, at(tx, ty - 1))) m |= 1;
  if (same(id, at(tx + 1, ty))) m |= 2;
  if (same(id, at(tx, ty + 1))) m |= 4;
  if (same(id, at(tx - 1, ty))) m |= 8;
  return m;
}

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
 * Render a tilemap's ground layer as cached-texture CHUNKS (≤2048px each) —
 * fill cost stays flat no matter how detailed the tile painters are, and no
 * chunk ever exceeds a GPU's max texture size. (Caching a huge map as ONE
 * texture silently fails past ~4096px on many phones — the floor renders
 * black. Chunking is what makes 80+ tile maps safe everywhere.)
 */
export function buildTileMapView(
  map: TileMapData,
  painters: Record<number, TilePainter>,
  sameGroup?: (a: number, b: number) => boolean,
): Container {
  const view = new Container();
  const ts = map.tileSize;
  const chunkTiles = Math.max(8, Math.floor(2048 / ts));
  for (let cy = 0; cy < map.height; cy += chunkTiles) {
    for (let cx = 0; cx < map.width; cx += chunkTiles) {
      const g = new Graphics();
      let any = false;
      for (let ty = cy; ty < Math.min(map.height, cy + chunkTiles); ty++) {
        for (let tx = cx; tx < Math.min(map.width, cx + chunkTiles); tx++) {
          const id = map.ground[ty]?.[tx] ?? 0;
          if (id === 0) continue;
          const paint = painters[id];
          const mask = sameGroup ? neighborMask(map, tx, ty, sameGroup) : 15;
          paint?.(g, tx * ts, ty * ts, ts, tileRng(tx, ty), mask);
          any = true;
        }
      }
      if (!any) {
        g.destroy();
        continue;
      }
      const chunk = new Container();
      chunk.addChild(g);
      chunk.cacheAsTexture(true);
      view.addChild(chunk);
    }
  }
  return view;
}
