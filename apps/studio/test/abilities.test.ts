import { describe, expect, it } from 'vitest';
import { EFFECT_HELP, EFFECT_LABEL, abilityList, createAbility, deleteAbility, fieldsFor, grantTo, presetFor } from '../src/abilities.js';
import { ABILITY_EFFECTS, defaultAbility, defaultProject, parseProject } from '../src/model.js';

describe('creating abilities without code', () => {
  it('mints one with a usable default and no id collisions', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Slash');
    const b = createAbility(p, 'Slash');
    expect(a.id).toBe('slash');
    expect(b.id).toBe('slash-2');
    expect(abilityList(p)).toHaveLength(2);
    expect(a.effect).toBe('melee');
    expect(a.cooldown).toBeGreaterThan(0);
  });

  it('describes every effect in plain language and labels it', () => {
    for (const e of ABILITY_EFFECTS) {
      const a = presetFor(e, defaultAbility('x'));
      expect(EFFECT_LABEL[e].length).toBeGreaterThan(3);
      expect(EFFECT_HELP[e](a).length).toBeGreaterThan(10);
    }
  });

  /** Switching what an ability does must not leave numbers from the last
   *  effect behind — "heal 130 hearts" is nobody's intent. */
  it('resets to sensible numbers when the effect changes', () => {
    const melee = presetFor('melee', defaultAbility('x'));
    expect(melee.radius).toBeGreaterThan(50);
    const heal = presetFor('heal', melee);
    expect(heal.power).toBe(1);
    expect(heal.cooldown).toBeGreaterThan(melee.cooldown);
  });

  it('only shows the number fields an effect actually uses', () => {
    expect(fieldsFor('melee')).toEqual({ power: 'Damage', radius: 'Reach' });
    expect(fieldsFor('heal').radius).toBeNull();
    expect(fieldsFor('spawn')).toEqual({ power: null, radius: null });
  });
});

describe('actors own abilities', () => {
  it('grants and revokes on a named actor', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Slash');
    const hero = p.scenes[0]!.entities[0]!.name;
    expect(grantTo(p, hero, a.id, true)).toBe(true);
    expect(p.scenes[0]!.entities[0]!.abilities).toEqual([a.id]);
    grantTo(p, hero, a.id, false);
    expect(p.scenes[0]!.entities[0]!.abilities).toEqual([]);
  });

  it('does not double-grant', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Slash');
    const hero = p.scenes[0]!.entities[0]!.name;
    grantTo(p, hero, a.id, true);
    grantTo(p, hero, a.id, true);
    expect(p.scenes[0]!.entities[0]!.abilities).toHaveLength(1);
  });

  it('reports an unknown actor rather than silently doing nothing', () => {
    expect(grantTo(defaultProject(), 'Ghost', 'x', true)).toBe(false);
  });

  /** Deleting an ability must not leave actors holding a button that does
   *  nothing — the failure a player would actually see. */
  it('takes a deleted ability off every actor', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Slash');
    const hero = p.scenes[0]!.entities[0]!.name;
    grantTo(p, hero, a.id, true);
    expect(deleteAbility(p, a.id)).toBe(1);
    expect(p.scenes[0]!.entities[0]!.abilities).toEqual([]);
    expect(abilityList(p)).toHaveLength(0);
  });
});

describe('saving and loading', () => {
  it('round-trips abilities and who holds them', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Fireball');
    Object.assign(a, { effect: 'ranged', power: 3, radius: 500, key: 'q', vfx: 'embers' });
    grantTo(p, p.scenes[0]!.entities[0]!.name, a.id, true);
    p.scenes[0]!.entities[0]!.skillTree = 'main';
    p.db!.skills = { main: { points: 1, branches: [] } };

    const out = parseProject(JSON.stringify(p));
    const back = out.db!.abilities![0]!;
    expect(back.effect).toBe('ranged');
    expect(back.power).toBe(3);
    expect(back.key).toBe('q');
    expect(out.scenes[0]!.entities[0]!.abilities).toEqual([a.id]);
    expect(out.scenes[0]!.entities[0]!.skillTree).toBe('main');
    expect(out.db!.skills!.main).toBeDefined();
  });

  it('repairs a half-written ability instead of dropping it', () => {
    const p = defaultProject();
    p.db = { items: [], abilities: [{ id: 'odd', effect: 'nonsense', power: 'x' }] as never };
    const a = parseProject(JSON.stringify(p)).db!.abilities![0]!;
    expect(a.effect).toBe('melee');
    expect(a.name).toBe('odd');
    expect(Number.isFinite(a.power)).toBe(true);
  });

  it('drops entries with no id', () => {
    const p = defaultProject();
    p.db = { items: [], abilities: [{ name: 'nameless' }, 'junk'] as never };
    expect(parseProject(JSON.stringify(p)).db?.abilities).toBeUndefined();
  });

  it('keeps an unused project free of an empty ability table', () => {
    const out = parseProject(JSON.stringify(defaultProject()));
    expect(out.db?.abilities).toBeUndefined();
    expect(out.db?.skills).toBeUndefined();
  });

  it('lowercases a key so it matches what the keyboard reports', () => {
    const p = defaultProject();
    const a = createAbility(p, 'Dash');
    a.key = 'Q';
    expect(parseProject(JSON.stringify(p)).db!.abilities![0]!.key).toBe('q');
  });
});
