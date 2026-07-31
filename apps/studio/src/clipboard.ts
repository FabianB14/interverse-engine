/**
 * 📋 Copy, cut, paste, duplicate — and the maths behind a marquee.
 *
 * Kept pure and DOM-free: what a paste PRODUCES is the part that goes
 * wrong (duplicate names silently breaking `api.entity('Crate')`, shared
 * ids making two actors the same actor), and that is exactly the part
 * worth testing without a browser.
 */
import { freshId } from './model.js';
import type { EntityDef, SceneDef } from './model.js';

/** Where the clipboard survives a reload, and travels between tabs. */
export const CLIPBOARD_KEY = 'interverse.studio.clipboard';

/** A name not already taken in the scene: "Crate", "Crate 2", "Crate 3"…
 *  Names are how scripts and events refer to actors, so a collision is not
 *  cosmetic — it silently repoints someone's `api.entity()` call. */
export function uniqueName(base: string, used: ReadonlySet<string>): string {
  // Strip a trailing counter so pasting "Crate 2" gives "Crate 3", not
  // "Crate 2 2".
  const root = base.replace(/ \d+$/, '') || base;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${root} ${n}`)) n++;
  return `${root} ${n}`;
}

export interface PasteOpts {
  /** Nudge so a paste-in-place is visibly a new thing. */
  offsetX?: number;
  offsetY?: number;
  /** Drop them centred here instead of offsetting (paste at the cursor). */
  at?: { x: number; y: number };
}

/**
 * Clone defs for insertion into a scene: fresh ids, names that do not
 * collide, positions offset or re-centred, and everything clamped inside
 * the world so a paste can never land somewhere unreachable.
 */
export function cloneForPaste(defs: readonly EntityDef[], scene: SceneDef, opts: PasteOpts = {}): EntityDef[] {
  if (!defs.length) return [];
  const used = new Set(scene.entities.map((e) => e.name));
  const dx = opts.offsetX ?? 24;
  const dy = opts.offsetY ?? 24;

  // Re-centring moves the GROUP, keeping its internal arrangement — that is
  // what makes pasting a copied cluster useful rather than a pile.
  let shiftX = dx;
  let shiftY = dy;
  if (opts.at) {
    const cx = defs.reduce((n, d) => n + d.x, 0) / defs.length;
    const cy = defs.reduce((n, d) => n + d.y, 0) / defs.length;
    shiftX = opts.at.x - cx;
    shiftY = opts.at.y - cy;
  }

  return defs.map((d) => {
    const copy: EntityDef = structuredClone(d);
    copy.id = freshId('e');
    copy.name = uniqueName(d.name, used);
    used.add(copy.name);
    copy.x = Math.max(20, Math.min(scene.worldW - 20, Math.round(d.x + shiftX)));
    copy.y = Math.max(20, Math.min(scene.worldH - 20, Math.round(d.y + shiftY)));
    return copy;
  });
}

/** Everything inside a marquee. Normalized so dragging in any direction
 *  works — a rectangle drawn right-to-left is still a rectangle. */
export function withinMarquee(
  entities: readonly EntityDef[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return entities.filter((e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1).map((e) => e.id);
}

/** A drag this small was a click, not a marquee. */
export const MARQUEE_MIN = 6;

export function isMarquee(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) >= MARQUEE_MIN || Math.abs(a.y - b.y) >= MARQUEE_MIN;
}

/** Toggle for ctrl/shift-click; plain click replaces the selection. */
export function toggleIn(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function boundsOf(defs: readonly EntityDef[]): Bounds | null {
  if (!defs.length) return null;
  return {
    x0: Math.min(...defs.map((d) => d.x)),
    y0: Math.min(...defs.map((d) => d.y)),
    x1: Math.max(...defs.map((d) => d.x)),
    y1: Math.max(...defs.map((d) => d.y)),
  };
}

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

/** Line a selection up. Mutates in place and returns how many moved. */
export function alignDefs(defs: EntityDef[], edge: AlignEdge): number {
  const b = boundsOf(defs);
  if (!b || defs.length < 2) return 0;
  for (const d of defs) {
    if (edge === 'left') d.x = b.x0;
    else if (edge === 'right') d.x = b.x1;
    else if (edge === 'top') d.y = b.y0;
    else if (edge === 'bottom') d.y = b.y1;
    else if (edge === 'centerX') d.x = Math.round((b.x0 + b.x1) / 2);
    else d.y = Math.round((b.y0 + b.y1) / 2);
  }
  return defs.length;
}

/** Even spacing between the outermost two, along the longer axis of the
 *  selection — guessing the axis is nearly always right and saves a choice. */
export function distributeDefs(defs: EntityDef[]): number {
  if (defs.length < 3) return 0;
  const b = boundsOf(defs)!;
  const horizontal = b.x1 - b.x0 >= b.y1 - b.y0;
  const sorted = [...defs].sort((p, q) => (horizontal ? p.x - q.x : p.y - q.y));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = horizontal ? last.x - first.x : last.y - first.y;
  const step = span / (sorted.length - 1);
  sorted.forEach((d, i) => {
    if (horizontal) d.x = Math.round(first.x + step * i);
    else d.y = Math.round(first.y + step * i);
  });
  return sorted.length;
}

/** Should this keystroke be an EDITOR copy/paste, or the focused field's?
 *  Hijacking Ctrl+C in the Code window would be unforgivable. */
export function isEditorClipboardTarget(el: Element | null): boolean {
  if (!el) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return false;
  return !(el as HTMLElement).isContentEditable;
}
