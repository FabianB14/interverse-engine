/**
 * ▾ What is folded away in the left panel.
 *
 * The panel grew a hierarchy, a palette of six groups and a paintbox, and
 * all of it was always open — so on a real project the level you are working
 * in scrolls off the bottom under a list of props you are not using. Every
 * heading and every level now folds.
 *
 * Only COLLAPSED things are stored. A fresh project therefore shows
 * everything (the right default — you cannot fold open what you never knew
 * was there), and the saved blob stays small no matter how many levels a
 * game grows.
 */

export const FOLDS_KEY = 'interverse.studio.folds';

/** Read the set back, surviving anything a hand-edited or corrupt value
 *  might contain — a bad fold list must never cost anyone their panel. */
export function loadFolds(raw: unknown): Set<string> {
  if (typeof raw === 'string') {
    try {
      return loadFolds(JSON.parse(raw));
    } catch {
      return new Set();
    }
  }
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((v): v is string => typeof v === 'string' && !!v));
}

export function saveFolds(folded: ReadonlySet<string>): string {
  return JSON.stringify([...folded]);
}

/** Absent means open. */
export function isFolded(folded: ReadonlySet<string>, id: string): boolean {
  return folded.has(id);
}

/** Returns a NEW set, so callers cannot mutate state they only meant to read. */
export function toggleFold(folded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(folded);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function setFold(folded: ReadonlySet<string>, id: string, closed: boolean): Set<string> {
  const next = new Set(folded);
  if (closed) next.add(id);
  else next.delete(id);
  return next;
}

/** The twisty. Kept here so every folding thing in the app uses the same one. */
export function foldArrow(closed: boolean): string {
  return closed ? '▸' : '▾';
}

/** Fold ids. Built through functions rather than written out at each call
 *  site, so a level's fold state cannot collide with a palette group that
 *  happens to share its name. */
export const foldId = {
  hierarchy: (): string => 'hier',
  level: (sceneId: string): string => `lvl:${sceneId}`,
  palette: (title: string): string => `pal:${title}`,
  tiles: (title: string): string => `tile:${title}`,
};

/**
 * Forget levels that no longer exist. Without this, every deleted level
 * leaves a tombstone behind and the list grows forever — and worse, a new
 * level that happened to reuse an id would come back folded.
 */
export function pruneFolds(folded: ReadonlySet<string>, liveSceneIds: readonly string[]): Set<string> {
  const live = new Set(liveSceneIds.map((id) => foldId.level(id)));
  return new Set([...folded].filter((f) => !f.startsWith('lvl:') || live.has(f)));
}
