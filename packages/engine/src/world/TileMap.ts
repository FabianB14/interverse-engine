/**
 * Tilemap data model (§4.6): layers of paintable tiles, a collision grid,
 * and named objects (spawns/triggers). The model is Tiled-shaped — a .tmj
 * adapter can populate it once a real Tiled-authored map exists; until then
 * maps are authored as readable ASCII rows via tileMapFromRows().
 */

export interface TileMapObject {
  name: string;
  /** World position (tile center), in pixels. */
  x: number;
  y: number;
  tileX: number;
  tileY: number;
}

export interface TileMapData {
  tileSize: number;
  /** Size in tiles. */
  width: number;
  height: number;
  /** [row][col] painter ids; 0 = empty. */
  ground: number[][];
  solid: boolean[][];
  objects: TileMapObject[];
}

export interface TileLegendEntry {
  tile: number;
  solid?: boolean;
  /** Emit a named object at this tile's center (tile itself still painted). */
  object?: string;
}

/** Build a map from equal-length strings, one character per tile. */
export function tileMapFromRows(
  rows: readonly string[],
  tileSize: number,
  legend: Record<string, TileLegendEntry>,
): TileMapData {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const ground: number[][] = [];
  const solid: boolean[][] = [];
  const objects: TileMapObject[] = [];

  for (let ty = 0; ty < height; ty++) {
    const row = rows[ty] ?? '';
    if (row.length !== width) {
      throw new Error(`tileMapFromRows: row ${ty} is ${row.length} chars, expected ${width}`);
    }
    const groundRow: number[] = [];
    const solidRow: boolean[] = [];
    for (let tx = 0; tx < width; tx++) {
      const ch = row[tx] ?? ' ';
      const entry = legend[ch];
      if (!entry) throw new Error(`tileMapFromRows: no legend entry for "${ch}"`);
      groundRow.push(entry.tile);
      solidRow.push(entry.solid === true);
      if (entry.object) {
        objects.push({
          name: entry.object,
          x: (tx + 0.5) * tileSize,
          y: (ty + 0.5) * tileSize,
          tileX: tx,
          tileY: ty,
        });
      }
    }
    ground.push(groundRow);
    solid.push(solidRow);
  }

  return { tileSize, width, height, ground, solid, objects };
}

/** Solid query; out-of-bounds counts as solid so nothing escapes the map. */
export function solidAt(map: TileMapData, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return true;
  return map.solid[tileY]?.[tileX] ?? true;
}

/**
 * Free-movement helper (§4.6): move an AABB (center x/y, half-extents) by
 * (dx, dy) with axis-separated collision against solid tiles, sliding along
 * walls. Returns the resolved position.
 */
export function moveWithCollision(
  map: TileMapData,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const ts = map.tileSize;
  const eps = 0.01;

  let nx = x + dx;
  if (dx !== 0) {
    const edgeX = dx > 0 ? nx + halfW : nx - halfW;
    const tx = Math.floor(edgeX / ts);
    const ty0 = Math.floor((y - halfH) / ts);
    const ty1 = Math.floor((y + halfH - eps) / ts);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (solidAt(map, tx, ty)) {
        nx = dx > 0 ? tx * ts - halfW - eps : (tx + 1) * ts + halfW + eps;
        break;
      }
    }
  }

  let ny = y + dy;
  if (dy !== 0) {
    const edgeY = dy > 0 ? ny + halfH : ny - halfH;
    const ty = Math.floor(edgeY / ts);
    const tx0 = Math.floor((nx - halfW) / ts);
    const tx1 = Math.floor((nx + halfW - eps) / ts);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (solidAt(map, tx, ty)) {
        ny = dy > 0 ? ty * ts - halfH - eps : (ty + 1) * ts + halfH + eps;
        break;
      }
    }
  }

  return { x: nx, y: ny };
}
