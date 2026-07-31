import { describe, expect, it } from 'vitest';
import { API_CATEGORIES, API_DOCS, STARTER_SCRIPT, documentedRoots, searchApi } from '../src/apidocs.js';
import { explainError } from '../src/codepane.js';

/** The compile-time guard in apidocs.ts proves the catalogue covers every
 *  ScriptApi member. These assert the runtime half: names line up with the
 *  roots, snippets are real code, and search actually finds things. */
describe('api catalogue', () => {
  it('documents exactly the roots it claims to', () => {
    const roots = new Set(API_DOCS.map((e) => e.name.split('.')[1]!));
    expect([...roots].sort()).toEqual([...documentedRoots()].sort());
  });

  it('uses a known category for every entry', () => {
    for (const e of API_DOCS) expect(API_CATEGORIES).toContain(e.category);
  });

  it('has no duplicate names', () => {
    const names = API_DOCS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a signature, a blurb and a snippet', () => {
    for (const e of API_DOCS) {
      expect(e.name.startsWith('api.')).toBe(true);
      expect(e.signature.length).toBeGreaterThan(0);
      expect(e.blurb.length).toBeGreaterThan(10);
      expect(e.snippet).toContain('api.');
    }
  });

  /** A snippet that does not parse is worse than no snippet — it lands in
   *  the author's script and breaks the game on the next Apply. */
  it('emits snippets that are valid JavaScript', () => {
    for (const e of API_DOCS) {
      expect(() => new Function('api', e.snippet), `${e.name} snippet must parse`).not.toThrow();
    }
  });

  it('offers a starter script that parses and mentions api', () => {
    expect(() => new Function('api', STARTER_SCRIPT)).not.toThrow();
    expect(STARTER_SCRIPT).toContain('api.player');
  });
});

describe('catalogue search', () => {
  it('finds by exact name', () => {
    expect(searchApi('api.coins')[0]!.name).toBe('api.coins');
  });

  it('finds by fuzzy subsequence', () => {
    expect(searchApi('apcoin').map((e) => e.name)).toContain('api.coins');
  });

  it('falls back to the blurb when the name does not match', () => {
    // 'confetti' appears only in the vfx blurb/signature, not in any name.
    expect(searchApi('confetti').map((e) => e.name)).toContain('api.vfx');
  });

  it('ranks a name hit above a blurb hit', () => {
    const hits = searchApi('music').map((e) => e.name);
    expect(hits[0]).toBe('api.music');
  });

  it('returns everything for an empty query and nothing for nonsense', () => {
    expect(searchApi('').length).toBe(API_DOCS.length);
    expect(searchApi('zzzqqqxxx')).toEqual([]);
  });
});

describe('script error explanations', () => {
  it('names the missing word for a typo', () => {
    const { hint } = explainError(new ReferenceError('apu is not defined'));
    expect(hint).toContain('apu');
    expect(hint).toContain('api.');
  });

  it('points at actor names for a null read', () => {
    const { hint } = explainError(new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(hint).toMatch(/actor name/i);
  });

  it('always returns something actionable', () => {
    for (const err of [new Error('boom'), 'a string', 42, null]) {
      const { message, hint } = explainError(err);
      expect(message.length).toBeGreaterThan(0);
      expect(hint.length).toBeGreaterThan(0);
    }
  });
});
