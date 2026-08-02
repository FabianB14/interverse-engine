/**
 * 🖼 Assets — the art library, and a spritesheet slicer you can see.
 *
 * Import existed before this, behind one palette item, and it created a
 * one-off actor: no list of what you had imported, no way to reuse a
 * picture on a second actor, no way to delete one, and frame size was a
 * blind number field you guessed at until it stopped looking wrong.
 *
 * This adds the library and the visual slicer. Slicing maths lives in pure
 * functions so the grid overlay and the runtime cannot disagree about where
 * frame 7 is.
 */
import type { ProjectDef } from './model.js';

export interface AssetInfo {
  id: string;
  /** Bytes the data URL costs the project file. */
  bytes: number;
  /** How many actors reference it — 0 means it is dead weight. */
  users: number;
}

/** A data URL's real byte cost, which is what the <3MB budget cares about. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  if (comma < 0) return 0;
  const body = url.slice(comma + 1);
  if (!/;base64/i.test(url.slice(0, comma))) return decodeURIComponent(body).length;
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
}

/** Everything that points at an asset: an actor's assetId, or an '@id'
 *  reference inside a scene script (ability icons use that form). */
export function assetUsers(p: ProjectDef, id: string): string[] {
  const out: string[] = [];
  for (const s of p.scenes) {
    for (const e of s.entities) if (e.assetId === id) out.push(e.name);
    if (s.script.includes(`@${id}`)) out.push(`${s.name} (script)`);
  }
  return out;
}

export function assetList(p: ProjectDef): AssetInfo[] {
  return Object.entries(p.assets ?? {}).map(([id, url]) => ({
    id,
    bytes: dataUrlBytes(url),
    users: assetUsers(p, id).length,
  }));
}

/** Total bytes of imported art — a published game must stay small. */
export function assetBytes(p: ProjectDef): number {
  return assetList(p).reduce((n, a) => n + a.bytes, 0);
}

/** Assets nothing points at. */
export function unusedAssets(p: ProjectDef): string[] {
  return assetList(p).filter((a) => a.users === 0).map((a) => a.id);
}

/** Delete an asset and blank every reference, so no actor is left pointing
 *  at a picture that no longer exists. */
export function deleteAsset(p: ProjectDef, id: string): number {
  let cleared = 0;
  for (const s of p.scenes) {
    for (const e of s.entities) {
      if (e.assetId === id) {
        e.assetId = '';
        cleared++;
      }
    }
  }
  delete p.assets[id];
  return cleared;
}

/** Reuse: point an existing actor at an already-imported picture. */
export function assignAsset(p: ProjectDef, entityName: string, assetId: string): boolean {
  if (!p.assets[assetId]) return false;
  for (const s of p.scenes) {
    for (const e of s.entities) {
      if (e.name === entityName) {
        e.kind = 'image';
        e.assetId = assetId;
        return true;
      }
    }
  }
  return false;
}

/** Where frame `i` sits in a sheet. The overlay and the runtime both read
 *  this, so the grid you SEE is the grid that plays. */
export function frameRect(
  sheetW: number,
  sheetH: number,
  frameW: number,
  frameH: number,
  i: number,
): { x: number; y: number; w: number; h: number } | null {
  if (frameW <= 0 || frameH <= 0 || sheetW < frameW || sheetH < frameH) return null;
  const cols = Math.floor(sheetW / frameW);
  const rows = Math.floor(sheetH / frameH);
  if (i < 0 || i >= cols * rows) return null;
  return { x: (i % cols) * frameW, y: Math.floor(i / cols) * frameH, w: frameW, h: frameH };
}

export function frameCount(sheetW: number, sheetH: number, frameW: number, frameH: number): number {
  if (frameW <= 0 || frameH <= 0 || sheetW < frameW || sheetH < frameH) return 0;
  return Math.floor(sheetW / frameW) * Math.floor(sheetH / frameH);
}

/**
 * Guess a frame size so the import dialog opens on something sensible
 * instead of zeros. Sheets are overwhelmingly square frames in a strip or
 * a grid, so try the height as a square frame first, then common divisors.
 */
export function guessFrameSize(w: number, h: number): { frameW: number; frameH: number } {
  if (w <= 0 || h <= 0) return { frameW: 0, frameH: 0 };
  // A square that divides the width evenly is almost always right.
  if (h < w && w % h === 0) return { frameW: h, frameH: h };
  for (const n of [8, 6, 5, 4, 3, 2]) {
    if (w % n === 0 && w / n === h) return { frameW: w / n, frameH: h };
  }
  // A square sheet is genuinely ambiguous — 256x256 could be 2x2 or 16x16.
  // Prefer the LARGEST square giving a conventional 4+ columns, which is
  // the commonest layout and the easiest to correct by eye in the grid.
  for (const size of [128, 96, 64, 48, 32, 24, 16]) {
    if (w % size === 0 && h % size === 0 && w / size >= 4) return { frameW: size, frameH: size };
  }
  // Nothing divides cleanly — treat it as a single still image.
  return { frameW: 0, frameH: 0 };
}

/** Formats worth accepting today. GIF/SVG/3D get an honest refusal rather
 *  than importing something that will not animate or render. */
export function importRejectReason(fileName: string, mime: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) || /^image\/(png|jpeg|webp)$/.test(mime)) return null;
  if (ext === 'gif') return 'Animated GIFs are not supported yet — export the frames as a PNG spritesheet instead.';
  if (ext === 'svg') return 'SVG is not supported yet — export it as a PNG at the size you want.';
  if (['glb', 'gltf', 'fbx', 'obj', 'blend'].includes(ext)) {
    // Not a dead end any more — the ENGINE renders 3D now, Studio's canvas
    // is what doesn't. Say where the file actually goes.
    return 'Studio projects are 2D. The engine can use this — put the .glb in your game\'s public/models/ and load it with loadModel() from @interverse/three (see docs/three.md). For Studio, render it to a PNG spritesheet and import that.';
  }
  return 'Use a PNG, JPG or WebP image.';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Games ship the project JSON, so imported art is the thing most likely
 *  to blow the load budget. Warn before it is a problem. */
export const ASSET_BUDGET = 2 * 1024 * 1024;
