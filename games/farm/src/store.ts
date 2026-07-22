import { createSave } from '@interverse/engine';

/** Local farm save (plots, weather clock, stats). Verium is the shared wallet. */
export const store = createSave('farm', 1);

export const NAME_KEY = 'name';
export const ACC_KEY = 'acc';

/** Kid-safe-ish: letters/digits/spaces only, trimmed, max 12. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 12);
}

export function savedName(): string | null {
  const n = store.get<string | null>(NAME_KEY, null);
  return n ? cleanName(n) || null : null;
}

/** The accessory id worn on the avatar's head ('none' if unset). */
export function savedAcc(): string {
  return store.get<string>(ACC_KEY, 'none');
}

export const SKIN_KEY = 'skinColor';

/** The person avatar's skin tone. */
export function savedSkin(): number {
  return store.get<number>(SKIN_KEY, 0xf0c08a);
}
