import { describe, expect, it } from 'vitest';
import { defaultProject, parseProject } from '../src/model.js';
import { TEMPLATES } from '../src/templates.js';

/** A variable-gated event survives a save/load round trip intact — the
 *  gate is what makes collect-N quests work with no code. */
describe('event variables', () => {
  it('keeps ifVar / ifVarAtLeast through parse', () => {
    const p = defaultProject();
    p.scenes[0]!.entities[0]!.events = [
      { trigger: 'touch', ifVar: 'chests', ifVarAtLeast: 2, actions: [{ cmd: 'goto', text: 'Boss Lair' }] },
    ];
    const out = parseProject(JSON.stringify(p));
    const ev = out.scenes[0]!.entities[0]!.events[0]!;
    expect(ev.ifVar).toBe('chests');
    expect(ev.ifVarAtLeast).toBe(2);
  });

  it('accepts the var / shop / inventory actions and drops unknown ones', () => {
    const p = defaultProject();
    p.scenes[0]!.entities[0]!.events = [
      {
        trigger: 'tap',
        actions: [
          { cmd: 'var', text: 'chests', n: 1 },
          { cmd: 'shop' },
          { cmd: 'inventory' },
          { cmd: 'teleport-to-mars' } as never,
        ],
      },
    ];
    const out = parseProject(JSON.stringify(p));
    const acts = out.scenes[0]!.entities[0]!.events[0]!.actions;
    expect(acts.map((a) => a.cmd)).toEqual(['var', 'shop', 'inventory']);
    expect(acts[0]!.n).toBe(1);
  });
});

describe("Hero's Errand template", () => {
  const quest = TEMPLATES.find((t) => t.id === 'quest')!.make();

  it('runs Menu → Village → Boss Lair', () => {
    expect(quest.scenes.map((s) => s.name)).toEqual(['Menu', 'Village', 'Boss Lair']);
  });

  it('sells database items with prices', () => {
    expect(quest.db!.items.length).toBeGreaterThan(0);
    expect(quest.db!.items.every((i) => i.price > 0)).toBe(true);
  });

  it('gates the exit on finding both chests', () => {
    const village = quest.scenes[1]!;
    const bumps = village.entities.flatMap((e) =>
      e.events.flatMap((ev) => ev.actions.filter((a) => a.cmd === 'var' && a.text === 'chests')),
    );
    expect(bumps).toHaveLength(2);
    const gate = village.entities
      .flatMap((e) => e.events)
      .find((ev) => ev.ifVar === 'chests');
    expect(gate?.ifVarAtLeast).toBe(2);
    expect(gate?.actions.some((a) => a.cmd === 'goto' && a.text === 'Boss Lair')).toBe(true);
  });

  it('survives a save/load round trip unchanged', () => {
    const once = parseProject(JSON.stringify(quest));
    expect(once.scenes).toEqual(quest.scenes);
    expect(once.db).toEqual(quest.db);
    // ...and loading again changes nothing, so save/load/save is stable.
    expect(parseProject(JSON.stringify(once))).toEqual(once);
  });
});
