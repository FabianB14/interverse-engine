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
  /** One-way: you land on top but jump up through it from below. The
   *  ledge every platformer is built out of. NOT solid, so top-down levels
   *  and the engine's own collision walk straight through. */
  platform?: boolean;
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
  { ch: 'l', name: 'Ledge (jump-through)', color: 0x9a7b4f, solid: false, platform: true },
];

/** Chars that are one-way platforms. */
export const PLATFORM_CHARS: ReadonlySet<string> = new Set(TILE_TYPES.filter((t) => t.platform).map((t) => t.ch));

export const isPlatformChar = (ch: string): boolean => PLATFORM_CHARS.has(ch);

const IDS: Record<string, number> = { '.': 0 };
TILE_TYPES.forEach((t, i) => (IDS[t.ch] = i + 1));

export const legend: Record<string, TileLegendEntry> = { '.': { tile: 0 } };
for (const t of TILE_TYPES) legend[t.ch] = { tile: IDS[t.ch]!, ...(t.solid ? { solid: true } : {}) };

const byId = new Map<number, TileType>();
TILE_TYPES.forEach((t) => byId.set(IDS[t.ch]!, t));

/** Autotiling terrain groups — tiles in the same group blend seamlessly;
 *  edges/corners against anything else resolve automatically (RPG-Maker
 *  style, zero config: it's computed from neighbors at render time). */
const GROUP: Record<string, string> = {
  g: 'grass',
  f: 'grass',
  d: 'dirt',
  p: 'stone',
  s: 'sand',
  w: 'water',
  k: 'rock',
  t: 'tree',
  b: 'brick',
};
const idGroup = new Map<number, string>();
for (const t of TILE_TYPES) idGroup.set(IDS[t.ch]!, GROUP[t.ch]!);

export const sameTerrain = (a: number, b: number): boolean =>
  a !== 0 && b !== 0 && idGroup.get(a) === idGroup.get(b);

/** Which sides of a tile face DIFFERENT terrain (and so get an edge). */
const openEdges = (mask: number): { n: boolean; e: boolean; s: boolean; w: boolean } => ({
  n: !(mask & 1),
  e: !(mask & 2),
  s: !(mask & 4),
  w: !(mask & 8),
});

/** Code-vector painters per tile id (id 0 = empty, unpainted). */
export const painters: Record<number, TilePainter> = {};
for (const t of TILE_TYPES) {
  const id = IDS[t.ch]!;
  painters[id] = (g, x, y, s, rng, mask = 15) => {
    const c = t.color;
    const edge = openEdges(mask);
    // Autotile edge band along any side facing different terrain.
    const band = (color: number, w = 3, alpha = 1): void => {
      if (edge.n) g.rect(x, y, s, w).fill({ color, alpha });
      if (edge.s) g.rect(x, y + s - w, s, w).fill({ color, alpha });
      if (edge.w) g.rect(x, y, w, s).fill({ color, alpha });
      if (edge.e) g.rect(x + s - w, y, w, s).fill({ color, alpha });
    };
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
        // grass fringe where the lawn ends — darker lip + a few blades
        band(darken(c, 0.32));
        if (edge.n) for (let i = 0; i < 3; i++) g.rect(x + 5 + i * 13 + rng() * 4, y, 2, 6).fill(darken(c, 0.32));
        if (edge.s) for (let i = 0; i < 3; i++) g.rect(x + 5 + i * 13 + rng() * 4, y + s - 6, 2, 6).fill(darken(c, 0.32));
        break;
      case 'd':
      case 's':
        g.rect(x, y, s, s).fill(rng() > 0.5 ? c : darken(c, 0.08));
        if (rng() > 0.6) g.circle(x + rng() * s, y + rng() * s, 2).fill(darken(c, 0.2));
        band(darken(c, 0.22)); // soft path/beach edge
        break;
      case 'p':
        g.rect(x, y, s, s).fill(rng() > 0.5 ? c : darken(c, 0.1));
        g.rect(x + 2, y + 2, s - 4, s - 4).stroke({ color: darken(c, 0.3), width: 2, alpha: 0.6 });
        band(darken(c, 0.35)); // paved edge kerb
        break;
      case 'w':
        g.rect(x, y, s, s).fill(c);
        g.moveTo(x + 4, y + s * (0.3 + rng() * 0.4))
          .lineTo(x + s - 4, y + s * (0.3 + rng() * 0.4))
          .stroke({ color: lighten(c, 0.25), width: 2, alpha: 0.5 });
        // shoreline foam wherever water meets land
        band(lighten(c, 0.5), 3, 0.9);
        if (edge.n) g.rect(x, y + 3, s, 2).fill({ color: lighten(c, 0.3), alpha: 0.5 });
        if (edge.w) g.rect(x + 3, y, 2, s).fill({ color: lighten(c, 0.3), alpha: 0.5 });
        break;
      case 'k':
        g.rect(x, y, s, s).fill(c);
        g.rect(x, y + s / 2 - 1, s, 2).fill(darken(c, 0.4));
        g.rect(x + (rng() > 0.5 ? s / 2 : s / 4), y, 2, s / 2).fill(darken(c, 0.4));
        g.rect(x + 2, y + 2, s - 4, s / 2 - 3).fill({ color: lighten(c, 0.12), alpha: 0.4 });
        band(darken(c, 0.5)); // rock face caps at the wall's outline
        break;
      case 't': {
        g.rect(x, y, s, s).fill(0x2a4a30);
        g.roundRect(x + s / 2 - 3, y + s * 0.55, 6, s * 0.35, 2).fill(0x5a4028);
        g.circle(x + s / 2, y + s * 0.4, s * 0.34).fill(c);
        g.circle(x + s * 0.34, y + s * 0.5, s * 0.22).fill(darken(c, 0.12));
        g.circle(x + s * 0.66, y + s * 0.48, s * 0.22).fill(lighten(c, 0.08));
        break;
      }
      case 'l':
        // A plank you land on: a lit top lip and a shallow body, so it
        // reads as something you stand ON rather than a wall you cannot
        // pass — which is exactly how it behaves.
        g.rect(x, y, s, s * 0.34).fill(c);
        g.rect(x, y, s, 3).fill(lighten(c, 0.4));
        g.rect(x, y + s * 0.34 - 2, s, 2).fill(darken(c, 0.5));
        break;
      case 'b':
        g.rect(x, y, s, s).fill(c);
        g.rect(x, y + s / 2 - 1, s, 2).fill(darken(c, 0.45));
        g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y, 2, s / 2).fill(darken(c, 0.45));
        g.rect(x + (rng() > 0.5 ? s / 2 : 0) - 1, y + s / 2, 2, s / 2).fill(darken(c, 0.45));
        band(darken(c, 0.55)); // continuous wall outline; bricks bond inside
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

/** Build the render layer + collision map for a rows grid — with
 *  autotiling: edges resolve against neighboring terrain automatically. */
export function buildTileLayer(rows: string[]): { view: Container; map: TileMapData } {
  const map = tileMapFromRows(rows, TILE_SIZE, legend);
  const view = buildTileMapView(map, painters, sameTerrain);
  return { view, map };
}

// --------------------------------------------------------------- layers

/**
 * 🥞 Three tile layers, because one is not enough to draw a place.
 *
 * A single grid forces every choice at once: a tree you can walk behind has
 * to be either solid (so you cannot) or drawn under you (so it is not a
 * tree). Splitting into behind / main / in-front separates "what it looks
 * like" from "what stops you", which is the whole point.
 *
 * Only the main layer collides. That is a rule, not a default: a decorative
 * layer that could quietly block the player would reintroduce exactly the
 * confusion this is here to remove.
 */
export type TileLayerId = 'back' | 'main' | 'over';

export interface TileLayerSpec {
  id: TileLayerId;
  /** The SceneDef field it lives in. `main` keeps the original name, so
   *  every game made before layers existed is already a main-layer game. */
  key: 'tilesBack' | 'tiles' | 'tilesOver';
  emoji: string;
  label: string;
  hint: string;
  solid: boolean;
}

/** Painting order, back to front. */
export const TILE_LAYERS: readonly TileLayerSpec[] = [
  {
    id: 'back', key: 'tilesBack', emoji: '⬓', label: 'Behind', solid: false,
    hint: 'Ground, paths, rugs — under everything. Never blocks anyone.',
  },
  {
    id: 'main', key: 'tiles', emoji: '⬛', label: 'Main', solid: true,
    hint: 'The level itself. Solid tiles here are the ones that block players.',
  },
  {
    id: 'over', key: 'tilesOver', emoji: '⬒', label: 'In front', solid: false,
    hint: 'Drawn OVER the actors — treetops, roofs, mist to walk behind. Never blocks.',
  },
];

export function tileLayerSpec(id: string): TileLayerSpec {
  return TILE_LAYERS.find((l) => l.id === id) ?? TILE_LAYERS[1]!;
}

export function isTileLayerId(v: unknown): v is TileLayerId {
  return TILE_LAYERS.some((l) => l.id === v);
}

/** The only layer that stops anybody. Kept as a function so the answer to
 *  "can this layer block me" has exactly one place to come from. */
export function layerBlocks(id: TileLayerId): boolean {
  return tileLayerSpec(id).solid;
}
