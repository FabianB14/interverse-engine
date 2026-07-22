import { Container, Graphics } from 'pixi.js';
import { darken, lighten, verium } from '@interverse/engine';
import { store } from './store.js';

/**
 * Farm building — buy decorations and working structures, then tap a tile to
 * place them. Placements persist per-farm; a placed Crop Plot becomes a real,
 * plantable plot.
 */
export interface BuildDef {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  draw: (s: number, theme: { water: number; trunk: number }) => Container;
}

export interface Placed {
  id: string;
  /** Tile coords. */
  col: number;
  row: number;
}

function pond(s: number, t: { water: number }): Container {
  const c = new Container();
  const g = new Graphics();
  g.ellipse(0, 0, s * 0.62, s * 0.44).fill(darken(t.water, 0.12));
  g.ellipse(0, -s * 0.03, s * 0.54, s * 0.36).fill(t.water);
  g.ellipse(-s * 0.15, -s * 0.1, s * 0.14, s * 0.05).fill(lighten(t.water, 0.25));
  g.ellipse(s * 0.18, s * 0.08, s * 0.1, s * 0.04).fill(lighten(t.water, 0.2));
  return (c.addChild(g), c);
}

function bridge(s: number, t: { trunk: number }): Container {
  const c = new Container();
  const g = new Graphics();
  const plank = lighten(t.trunk, 0.15);
  for (let i = 0; i < 5; i++) {
    g.roundRect(-s * 0.45, -s * 0.3 + i * s * 0.15, s * 0.9, s * 0.11, s * 0.03).fill(
      i % 2 ? plank : darken(plank, 0.08),
    );
  }
  g.roundRect(-s * 0.5, -s * 0.42, s, s * 0.08, s * 0.03).fill(darken(plank, 0.25));
  g.roundRect(-s * 0.5, s * 0.36, s, s * 0.08, s * 0.03).fill(darken(plank, 0.25));
  return (c.addChild(g), c);
}

function shed(s: number, t: { trunk: number }): Container {
  const c = new Container();
  const g = new Graphics();
  const wall = lighten(t.trunk, 0.25);
  g.ellipse(0, s * 0.42, s * 0.5, s * 0.12).fill({ color: 0x000000, alpha: 0.15 });
  g.roundRect(-s * 0.4, -s * 0.15, s * 0.8, s * 0.55, s * 0.06).fill(wall);
  g.poly([-s * 0.48, -s * 0.12, s * 0.48, -s * 0.12, 0, -s * 0.55]).fill(0xc0564a);
  g.roundRect(-s * 0.12, s * 0.05, s * 0.24, s * 0.35, s * 0.04).fill(darken(wall, 0.35));
  g.roundRect(s * 0.16, -s * 0.02, s * 0.16, s * 0.16, s * 0.03).fill(0x9ad8ff);
  return (c.addChild(g), c);
}

function fence(s: number, t: { trunk: number }): Container {
  const c = new Container();
  const g = new Graphics();
  const wood = lighten(t.trunk, 0.2);
  for (const px of [-s * 0.36, 0, s * 0.36]) {
    g.roundRect(px - s * 0.05, -s * 0.3, s * 0.1, s * 0.6, s * 0.03).fill(wood);
  }
  g.roundRect(-s * 0.45, -s * 0.16, s * 0.9, s * 0.09, s * 0.03).fill(darken(wood, 0.12));
  g.roundRect(-s * 0.45, s * 0.08, s * 0.9, s * 0.09, s * 0.03).fill(darken(wood, 0.12));
  return (c.addChild(g), c);
}

export const BUILDS: readonly BuildDef[] = [
  { id: 'plot', name: 'Crop Plot', emoji: '🟫', cost: 80, draw: () => new Container() },
  { id: 'pond', name: 'Pond', emoji: '🪷', cost: 120, draw: (s, t) => pond(s, t) },
  // Streams are drawn tile-aware by the farm (they flow into neighbors),
  // so like plots they carry no standalone art here.
  { id: 'stream', name: 'Stream', emoji: '💧', cost: 40, draw: () => new Container() },
  { id: 'bridge', name: 'Bridge', emoji: '🌉', cost: 100, draw: (s, t) => bridge(s, t) },
  { id: 'fence', name: 'Fence', emoji: '🪵', cost: 60, draw: (s, t) => fence(s, t) },
  { id: 'shed', name: 'Farmhouse', emoji: '🏠', cost: 300, draw: (s, t) => shed(s, t) },
];

export function buildById(id: string): BuildDef | undefined {
  return BUILDS.find((b) => b.id === id);
}

const KEY = 'builds';

export function savedBuilds(): Placed[] {
  return store.get<Placed[]>(KEY, []);
}

/** Pay for and record a placement; false if broke or the tile is taken. */
export function placeBuild(id: string, col: number, row: number): boolean {
  const def = buildById(id);
  if (!def) return false;
  const list = savedBuilds();
  if (list.some((p) => p.col === col && p.row === row)) return false;
  if (!verium.spend(def.cost)) return false;
  list.push({ id, col, row });
  store.set(KEY, list);
  return true;
}
