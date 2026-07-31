import { describe, expect, it } from 'vitest';
import { TOOLBAR_GROUPS, TOOLBAR_ITEMS, evictionOrder } from '../src/toolbar.js';

describe('what leaves the toolbar first', () => {
  it('gives up the least important thing first', () => {
    const out = evictionOrder([
      { id: 'keep', evict: 1 },
      { id: 'go', evict: 9 },
      { id: 'middle', evict: 5 },
    ]);
    expect(out.map((o) => o.id)).toEqual(['go', 'middle', 'keep']);
  });

  /** Equally important controls should empty from the right, so the bar
   *  shortens rather than growing gaps in the middle. */
  it('breaks ties from the right', () => {
    const out = evictionOrder([
      { id: 'left', evict: 5 },
      { id: 'right', evict: 5 },
    ]);
    expect(out.map((o) => o.id)).toEqual(['right', 'left']);
  });

  it('does not lose or invent items', () => {
    expect(evictionOrder(TOOLBAR_ITEMS).map((i) => i.id).sort()).toEqual(
      TOOLBAR_ITEMS.map((i) => i.id).sort(),
    );
  });
});

describe('the collapse table', () => {
  it('never lists the same control twice', () => {
    const ids = TOOLBAR_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every control under a real group', () => {
    const groups = new Set(TOOLBAR_GROUPS.map((g) => g.id));
    for (const it of TOOLBAR_ITEMS) expect(groups.has(it.group)).toBe(true);
  });

  /** ▶ Play, the level picker and undo must never be collapsible — losing
   *  Play behind a menu is the bug this whole file exists to fix. */
  it('leaves the controls you build with pinned to the bar', () => {
    const collapsible = new Set(TOOLBAR_ITEMS.map((i) => i.id));
    for (const id of ['btn-play', 'btn-undo', 'btn-redo', 'scene-select', 'btn-add-scene', 'btn-new', 'project-name']) {
      expect(collapsible.has(id)).toBe(false);
    }
  });

  it('keeps what you touch while building for last', () => {
    const order = evictionOrder(TOOLBAR_ITEMS).map((i) => i.id);
    expect(order.indexOf('btn-import')).toBeLessThan(order.indexOf('btn-tiles'));
    expect(order.indexOf('btn-install')).toBeLessThan(order.indexOf('view-select'));
  });
});
