import { describe, expect, it } from 'vitest';
import { defaultProject, parseProject } from '../src/model.js';
import { setLang, setLocaleTable, tr } from '../src/runtime.js';

describe('content database normalization', () => {
  it('repairs items and drops junk', () => {
    const p = defaultProject();
    (p as { db?: unknown }).db = {
      items: [
        { id: 'potion', name: 'Potion', effect: 'heal', n: 2, price: 5 },
        { id: '', name: 'no id' },
        'garbage',
        { id: 'gem' },
      ],
    };
    const out = parseProject(JSON.stringify(p));
    expect(out.db!.items.map((i) => i.id)).toEqual(['potion', 'gem']);
    const gem = out.db!.items[1]!;
    expect(gem.name).toBe('gem');
    expect(gem.emoji).toBe('🎁');
    expect(gem.effect).toBe('none');
    expect(gem.price).toBe(0);
  });

  it('always lands a db and locales object', () => {
    const out = parseProject(JSON.stringify(defaultProject()));
    expect(out.db).toEqual({ items: [] });
    expect(out.locales).toEqual({});
  });
});

describe('localization', () => {
  it('resolves @keys per language with en fallback', () => {
    setLocaleTable({ en: { greet: 'Hello' }, es: { greet: 'Hola' } });
    setLang('en');
    expect(tr('@greet')).toBe('Hello');
    setLang('es');
    expect(tr('@greet')).toBe('Hola');
    setLang('fr'); // no fr table -> en fallback
    expect(tr('@greet')).toBe('Hello');
    expect(tr('@missing')).toBe('missing'); // unknown key -> key itself
    expect(tr('plain text')).toBe('plain text'); // non-@ untouched
    setLang('en');
  });
});
