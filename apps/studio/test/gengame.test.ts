import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, genGame, genName, validateGame } from '../src/gengame.js';
import type { Genre, Theme } from '../src/gengame.js';
import { seededRng } from '../src/gen.js';
import { parseProject } from '../src/model.js';

const GENRES: Genre[] = ['arcade', 'brawler', 'rpg', 'runner', 'cozy', 'survival'];
const THEMES: Theme[] = ['forest', 'dungeon', 'city', 'space', 'candy'];

describe('determinism', () => {
  it('gives the same game for the same seed', () => {
    const a = genGame({ seed: 7 });
    const b = genGame({ seed: 7 });
    // ids are minted per call, so compare everything else.
    const strip = (j: string): string => j.replace(/"id":"[^"]+"/g, '"id":"_"').replace(/"startScene":"[^"]+"/g, '"startScene":"_"');
    expect(strip(JSON.stringify(a))).toBe(strip(JSON.stringify(b)));
  });

  it('gives a different game for a different seed', () => {
    expect(genGame({ seed: 1 }).name).not.toBe(genGame({ seed: 99 }).name);
  });

  it('names games from the theme tables', () => {
    expect(genName('space', seededRng(3))).toMatch(/^\w+[\w-]* \w+$/);
  });
});

/** The generator's whole promise is "a complete, playable game". Every
 *  combination has to hold that up, not just the default one. */
describe('every combination produces a valid game', () => {
  for (const genre of GENRES) {
    for (const theme of THEMES) {
      it(`${genre} / ${theme}`, () => {
        const p = genGame({ seed: 5, genre, theme, levels: 3 });
        expect(validateGame(p)).toEqual([]);
      });
    }
  }

  it('holds for 1 through 5 levels at every difficulty', () => {
    for (let levels = 1; levels <= 5; levels++) {
      for (const difficulty of [1, 2, 3] as const) {
        expect(validateGame(genGame({ seed: levels * 10 + difficulty, levels, difficulty }))).toEqual([]);
      }
    }
  });

  it('holds with every mechanic off and every mechanic on', () => {
    const off = { combat: false, collect: false, shop: false, dialogue: false, boss: false, skills: false };
    const on = { combat: true, collect: true, shop: true, dialogue: true, boss: true, skills: true };
    expect(validateGame(genGame({ seed: 2, mechanics: off }))).toEqual([]);
    expect(validateGame(genGame({ seed: 2, mechanics: on }))).toEqual([]);
  });

  it('survives a save/load round trip with nothing dropped', () => {
    const p = genGame({ seed: 11, mechanics: { ...DEFAULT_PARAMS.mechanics, shop: true } });
    const out = parseProject(JSON.stringify(p));
    expect(out.scenes.map((s) => s.name)).toEqual(p.scenes.map((s) => s.name));
    expect(validateGame(out)).toEqual([]);
  });
});

describe('the shape of what comes out', () => {
  it('opens on a menu whose Start button reaches the first level', () => {
    const p = genGame({ seed: 4, levels: 2 });
    expect(p.scenes[0]!.name).toBe('Menu');
    const start = p.scenes[0]!.entities.find((e) => e.name === 'Start')!;
    const goto = start.events[0]!.actions[0]!;
    expect(goto.cmd).toBe('goto');
    expect(p.scenes.map((s) => s.name)).toContain(goto.text);
  });

  it('chains every level to the next and ends with a win', () => {
    const p = genGame({ seed: 6, levels: 4 });
    // levels 1..3 each carry a door; the last one can be won.
    for (let i = 1; i < p.scenes.length - 1; i++) {
      const doors = p.scenes[i]!.entities.flatMap((e) => e.events).flatMap((ev) => ev.actions).filter((a) => a.cmd === 'goto');
      expect(doors.length, `${p.scenes[i]!.name} needs a door`).toBeGreaterThan(0);
    }
    const lastEvents = [...(p.scenes.at(-1)!.events ?? []), ...p.scenes.at(-1)!.entities.flatMap((e) => e.events)];
    expect(lastEvents.some((ev) => ev.actions.some((a) => a.cmd === 'win'))).toBe(true);
  });

  it('keeps cozy games combat-free even when combat is asked for', () => {
    const p = genGame({ seed: 8, genre: 'cozy', mechanics: { ...DEFAULT_PARAMS.mechanics, combat: true, boss: true } });
    const mobs = p.scenes.flatMap((s) => s.entities).filter((e) => e.kind === 'mob' || e.kind === 'boss');
    expect(mobs).toEqual([]);
    // ...and it is still winnable, by reaching a goal instead of fighting.
    expect(validateGame(p)).toEqual([]);
  });

  it('scales the population with difficulty', () => {
    const count = (d: 1 | 2 | 3): number =>
      genGame({ seed: 3, difficulty: d, levels: 2 }).scenes.flatMap((s) => s.entities).filter((e) => e.kind === 'mob').length;
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('uses 2.5D for brawlers and runners, top-down otherwise', () => {
    expect(genGame({ seed: 1, genre: 'brawler' }).scenes[1]!.view).toBe('depth');
    expect(genGame({ seed: 1, genre: 'rpg' }).scenes[1]!.view).toBe('top');
  });

  it('only writes a shop database when a shop was asked for', () => {
    expect(genGame({ seed: 1, mechanics: { ...DEFAULT_PARAMS.mechanics, shop: false } }).db).toBeUndefined();
    const withShop = genGame({ seed: 1, mechanics: { ...DEFAULT_PARAMS.mechanics, shop: true } });
    expect(withShop.db!.items.length).toBeGreaterThan(0);
    expect(withShop.db!.items.every((i) => i.price > 0)).toBe(true);
  });

  it('never spawns anything on top of the player', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const p = genGame({ seed, levels: 3, difficulty: 3 });
      expect(validateGame(p).filter((x) => /on top of/.test(x))).toEqual([]);
    }
  });

  it('clamps a silly level count instead of trusting it', () => {
    expect(genGame({ seed: 1, levels: 99 }).scenes).toHaveLength(6); // menu + 5
    expect(genGame({ seed: 1, levels: -3 }).scenes).toHaveLength(2); // menu + 1
  });
});

describe('validation actually catches things', () => {
  it('flags a door to a level that does not exist', () => {
    const p = genGame({ seed: 1, levels: 2 });
    const exit = p.scenes[1]!.entities.find((e) => e.name === 'Exit')!;
    exit.events[0]!.actions[0]!.text = 'Nowhere';
    expect(validateGame(p).some((x) => /does not exist/.test(x))).toBe(true);
  });

  it('flags a level with no way out', () => {
    const p = genGame({ seed: 1, levels: 2 });
    for (const e of p.scenes[1]!.entities) e.events = [];
    delete p.scenes[1]!.events;
    expect(validateGame(p).some((x) => /no way to finish/.test(x))).toBe(true);
  });

  it('flags a game that can never be won', () => {
    const p = genGame({ seed: 1, levels: 1 });
    for (const s of p.scenes) {
      delete s.events;
      for (const e of s.entities) e.events = e.events.filter((ev) => !ev.actions.some((a) => a.cmd === 'win'));
    }
    expect(validateGame(p)).toContain('the game can never be won');
  });
});
