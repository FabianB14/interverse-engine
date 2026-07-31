import { describe, expect, it } from 'vitest';
import { keyConflicts, keyLabel } from '../src/controls.js';
import { BUILTIN_ACTIONS, defaultControls, defaultProject, normalizeControls, parseProject } from '../src/model.js';

/** The movement keys were literals inside the update loop for twenty-odd
 *  phases. Now they are data, so this snapshot is the thing standing
 *  between a typo and every game's arrow keys silently changing. */
describe('default bindings', () => {
  it('matches the keys the engine has always used', () => {
    const byId = Object.fromEntries(defaultControls().actions.map((a) => [a.id, a.keys]));
    expect(byId).toEqual({
      'move-left': ['arrowleft', 'a'],
      'move-right': ['arrowright', 'd'],
      'move-up': ['arrowup', 'w'],
      'move-down': ['arrowdown', 's'],
      jump: [' '],
      interact: ['e', 'enter'],
    });
  });

  it('marks every builtin as builtin, and nothing else', () => {
    for (const a of defaultControls().actions) expect(a.builtin).toBe(true);
    expect(defaultControls().actions.map((a) => a.id)).toEqual([...BUILTIN_ACTIONS]);
  });
});

describe('control table repair', () => {
  it('keeps every builtin even when the stored table is missing them', () => {
    const out = normalizeControls({ actions: [{ id: 'move-left', keys: ['j'] }] });
    expect(out.actions.map((a) => a.id)).toEqual([...BUILTIN_ACTIONS]);
    expect(out.actions.find((a) => a.id === 'move-left')!.keys).toEqual(['j']);
    // untouched builtins keep their defaults
    expect(out.actions.find((a) => a.id === 'move-right')!.keys).toEqual(['arrowright', 'd']);
  });

  it('keeps custom actions after the builtins and marks them non-builtin', () => {
    const out = normalizeControls({ actions: [{ id: 'Dash', keys: ['Q'], button: true }] });
    const dash = out.actions.at(-1)!;
    expect(dash.id).toBe('Dash');
    expect(dash.builtin).toBe(false);
    expect(dash.keys).toEqual(['q']); // lowercased to match e.key
  });

  it('drops junk without losing the table', () => {
    const out = normalizeControls({ actions: ['nope', null, { keys: ['x'] }, 42] });
    expect(out.actions.map((a) => a.id)).toEqual([...BUILTIN_ACTIONS]);
  });

  it('accepts a totally absent table', () => {
    expect(normalizeControls(undefined).actions).toHaveLength(BUILTIN_ACTIONS.length);
    expect(normalizeControls(null).touch).toBe('joystick');
  });

  it('survives a project round trip', () => {
    const p = defaultProject();
    p.controls = defaultControls();
    p.controls.actions[0]!.keys = ['j'];
    p.controls.touch = 'dpad';
    const out = parseProject(JSON.stringify(p));
    expect(out.controls!.actions[0]!.keys).toEqual(['j']);
    expect(out.controls!.touch).toBe('dpad');
  });

  it('gives every project a control table on load, so movement always binds', () => {
    expect(parseProject(JSON.stringify(defaultProject())).controls).toBeDefined();
  });
});

describe('conflicts', () => {
  it('reports a key claimed by two actions', () => {
    const c = defaultControls();
    c.actions.find((a) => a.id === 'interact')!.keys = ['a'];
    expect([...keyConflicts(c).keys()]).toEqual(['a']);
    expect(keyConflicts(c).get('a')).toEqual(['move-left', 'interact']);
  });

  it('is silent when every key has one owner', () => {
    expect(keyConflicts(defaultControls()).size).toBe(0);
  });
});

describe('key labels', () => {
  it('renders keys the way a player would name them', () => {
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('arrowleft')).toBe('←');
    expect(keyLabel('q')).toBe('Q');
    expect(keyLabel('enter')).toBe('Enter');
  });
});
