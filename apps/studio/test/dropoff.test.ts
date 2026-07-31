import { describe, expect, it } from 'vitest';
import { applyDrop, dropEntries, rankDrops, targetOf } from '../src/dropoff.js';
import { EVENT_CMDS, defaultProject, parseProject } from '../src/model.js';

const proj = () => defaultProject();
const entNode = (p: ReturnType<typeof proj>): string => `ent:${p.scenes[0]!.entities[0]!.id}`;
const lvlNode = (p: ReturnType<typeof proj>): string => `lvl:${p.scenes[0]!.id}`;

describe('what a drag can create', () => {
  it('offers every command, trigger, a new level and the actor kinds', () => {
    const ids = dropEntries('entity').map((e) => e.id);
    for (const cmd of EVENT_CMDS) expect(ids).toContain(`act:${cmd}`);
    expect(ids).toContain('trig:tap');
    expect(ids).toContain('lvl:new');
    expect(ids).toContain('ent:mob');
    // Images need a file first, so they are not offered from a drag.
    expect(ids).not.toContain('ent:image');
  });

  it('respects scope — no "remove this" from a level, no "cleared" on an actor', () => {
    expect(dropEntries('level').map((e) => e.id)).not.toContain('act:remove');
    expect(dropEntries('entity').map((e) => e.id)).not.toContain('trig:cleared');
    expect(dropEntries('level').map((e) => e.id)).toContain('trig:cleared');
  });
});

describe('search ranking', () => {
  const entries = dropEntries('entity');

  it('puts a literal match first', () => {
    expect(rankDrops(entries, 'coin')[0]!.id).toBe('act:coins');
  });

  it('matches on keywords, not just labels', () => {
    expect(rankDrops(entries, 'money').map((e) => e.id)).toContain('act:coins');
  });

  it('returns everything for an empty query and nothing for nonsense', () => {
    expect(rankDrops(entries, '')).toHaveLength(entries.length);
    expect(rankDrops(entries, 'qqzzxx')).toEqual([]);
  });
});

describe('applying a pick', () => {
  it('appends an action to the actor, inventing an event when there is none', () => {
    const p = proj();
    expect(p.scenes[0]!.entities[0]!.events).toHaveLength(0);
    const res = applyDrop(p, entNode(p), 'act:coins', { x: 0, y: 0 });
    expect(res).toEqual({ kind: 'action', name: 'coins' });
    const ev = p.scenes[0]!.entities[0]!.events[0]!;
    expect(ev.trigger).toBe('touch');
    expect(ev.actions[0]).toEqual({ cmd: 'coins', n: 1 });
  });

  it('gives a level a start event rather than a touch one', () => {
    const p = proj();
    applyDrop(p, lvlNode(p), 'act:music', { x: 0, y: 0 });
    expect(p.scenes[0]!.events![0]!.trigger).toBe('start');
    expect(p.scenes[0]!.events![0]!.actions[0]!.text).toBe('adventure');
  });

  it('adds a whole new event when a trigger is picked', () => {
    const p = proj();
    applyDrop(p, entNode(p), 'trig:tap', { x: 0, y: 0 });
    expect(p.scenes[0]!.entities[0]!.events.map((e) => e.trigger)).toEqual(['tap']);
  });

  it('creates a level AND the door that reaches it', () => {
    const p = proj();
    const res = applyDrop(p, entNode(p), 'lvl:new', { x: 0, y: 0 });
    expect(p.scenes).toHaveLength(2);
    const goto = p.scenes[0]!.entities[0]!.events[0]!.actions[0]!;
    expect(goto.cmd).toBe('goto');
    expect(goto.text).toBe(res!.name);
    expect(p.scenes[1]!.name).toBe(res!.name);
  });

  it('places a new actor at the drop point, inside the world', () => {
    const p = proj();
    applyDrop(p, entNode(p), 'ent:mob', { x: 5000, y: -200 });
    const mob = p.scenes[0]!.entities.at(-1)!;
    expect(mob.kind).toBe('mob');
    expect(mob.x).toBeLessThanOrEqual(p.scenes[0]!.worldW);
    expect(mob.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps new actors below the horizon in a 2.5D level', () => {
    const p = proj();
    p.scenes[0]!.view = 'depth';
    p.scenes[0]!.worldH = 720;
    applyDrop(p, entNode(p), 'ent:crate', { x: 300, y: 10 });
    expect(p.scenes[0]!.entities.at(-1)!.y).toBeGreaterThanOrEqual(380);
  });

  it('never collides names', () => {
    const p = proj();
    applyDrop(p, entNode(p), 'ent:mob', { x: 100, y: 100 });
    applyDrop(p, entNode(p), 'ent:mob', { x: 200, y: 200 });
    const names = p.scenes[0]!.entities.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('refuses an unknown node or entry rather than throwing', () => {
    const p = proj();
    expect(applyDrop(p, 'ent:nope', 'act:coins', { x: 0, y: 0 })).toBeNull();
    expect(applyDrop(p, entNode(p), 'wat:thing', { x: 0, y: 0 })).toBeNull();
  });

  /** Anything the palette can write, the loader has to accept — otherwise
   *  a drag produces something that vanishes on the next save/load. */
  it('produces only things that survive parseProject', () => {
    const p = proj();
    for (const entry of dropEntries('entity')) applyDrop(p, entNode(p), entry.id, { x: 200, y: 300 });
    const before = p.scenes[0]!.entities[0]!.events.flatMap((e) => e.actions).length;
    const out = parseProject(JSON.stringify(p));
    expect(out.scenes[0]!.entities[0]!.events.flatMap((e) => e.actions)).toHaveLength(before);
  });
});

describe('node lookup', () => {
  it('finds levels and actors, and reports their scope', () => {
    const p = proj();
    expect(targetOf(p, lvlNode(p))!.scope).toBe('level');
    expect(targetOf(p, entNode(p))!.scope).toBe('entity');
    expect(targetOf(p, 'ent:missing')).toBeNull();
  });
});
