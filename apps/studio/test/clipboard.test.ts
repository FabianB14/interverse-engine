import { describe, expect, it } from 'vitest';
import {
  alignDefs,
  boundsOf,
  cloneForPaste,
  distributeDefs,
  isEditorClipboardTarget,
  isMarquee,
  toggleIn,
  uniqueName,
  withinMarquee,
} from '../src/clipboard.js';
import { defaultEntity, defaultScene } from '../src/model.js';
import type { EntityDef, SceneDef } from '../src/model.js';

const sceneWith = (...at: [number, number][]): SceneDef => {
  const s = defaultScene('Test');
  s.entities = at.map(([x, y], i) => {
    const d = defaultEntity('crate', x, y);
    d.name = `Crate${i ? ` ${i + 1}` : ''}`;
    return d;
  });
  return s;
};

describe('naming a copy', () => {
  it('keeps the name when it is free', () => {
    expect(uniqueName('Crate', new Set())).toBe('Crate');
  });

  it('counts up past what is taken', () => {
    expect(uniqueName('Crate', new Set(['Crate']))).toBe('Crate 2');
    expect(uniqueName('Crate', new Set(['Crate', 'Crate 2']))).toBe('Crate 3');
  });

  /** Copying a copy must not pile up counters: "Crate 2 2 2 2". */
  it('rolls the counter rather than stacking it', () => {
    expect(uniqueName('Crate 2', new Set(['Crate 2']))).toBe('Crate 3');
  });

  it('survives a name that is only digits', () => {
    expect(uniqueName('7', new Set(['7']))).toBe('7 2');
  });
});

describe('pasting', () => {
  it('gives every copy its own id and a free name', () => {
    const scene = sceneWith([100, 100], [200, 100]);
    const made = cloneForPaste(scene.entities, scene);
    const ids = new Set([...scene.entities, ...made].map((d) => d.id));
    expect(ids.size).toBe(4); // nothing shared — two copies are two actors
    const names = new Set([...scene.entities, ...made].map((d) => d.name));
    expect(names.size).toBe(4); // scripts refer to actors BY NAME
  });

  /** A shallow copy would let editing the paste change the original's
   *  events — the classic way "duplicate" quietly corrupts a level. */
  it('is a deep copy, not a shared reference', () => {
    const scene = sceneWith([100, 100]);
    scene.entities[0]!.events = [{ trigger: 'tap', actions: [{ cmd: 'coins', n: 1 }] }];
    const made = cloneForPaste(scene.entities, scene);
    made[0]!.events[0]!.actions[0]!.n = 99;
    expect(scene.entities[0]!.events[0]!.actions[0]!.n).toBe(1);
  });

  it('offsets so a paste-in-place is visible', () => {
    const scene = sceneWith([100, 100]);
    const [copy] = cloneForPaste(scene.entities, scene);
    expect(copy!.x).toBe(124);
    expect(copy!.y).toBe(124);
  });

  it('re-centres a group on a point, keeping its shape', () => {
    const scene = sceneWith([100, 100], [300, 100]);
    const made = cloneForPaste(scene.entities, scene, { at: { x: 400, y: 500 } });
    expect(made.map((d) => d.x)).toEqual([300, 500]); // centre 200 -> 400
    expect(made[1]!.x - made[0]!.x).toBe(200); // spacing preserved
    expect(made.every((d) => d.y === 500)).toBe(true);
  });

  it('clamps a paste back inside the level instead of losing it', () => {
    const scene = sceneWith([100, 100]);
    const [copy] = cloneForPaste(scene.entities, scene, { at: { x: 99_999, y: -99_999 } });
    expect(copy!.x).toBe(scene.worldW - 20);
    expect(copy!.y).toBe(20);
  });

  it('does nothing with nothing', () => {
    expect(cloneForPaste([], defaultScene('x'))).toEqual([]);
  });

  /** Paste into a DIFFERENT level is the main reason paste exists, and the
   *  target's own names are the ones that must not collide. */
  it('resolves names against the level being pasted INTO', () => {
    const from = sceneWith([100, 100]);
    const into = sceneWith([500, 500]);
    const [copy] = cloneForPaste(from.entities, into);
    expect(copy!.name).toBe('Crate 2');
  });
});

describe('the marquee', () => {
  const ents = sceneWith([100, 100], [300, 300], [700, 700]).entities;

  it('takes what is inside, whichever way you drag', () => {
    const forward = withinMarquee(ents, { x: 50, y: 50 }, { x: 400, y: 400 });
    const backward = withinMarquee(ents, { x: 400, y: 400 }, { x: 50, y: 50 });
    expect(forward).toHaveLength(2);
    expect(backward).toEqual(forward);
  });

  it('is a click, not a marquee, until the pointer travels', () => {
    expect(isMarquee({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
    expect(isMarquee({ x: 10, y: 10 }, { x: 30, y: 10 })).toBe(true);
  });
});

describe('adding and removing from a selection', () => {
  it('toggles', () => {
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('tidying up', () => {
  const defs = (): EntityDef[] => sceneWith([100, 100], [200, 160], [300, 220]).entities;

  it('lines up on each edge', () => {
    const d = defs();
    alignDefs(d, 'left');
    expect(d.map((e) => e.x)).toEqual([100, 100, 100]);
    const e = defs();
    alignDefs(e, 'bottom');
    expect(e.map((x) => x.y)).toEqual([220, 220, 220]);
  });

  it('refuses to align one actor to itself', () => {
    const one = [defaultEntity('crate', 10, 10)];
    expect(alignDefs(one, 'left')).toBe(0);
  });

  it('spaces three evenly without moving the outer two', () => {
    const d = sceneWith([100, 100], [110, 100], [400, 100]).entities;
    distributeDefs(d);
    expect(d.map((e) => e.x)).toEqual([100, 250, 400]);
  });

  it('picks the axis the selection is longest on', () => {
    const d = sceneWith([100, 100], [100, 110], [100, 400]).entities;
    distributeDefs(d);
    expect(d.map((e) => e.y)).toEqual([100, 250, 400]);
  });

  it('needs three to distribute', () => {
    expect(distributeDefs(sceneWith([0, 0], [10, 10]).entities)).toBe(0);
  });

  it('measures a group', () => {
    expect(boundsOf(defs())).toEqual({ x0: 100, y0: 100, x1: 300, y1: 220 });
    expect(boundsOf([])).toBeNull();
  });
});

describe('who owns Ctrl+C', () => {
  const el = (tag: string): Element => document.createElement(tag);

  it('leaves text fields alone', () => {
    expect(isEditorClipboardTarget(el('textarea'))).toBe(false);
    expect(isEditorClipboardTarget(el('input'))).toBe(false);
    expect(isEditorClipboardTarget(el('select'))).toBe(false);
  });

  it('takes it everywhere else', () => {
    expect(isEditorClipboardTarget(el('div'))).toBe(true);
    expect(isEditorClipboardTarget(null)).toBe(true);
  });
});
