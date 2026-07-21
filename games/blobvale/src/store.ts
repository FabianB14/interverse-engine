import { createSave } from '@interverse/engine';

export const store = createSave('blobvale', 1);
export const NAME_KEY = 'name';

/** Kid-safe-ish: letters/digits/spaces only, trimmed, max 10. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 10);
}

export function savedName(): string | null {
  const n = store.get<string | null>(NAME_KEY, null);
  return n ? cleanName(n) || null : null;
}
