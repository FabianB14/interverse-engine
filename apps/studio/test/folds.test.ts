import { describe, expect, it } from 'vitest';
import {
  foldArrow, foldId, isFolded, loadFolds, pruneFolds, saveFolds, setFold, toggleFold,
} from '../src/folds.js';

describe('remembering what is folded', () => {
  /** Absent means open, so a fresh project shows everything — you cannot
   *  unfold something you never knew was there. */
  it('starts with everything open', () => {
    expect(loadFolds(null).size).toBe(0);
    expect(isFolded(new Set(), 'anything')).toBe(false);
  });

  it('round-trips', () => {
    const folded = new Set(['a', 'b']);
    expect(loadFolds(saveFolds(folded))).toEqual(folded);
  });

  it('reads a stored string as well as a parsed array', () => {
    expect(loadFolds('["x"]')).toEqual(new Set(['x']));
    expect(loadFolds(['x'])).toEqual(new Set(['x']));
  });

  /** A bad fold list must never cost anyone their panel. */
  it('survives junk', () => {
    expect(loadFolds('not json').size).toBe(0);
    expect(loadFolds(42).size).toBe(0);
    expect(loadFolds([1, null, 'ok', ''])).toEqual(new Set(['ok']));
  });

  it('only stores what is closed, however much is open', () => {
    expect(saveFolds(new Set())).toBe('[]');
  });
});

describe('folding and unfolding', () => {
  it('toggles', () => {
    const once = toggleFold(new Set(), 'a');
    expect(isFolded(once, 'a')).toBe(true);
    expect(isFolded(toggleFold(once, 'a'), 'a')).toBe(false);
  });

  /** Callers that only meant to read must not find their set changed. */
  it('never mutates what it was given', () => {
    const before = new Set(['a']);
    toggleFold(before, 'b');
    setFold(before, 'c', true);
    expect(before).toEqual(new Set(['a']));
  });

  it('sets a state directly, for "collapse all"', () => {
    expect(isFolded(setFold(new Set(), 'a', true), 'a')).toBe(true);
    expect(isFolded(setFold(new Set(['a']), 'a', false), 'a')).toBe(false);
  });

  it('points the twisty the way people expect', () => {
    expect(foldArrow(true)).toBe('▸');
    expect(foldArrow(false)).toBe('▾');
  });
});

describe('fold ids', () => {
  /** A level called "Enemies" must not share state with the Enemies group. */
  it('keeps different kinds of thing apart', () => {
    expect(foldId.level('Enemies')).not.toBe(foldId.palette('Enemies'));
    expect(foldId.tiles('x')).not.toBe(foldId.palette('x'));
  });
});

describe('forgetting deleted levels', () => {
  /** Otherwise every deleted level leaves a tombstone, and a new level that
   *  reused the id would come back folded. */
  it('drops levels that are gone', () => {
    const folded = new Set([foldId.level('a'), foldId.level('b'), foldId.palette('Props')]);
    expect(pruneFolds(folded, ['a'])).toEqual(new Set([foldId.level('a'), foldId.palette('Props')]));
  });

  it('leaves everything else alone', () => {
    const folded = new Set(['hier', foldId.palette('Props')]);
    expect(pruneFolds(folded, [])).toEqual(folded);
  });
});
