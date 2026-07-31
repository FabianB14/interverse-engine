import { describe, expect, it } from 'vitest';
import { CMD_SPECS, TRIGGER_SPECS, actionLabel, cmdsFor, freshSwitchName, knownSwitches, knownVars, triggersFor } from '../src/cmds.js';
import { ENTITY_TRIGGERS, EVENT_CMDS, LEVEL_TRIGGERS, defaultProject, normalizeEvents, parseProject } from '../src/model.js';

/** model.ts owns the allow-lists, cmds.ts owns the UI metadata. They are
 *  bound by this test rather than by an import, so the parse layer stays
 *  free of UI concerns. */
describe('command table parity', () => {
  it('covers every runnable command, and invents none', () => {
    expect([...CMD_SPECS.map((s) => s.cmd)].sort()).toEqual([...EVENT_CMDS].sort());
  });

  it('covers every trigger in both scopes', () => {
    expect([...triggersFor('entity').map((t) => t.trigger)].sort()).toEqual([...ENTITY_TRIGGERS].sort());
    expect([...triggersFor('level').map((t) => t.trigger)].sort()).toEqual([...LEVEL_TRIGGERS].sort());
  });

  it('keeps "remove this" off levels — there is no body to remove', () => {
    expect(cmdsFor('entity').map((c) => c.cmd)).toContain('remove');
    expect(cmdsFor('level').map((c) => c.cmd)).not.toContain('remove');
  });

  it('labels every action without falling through to the raw cmd', () => {
    for (const spec of CMD_SPECS) {
      const label = actionLabel({ cmd: spec.cmd, text: 'x', n: 2 });
      expect(label.length).toBeGreaterThan(0);
      if (spec.params !== 'none') expect(label).not.toBe(spec.cmd);
    }
  });

  it('gives every trigger an icon', () => {
    for (const t of TRIGGER_SPECS) expect(t.emoji).toBeTruthy();
  });
});

describe('level events', () => {
  it('round-trips through parse with its gates intact', () => {
    const p = defaultProject();
    p.scenes[0]!.events = [
      { trigger: 'cleared', ifVar: 'waves', ifVarAtLeast: 3, once: true, actions: [{ cmd: 'win', text: 'CLEARED!' }] },
    ];
    const ev = parseProject(JSON.stringify(p)).scenes[0]!.events![0]!;
    expect(ev.trigger).toBe('cleared');
    expect(ev.ifVar).toBe('waves');
    expect(ev.ifVarAtLeast).toBe(3);
    expect(ev.once).toBe(true);
  });

  it('drops triggers that make no sense on a level, keeping the rest', () => {
    const kept = normalizeEvents(
      [
        { trigger: 'touch', actions: [] }, // needs a body to touch
        { trigger: 'start', actions: [] },
        { trigger: 'cleared', actions: [] },
      ],
      'level',
    );
    expect(kept.map((e) => e.trigger)).toEqual(['start', 'cleared']);
  });

  it("drops 'cleared' from actors — it is a level-wide fact", () => {
    const kept = normalizeEvents([{ trigger: 'cleared', actions: [] }, { trigger: 'tap', actions: [] }], 'entity');
    expect(kept.map((e) => e.trigger)).toEqual(['tap']);
  });

  it("filters 'remove this' out of level events but leaves it on actors", () => {
    const lvl = normalizeEvents([{ trigger: 'start', actions: [{ cmd: 'remove' }, { cmd: 'coins', n: 1 }] }], 'level');
    expect(lvl[0]!.actions.map((a) => a.cmd)).toEqual(['coins']);
    const ent = normalizeEvents([{ trigger: 'tap', actions: [{ cmd: 'remove' }] }], 'entity');
    expect(ent[0]!.actions.map((a) => a.cmd)).toEqual(['remove']);
  });

  it('clamps a runaway timer so "every 0 seconds" cannot lock the frame', () => {
    const kept = normalizeEvents([{ trigger: 'every', every: 0, actions: [] }], 'level');
    expect(kept[0]!.every).toBe(0.1);
  });

  it('keeps an untouched level free of an events key entirely', () => {
    const out = parseProject(JSON.stringify(defaultProject()));
    expect('events' in out.scenes[0]!).toBe(false);
    const emptied = defaultProject();
    emptied.scenes[0]!.events = [];
    expect('events' in parseProject(JSON.stringify(emptied)).scenes[0]!).toBe(false);
  });
});

describe('project-wide name scans', () => {
  it('finds switches and variables from both actors and levels', () => {
    const p = defaultProject();
    p.scenes[0]!.events = [{ trigger: 'start', actions: [{ cmd: 'switchOn', text: 'dawn' }] }];
    p.scenes[0]!.entities[0]!.events = [
      { trigger: 'tap', ifSwitch: 'dusk', actions: [{ cmd: 'var', text: 'chests', n: 1 }] },
    ];
    expect(knownSwitches(p)).toEqual(['dawn', 'dusk']);
    expect(knownVars(p)).toEqual(['chests']);
  });

  it('invents a link name that is not already taken', () => {
    const p = defaultProject();
    p.scenes[0]!.events = [{ trigger: 'start', actions: [{ cmd: 'switchOn', text: 'link-1' }] }];
    expect(freshSwitchName(p)).toBe('link-2');
  });
});
