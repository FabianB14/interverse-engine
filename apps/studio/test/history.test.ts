import { describe, expect, it } from 'vitest';
import { History, isEditorUndoTarget } from '../src/history.js';

/** A clock we control — otherwise coalescing tests are timing races. */
function at(t: { now: number }) {
  return new History({ coalesceMs: 500, now: () => t.now });
}

describe('undo and redo', () => {
  it('steps back and forward through states', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 1000;
    h.record('b', 'edit 1');
    t.now = 2000;
    h.record('c', 'edit 2');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull(); // at the beginning
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull();
  });

  it('knows what it can do', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    expect(h.canUndo()).toBe(false);
    t.now = 1000;
    h.record('b', 'move');
    expect(h.canUndo()).toBe(true);
    expect(h.undoLabel()).toBe('move');
    h.undo();
    expect(h.canRedo()).toBe(true);
    expect(h.redoLabel()).toBe('move');
  });

  /** The reason a snapshot approach needs coalescing at all: a drag fires a
   *  change every pointermove, and undo must step back the DRAG. */
  it('folds a run of same-label edits into one step', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 100;
    expect(h.record('b', 'move')).toBe(true); // new step
    t.now = 200;
    expect(h.record('c', 'move')).toBe(false); // folded
    t.now = 300;
    expect(h.record('d', 'move')).toBe(false);
    expect(h.depth().past).toBe(2);
    expect(h.undo()).toBe('a'); // one undo takes back the whole drag
  });

  /** Clicking "add" twice is two things you did — one undo should take back
   *  one of them, not both. Only streaming edits collapse. */
  it('does NOT fold discrete actions', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 10;
    expect(h.record('b', 'add actor')).toBe(true);
    t.now = 20;
    expect(h.record('c', 'add actor')).toBe(true);
    expect(h.depth().past).toBe(3);
    expect(h.undo()).toBe('b'); // one add at a time
  });

  it('starts a new step once the window passes', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 100;
    h.record('b', 'move');
    t.now = 5000; // long pause = a separate action
    expect(h.record('c', 'move')).toBe(true);
    expect(h.depth().past).toBe(3);
  });

  it('does not fold two DIFFERENT kinds of edit', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 10;
    h.record('b', 'move');
    t.now = 20;
    expect(h.record('c', 'rename')).toBe(true);
  });

  it('ignores a change that changed nothing', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 1000;
    expect(h.record('a', 'edit')).toBe(false);
    expect(h.depth().past).toBe(1);
  });

  it('drops the redo branch once you edit after undoing', () => {
    const t = { now: 0 };
    const h = at(t);
    h.reset('a');
    t.now = 1000;
    h.record('b', 'one');
    h.undo();
    expect(h.canRedo()).toBe(true);
    t.now = 2000;
    h.record('c', 'two');
    expect(h.canRedo()).toBe(false);
  });

  /** Restoring a snapshot triggers the editor's change hook; without this
   *  guard, undo would immediately record itself and you could never leave. */
  it('ignores changes made while applying an undo', () => {
    const h = new History();
    h.reset('a');
    h.record('b', 'edit');
    h.apply(() => {
      expect(h.record('anything', 'edit')).toBe(false);
    });
    expect(h.depth().past).toBe(2);
    expect(h.isApplying).toBe(false);
  });
});

describe('memory limits', () => {
  it('caps the number of entries', () => {
    const t = { now: 0 };
    const h = new History({ maxEntries: 5, coalesceMs: 0, now: () => t.now });
    h.reset('0');
    for (let i = 1; i <= 20; i++) {
      t.now = i * 1000;
      h.record(`s${i}`, `edit ${i}`);
    }
    expect(h.depth().past).toBe(5);
    // The recent past is what survived.
    expect(h.undo()).toBe('s19');
  });

  it('caps total bytes, since imported art lives in the project', () => {
    const t = { now: 0 };
    const big = 'x'.repeat(1000);
    const h = new History({ maxBytes: 3000, coalesceMs: 0, now: () => t.now });
    h.reset(big + '0');
    for (let i = 1; i <= 10; i++) {
      t.now = i * 1000;
      h.record(big + i, `edit ${i}`);
    }
    expect(h.depth().past).toBeLessThanOrEqual(3);
    // Even over budget it keeps enough to undo once.
    expect(h.canUndo()).toBe(true);
  });
});

/** Ctrl+Z inside the Code window has to reach the textarea, not the editor. */
describe('who owns Ctrl+Z', () => {
  const el = (tag: string, type?: string): Element => {
    const n = document.createElement(tag);
    if (type) (n as HTMLInputElement).type = type;
    return n;
  };

  it('leaves text fields alone', () => {
    expect(isEditorUndoTarget(el('textarea'))).toBe(false);
    expect(isEditorUndoTarget(el('input', 'text'))).toBe(false);
    expect(isEditorUndoTarget(el('input', 'number'))).toBe(false);
  });

  it('takes it everywhere else', () => {
    expect(isEditorUndoTarget(null)).toBe(true);
    expect(isEditorUndoTarget(el('div'))).toBe(true);
    expect(isEditorUndoTarget(el('canvas'))).toBe(true);
    expect(isEditorUndoTarget(el('input', 'checkbox'))).toBe(true);
    expect(isEditorUndoTarget(el('input', 'range'))).toBe(true);
  });
});
