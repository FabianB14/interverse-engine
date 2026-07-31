import { describe, expect, it } from 'vitest';
import {
  SLOT_COUNT, completeLevel, emptySlot, enterLevel, formatPlayed, isUnlocked, normalizeSlots,
  slotIndexKey, slotKey, suggestSlot, summarize, unlockedLevels, withSlot,
} from '../src/slots.js';

describe('where a slot lives', () => {
  /** A project saved before slots existed IS slot 1's run. Changing that key
   *  would silently delete everyone's game. */
  it('keeps the original key for slot 1', () => {
    expect(slotKey('my-game', 1)).toBe('studio-game-my-game');
  });

  it('gives the others their own', () => {
    expect(slotKey('my-game', 2)).toBe('studio-game-my-game-s2');
    expect(new Set([1, 2, 3].map((n) => slotKey('g', n))).size).toBe(3);
  });

  it('keeps the index away from the game data', () => {
    expect(slotIndexKey('g')).not.toBe(slotKey('g', 1));
  });
});

describe('reading the slot list', () => {
  it('always returns exactly the slots the screen shows', () => {
    expect(normalizeSlots(null)).toHaveLength(SLOT_COUNT);
    expect(normalizeSlots('nonsense')).toHaveLength(SLOT_COUNT);
    expect(normalizeSlots([]).every((s) => !s.used)).toBe(true);
  });

  it('numbers them 1..N in order whatever the file says', () => {
    const out = normalizeSlots([{ slot: 3, used: true }, { slot: 1, used: true }]);
    expect(out.map((s) => s.slot)).toEqual([1, 2, 3]);
    expect(out[1]!.used).toBe(false);
  });

  /** A save file is the one thing a player cannot re-create, so a damaged
   *  index has to degrade rather than take the title screen down. */
  it('survives junk inside the list', () => {
    const out = normalizeSlots([null, 7, { slot: 1, completed: ['a', 3, null], coins: 'x' }]);
    expect(out[0]!.completed).toEqual(['a']);
    expect(out[0]!.coins).toBe(0);
  });

  it('never lets the same level count twice', () => {
    expect(normalizeSlots([{ slot: 1, completed: ['a', 'a', 'b'] }])[0]!.completed).toEqual(['a', 'b']);
  });

  /** "Used" is derived, not trusted: progress in the file IS a run. */
  it('calls a slot used when it holds progress, flag or no flag', () => {
    expect(normalizeSlots([{ slot: 1, used: false, level: 'Village' }])[0]!.used).toBe(true);
    expect(normalizeSlots([{ slot: 1, used: false, completed: ['a'] }])[0]!.used).toBe(true);
    expect(normalizeSlots([{ slot: 1, used: false }])[0]!.used).toBe(false);
  });
});

describe('recording progress', () => {
  it('remembers where you are, so continue means continue', () => {
    const s = enterLevel(emptySlot(1), 'Village', 100);
    expect(s.level).toBe('Village');
    expect(s.used).toBe(true);
    expect(s.updated).toBe(100);
  });

  it('ignores a move to nowhere', () => {
    expect(enterLevel(emptySlot(1), '', 100).used).toBe(false);
  });

  it('counts a finished level once', () => {
    let s = completeLevel(emptySlot(1), 'Village', 1);
    s = completeLevel(s, 'Village', 2);
    expect(s.completed).toEqual(['Village']);
    expect(s.updated).toBe(2); // still a fresh save, just not new progress
  });
});

describe('what you may replay', () => {
  const all = ['Menu', 'Village', 'Cave', 'Boss'];

  it('opens the first level to a brand new game', () => {
    expect(unlockedLevels(emptySlot(1), all)).toEqual(['Menu']);
  });

  it('opens the next one along as you finish them', () => {
    let s = completeLevel(emptySlot(1), 'Menu', 1);
    expect(unlockedLevels(s, all)).toEqual(['Menu', 'Village']);
    s = completeLevel(s, 'Village', 2);
    expect(unlockedLevels(s, all)).toEqual(['Menu', 'Village', 'Cave']);
  });

  /** The first level of a real game is usually a menu, and nobody ever
   *  "finishes" a menu — so where you are standing counts too, or the whole
   *  game sits locked behind its own title screen. */
  it('opens where you are standing, finished or not', () => {
    const s = enterLevel(emptySlot(1), 'Village', 1);
    expect(unlockedLevels(s, all)).toContain('Village');
  });

  /** Derived from the completed set, so finishing the last level opens
   *  everything and nothing is left dangling. */
  it('opens all of it once it is all done', () => {
    const s = all.reduce((acc, n) => completeLevel(acc, n, 1), emptySlot(1));
    expect(unlockedLevels(s, all)).toEqual(all);
  });

  /** What it must still refuse: a level you never reached, never finished,
   *  and whose predecessor you never finished. */
  it('keeps the middle of the game shut', () => {
    const s = completeLevel(emptySlot(1), 'Cave', 1);
    expect(isUnlocked(s, all, 'Village')).toBe(false);
  });

  it('never unlocks a level that is not in the game', () => {
    expect(isUnlocked(emptySlot(1), all, 'Ghost')).toBe(false);
  });
});

describe('describing a slot on screen', () => {
  it('says empty when it is', () => {
    expect(summarize(emptySlot(2))).toBe('Empty');
  });

  it('leads with where you were', () => {
    const s = { ...emptySlot(1), used: true, level: 'Village', coins: 12, playedSecs: 250, completed: ['Menu'] };
    expect(summarize(s)).toBe('Village · 1 done · 12 🪙 · 4m');
  });

  it('leaves out what there is nothing to say about', () => {
    expect(summarize({ ...emptySlot(1), used: true, level: 'Cave' })).toBe('Cave · 0s');
  });

  it('reads a time a player would recognise', () => {
    expect(formatPlayed(45)).toBe('45s');
    expect(formatPlayed(60)).toBe('1m');
    expect(formatPlayed(3600 + 20 * 60)).toBe('1h 20m');
    expect(formatPlayed(-5)).toBe('0s');
  });
});

describe('picking a slot for the player', () => {
  it('offers the first empty one to a new player', () => {
    expect(suggestSlot(normalizeSlots([]))).toBe(1);
  });

  it('offers the most recent run to a returning one', () => {
    const slots = normalizeSlots([
      { slot: 1, used: true, updated: 10 },
      { slot: 3, used: true, updated: 99 },
    ]);
    expect(suggestSlot(slots)).toBe(3);
  });
});

describe('writing one slot back', () => {
  it('leaves the others exactly as they were', () => {
    const before = normalizeSlots([{ slot: 2, used: true, level: 'Cave' }]);
    const after = withSlot(before, enterLevel(emptySlot(1), 'Village', 5));
    expect(after[1]).toEqual(before[1]);
    expect(after[0]!.level).toBe('Village');
  });
});
