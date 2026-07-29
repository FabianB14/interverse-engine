/**
 * Tilemap painting — a per-level tile grid rendered through the engine's
 * tilemap system (tileMapFromRows + buildTileMapView), so painted levels get
 * the same code-vector terrain look as the built games, and solid tiles give
 * players real collision in Play mode.
 *
 * Grid: 18 x 32 cells of 40px fill the 720x1280 design space exactly.
 */
import { Container } from 'pixi.js';
import { buildTileMapView, darken, lighten, tileMapFromRows } from '@interverse/engine';
import type { TileLegendEntry, TileMapData, TilePainter } from '@interverse/engine';

export const TILE_SIZE = 40;
/** Grid dims for one screen (720x1280); bigger worlds scale these up. */
export const COLS = 18;
export const ROWS = 32;

export const colsFor = (worldW: number): number => Math.max(1, Math.round(worldW / TILE_SIZE));
export const rowsFor = (worldH: number): number => Math.max(1, Math.round(worldH / TILE_SIZE));

export interface TileType {
  ch: string;
  name: string;
  color: number;
  solid: boolean;
}

/** The paintbox. '.' erases back to the scene background. */
export const TILE_TYPES: TileType[] = [
  { ch: 'g', name: 'Grass', color: 0x3f7d46, solid: false },
  { ch: 'f', name: 'Flowers', color: 0x58975f, solid: false },
  { ch: 'd', name: 'Dirt path', color: 0x8a6a44, solid: false },
  { ch: 'p', name: 'Stone path', color: 0x8d8d99, solid: false },
  { ch: 's', name: 'Sand', color: 0xd8c284, solid: false },
  { ch: 'w', name: 'Water', color: 0x2f6ea8, solid: true },
  { ch: 'k', name: 'Rock wall', color: 0x5d5d6b, solid: true },
  { ch: 't', name: 'Tree', color: 0x2e5d38, solid: true },
  { ch: 'b', name: 'Brick wall', color: 0x7a4a3a, solid: true },
];

const IDS: Record<string, number> = { '.': 0 };
TILE_TYPES.forEach((t, i) => (IDS[t.ch] = i + 1));

export const legend: Record<string, TileLegendEntry> = { '.': { tile: 0 } };
for (const t of TILE_TYPES) legend[t.ch] = { tile: IDS[t.ch]!, ...(t.solid ? { solid: true } : {}) };

const byId = new Map<number, TileType>();
TILE_TYPES.forEach((t) => byId.set(IDS[t.ch]!, t));

/** Code-vector painters per tile id (id 0 = empty, unpainted). */
export const painters: Record<number, TilePainter> = {};
for (const t of TILE_TYPES) {
  const id = IDS[t.ch]!;
  painters[id] = (g, x, y, s, rng) => {
    const c = t.color;
    switch (t.ch) {
      case 'g':
      case 'f':
        g.rect(x, y, s, s).fill(rng() > 0.5 ? c : darken(c, 0.07));
        if (rng() > 0.55) {
          g.rect(x + rng() * (s - 8) + 2, y + rng() * (s - 10) + 2, 2, 6).fill(darken(c, 0.25));
        }
        if (t.ch === 'f' && rng() > 0.45) {
          g.circle(x + 6 + rng() * (s - 12), y + 6 + rng() * (s - 12), 3).fill(
            rng() > 0.5 ? 0xffd1e0 : 0xfff3ae,
          );
        }
        break;
      case 'd':
      case 's':
        g.rect(x, y, s, s).fill(rng() > 0.5 ? c : darken(c, 0.08));
        if (rng() > 0.6) g.circle(x + rng() * s, y + rng() * s, 2).fill(darken(c, 0.2));
        break;
      case 'p':
        g.rect(x, y, s, s).fill(rng() > 0.5 ? c : darken(c, 0.1));
        g.rect(x + 2, y + 2, s - 4, s - 4).stroke({ color: darken(c, 0.3), width: 2, alpha: 0.6 });
        break;
      case 'w':
        g.rect(x, y, s, s).fill(c);
        g.moveTo(x + 4, y + s * (0.3 + rng() * 0.4))
          .lineTo(x + s - 4, y + s * (0.3 + rng() * 0.4))
          .stroke({ color: lighten(c, 0.25), width: 2, alpha: 0.5 });
        break;
      case 'k':
        g.rect(x, y, s, s).fill(c);
        g.rect(x, y + s / 2 - 1, s, 2).fill(darken(c, 0.4));
        g.rect(x + (rng() > 0.5 ? s / 2 : s / 4), y, 2, s / 2).fill(darken(c, 0.4));
        g.rect(x + 2, y + 2, s - 4, s / 2 - 3).fill({ color: lighten(c, 0.12), alpha: 0.4 });
        break;
      case 't': {
        g.rect(x, y, s, s).fill(0x2a4a30);
        g.roundRect(x + s / 2 - 3, y + s * 0.55, 6, s * 0.35, 2).fill(0x5a4028);
        g.circle(x + s / 2, y + s * 0.4, s * 0.34).fill(c);
        g.circle(x + s * 0.34, y + s * 0.5, s * 0.22).fill(darken(c, 0.12));
        g.circle(x + s * 0.66, y + s * 0.48, s * 0.22).fill(lighten(c, 0.08));
        break;
      }
      case 'b':
        g.rect(x, y, s, s).fill(c);
        g.rect(x, y + s / 2 - 1, s, 2).fill(darken(c, 0.45));
        g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y, 2, s / 2).fill(darken(c, 0.45));
        g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y + s / 2, 2, s / 2).fill(darken(c, 0.45));
        break;
    }
  };
}

export function emptyRows(cols = COLS, rows = ROWS): string[] {
  return Array.from({ length: rows }, () => '.'.repeat(cols));
}

/** Normalize arbitrary imported rows to a cols x rows grid of known chars —
 *  also how a level's painting is preserved when its size changes. */
export function normalizeRows(rowsIn: unknown, cols = COLS, rows = ROWS): string[] {
  const known = new Set(Object.keys(legend));
  const out = emptyRows(cols, rows);
  if (!Array.isArray(rowsIn)) return out;
  for (let r = 0; r < rows; r++) {
    const src = typeof rowsIn[r] === 'string' ? (rowsIn[r] as string) : '';
    let line = '';
    for (let c = 0; c < cols; c++) {
      const ch = src[c] ?? '.';
      line += known.has(ch) ? ch : '.';
    }
    out[r] = line;
  }
  return out;
}

export function setTileChar(rows: string[], col: number, row: number, ch: string): void {
  const line = rows[row];
  if (line === undefined || col < 0 || col >= line.length) return;
  rows[row] = line.slice(0, col) + ch + line.slice(col + 1);
}

export function tileCharAt(rows: string[], col: number, row: number): string {
  return rows[row]?.[col] ?? '.';
}

export function anyTiles(rows: string[] | undefined): boolean {
  return !!rows && rows.some((r) => [...r].some((ch) => ch !== '.'));
}

/** Build the render layer + collision map for a rows grid. */
export function buildTileLayer(rows: string[]): { view: Container; map: TileMapData } {
  const map = tileMapFromRows(rows, TILE_SIZE, legend);
  const view = buildTileMapView(map, painters);
  return { view, map };
}
