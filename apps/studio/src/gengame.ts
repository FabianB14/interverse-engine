/**
 * 🎲 The procedural game maker — parameters in, a whole playable game out.
 *
 * gen.ts generates terrain. This generates a GAME: levels, actors, ⚡ event
 * wiring, database items, palette, music, a title menu and a win condition,
 * emitted as an ordinary ProjectDef. That last part is the point — what
 * comes out is a normal editable project, not a locked black box, so
 * "generate" is a starting point rather than a dead end.
 *
 * Everything is seeded, so the same parameters always produce the same
 * game. That is what makes it testable, and what lets someone share a seed.
 */
import { colsFor, rowsFor } from './tiles.js';
import { dungeonRows, islandRows, mazeRows, seededRng } from './gen.js';
import type { Rng } from './gen.js';
import { defaultEntity, freshId } from './model.js';
import type { EntityDef, EntityKind, EventDef, ItemDef, ProjectDef, SceneDef } from './model.js';

export type Genre = 'arcade' | 'brawler' | 'rpg' | 'runner' | 'cozy' | 'survival';
export type Theme = 'forest' | 'dungeon' | 'city' | 'space' | 'candy';

export interface GenParams {
  seed: number;
  genre: Genre;
  theme: Theme;
  /** 1–5. More levels = a longer game, not a bigger one. */
  levels: number;
  /** 1 gentle · 2 normal · 3 tough — drives mob count, HP and damage. */
  difficulty: 1 | 2 | 3;
  mechanics: {
    combat: boolean;
    collect: boolean;
    shop: boolean;
    dialogue: boolean;
    boss: boolean;
    skills: boolean;
  };
}

export const DEFAULT_PARAMS: GenParams = {
  seed: 1,
  genre: 'arcade',
  theme: 'forest',
  levels: 3,
  difficulty: 2,
  mechanics: { combat: true, collect: true, shop: false, dialogue: true, boss: true, skills: false },
};

interface ThemeSpec {
  bg: number;
  /** Terrain generator that suits the theme. */
  terrain: 'maze' | 'dungeon' | 'island' | 'none';
  music: 'adventure' | 'cozy' | 'battle' | 'spooky';
  prop: EntityKind;
  mobColor: number;
  heroColor: number;
  nouns: string[];
  adjectives: string[];
}

const THEMES: Record<Theme, ThemeSpec> = {
  forest: {
    bg: 0x1b2a1f, terrain: 'island', music: 'adventure', prop: 'plant', mobColor: 0x8fbf5b, heroColor: 0x8affc1,
    nouns: ['Grove', 'Thicket', 'Hollow', 'Glade', 'Canopy'],
    adjectives: ['Whispering', 'Tangled', 'Emerald', 'Sunlit', 'Mossy'],
  },
  dungeon: {
    bg: 0x1a1622, terrain: 'dungeon', music: 'spooky', prop: 'crate', mobColor: 0xa06bd8, heroColor: 0xffd166,
    nouns: ['Vault', 'Crypt', 'Catacomb', 'Keep', 'Oubliette'],
    adjectives: ['Forgotten', 'Sunken', 'Cursed', 'Silent', 'Iron'],
  },
  city: {
    bg: 0x1e2230, terrain: 'maze', music: 'battle', prop: 'crate', mobColor: 0xff8f5b, heroColor: 0x6bc7ff,
    nouns: ['District', 'Rooftops', 'Alley', 'Skyline', 'Terminal'],
    adjectives: ['Neon', 'Rain-slick', 'Midnight', 'Chrome', 'Restless'],
  },
  space: {
    bg: 0x0d1030, terrain: 'maze', music: 'spooky', prop: 'lantern', mobColor: 0x6bc7ff, heroColor: 0xffd166,
    nouns: ['Station', 'Belt', 'Drift', 'Hangar', 'Nebula'],
    adjectives: ['Silent', 'Orbital', 'Frozen', 'Distant', 'Hollow'],
  },
  candy: {
    bg: 0x2e1b2b, terrain: 'island', music: 'cozy', prop: 'plant', mobColor: 0xff9ecb, heroColor: 0xffd166,
    nouns: ['Bakery', 'Sundae', 'Gumdrop', 'Sprinkle', 'Taffy'],
    adjectives: ['Sugared', 'Melting', 'Frosted', 'Sticky', 'Sweet'],
  },
};

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
const range = (rng: Rng, lo: number, hi: number): number => Math.floor(lo + rng() * (hi - lo + 1));

/** A seeded title, so a generated game arrives with a name of its own. */
export function genName(theme: Theme, rng: Rng): string {
  const t = THEMES[theme];
  return `${pick(rng, t.adjectives)} ${pick(rng, t.nouns)}`;
}

/** defaultEntity seeds blob art from Math.random, which would make two
 *  runs of the same seed LOOK different. The generator owns that too, so a
 *  shared seed reproduces the art as well as the layout. */
function makeEntity(rng: Rng) {
  return (kind: EntityKind, name: string, x: number, y: number, over: Partial<EntityDef> = {}): EntityDef => ({
    ...defaultEntity(kind, x, y),
    name,
    seed: Math.floor(rng() * 1000),
    ...over,
  });
}

function emptyScene(name: string, view: 'top' | 'depth', bg: number): SceneDef {
  return {
    id: freshId('s'),
    name,
    background: bg,
    view,
    gravity: false,
    worldW: view === 'depth' ? 1440 : 720,
    worldH: view === 'depth' ? 720 : 1280,
    script: '',
    entities: [],
  };
}

/** Genre decides the camera and the shape of a level. */
function viewFor(genre: Genre): 'top' | 'depth' {
  return genre === 'brawler' || genre === 'runner' ? 'depth' : 'top';
}

/** Somewhere inside the walkable area, never on top of the player. */
function spot(rng: Rng, s: SceneDef, avoid: { x: number; y: number }[]): { x: number; y: number } {
  const minY = s.view === 'depth' ? 380 : 120;
  for (let tries = 0; tries < 40; tries++) {
    const x = range(rng, 80, s.worldW - 80);
    const y = range(rng, minY, s.worldH - 120);
    if (avoid.every((a) => Math.hypot(a.x - x, a.y - y) > 170)) return { x, y };
  }
  return { x: s.worldW / 2, y: minY + 80 };
}

export function genGame(input: Partial<GenParams> = {}): ProjectDef {
  const p: GenParams = {
    ...DEFAULT_PARAMS,
    ...input,
    mechanics: { ...DEFAULT_PARAMS.mechanics, ...(input.mechanics ?? {}) },
  };
  p.levels = Math.max(1, Math.min(5, Math.floor(p.levels)));
  const rng = seededRng(p.seed);
  const theme = THEMES[p.theme];
  const entity = makeEntity(rng);
  const view = viewFor(p.genre);
  const title = genName(p.theme, rng);
  const m = p.mechanics;
  // Cozy games are a promise of no failure — combat is off no matter what
  // the form said, or "cozy" means nothing.
  const combat = m.combat && p.genre !== 'cozy';
  const boss = m.boss && combat;

  const scenes: SceneDef[] = [];

  // ---- title menu -------------------------------------------------------
  const menu = emptyScene('Menu', 'top', theme.bg);
  const firstName = `${theme.nouns[0]} 1`;
  menu.entities.push(
    entity('text', 'Title', 360, 420, { text: title, fontSize: 52, color: theme.heroColor }),
    entity('text', 'Sub', 360, 500, { text: `a ${p.genre} adventure`, fontSize: 24, color: 0x9a97b8 }),
    entity('button', 'Start', 360, 760, {
      text: '▶ START',
      events: [{ trigger: 'tap', actions: [{ cmd: 'goto', text: firstName }] }],
    }),
  );
  menu.script = `api.music.play('${theme.music}');`;
  scenes.push(menu);

  // ---- play levels ------------------------------------------------------
  const items: ItemDef[] = m.shop
    ? [
        { id: 'potion', name: 'Potion', emoji: '🧪', desc: 'Restores a heart.', price: 5, effect: 'heal', n: 1 },
        { id: 'charm', name: 'Lucky Charm', emoji: '🍀', desc: 'A little wiser.', price: 8, effect: 'xp', n: 10 },
      ]
    : [];

  for (let i = 0; i < p.levels; i++) {
    const last = i === p.levels - 1;
    const s = emptyScene(`${theme.nouns[i % theme.nouns.length]} ${i + 1}`, view, theme.bg);
    const cols = colsFor(s.worldW);
    const rows = rowsFor(s.worldH);
    if (theme.terrain === 'maze') s.tiles = mazeRows(cols, rows, rng);
    else if (theme.terrain === 'dungeon') s.tiles = dungeonRows(cols, rows, rng);
    else if (theme.terrain === 'island') s.tiles = islandRows(cols, rows, rng);

    const heroAt = { x: 360, y: view === 'depth' ? 560 : s.worldH - 180 };
    const taken = [heroAt];
    s.entities.push(entity('blob', 'Hero', heroAt.x, heroAt.y, { color: theme.heroColor }));

    // Difficulty scales the population, and the curve ramps across levels.
    if (combat) {
      const count = Math.min(8, p.difficulty * 2 + i);
      for (let k = 0; k < count; k++) {
        const at = spot(rng, s, taken);
        taken.push(at);
        s.entities.push(
          entity('mob', `Foe ${i + 1}-${k + 1}`, at.x, at.y, {
            color: theme.mobColor,
            hp: p.difficulty + Math.floor(i / 2),
            damage: 1,
            xp: 5 + p.difficulty,
            behavior: pick(rng, ['chase', 'patrol', 'wander', 'guard'] as const),
          }),
        );
      }
    }

    if (m.collect) {
      const chests = range(rng, 2, 4);
      for (let k = 0; k < chests; k++) {
        const at = spot(rng, s, taken);
        taken.push(at);
        s.entities.push(
          entity('crate', `Chest ${i + 1}-${k + 1}`, at.x, at.y, {
            events: [
              {
                trigger: 'touch',
                once: true,
                actions: [
                  { cmd: 'coins', n: range(rng, 3, 8) },
                  { cmd: 'vfx', text: 'coins' },
                  { cmd: 'var', text: 'loot', n: 1 },
                  { cmd: 'remove' },
                ],
              },
            ],
          }),
        );
      }
    }

    if (m.dialogue && i === 0) {
      const at = spot(rng, s, taken);
      taken.push(at);
      s.entities.push(
        entity('npc', 'Guide', at.x, at.y, {
          lines: [`Welcome to ${title}.`, combat ? 'Clear the way ahead!' : 'Take your time out there.'],
        }),
      );
    }

    if (m.shop && i === 0) {
      const at = spot(rng, s, taken);
      taken.push(at);
      s.entities.push(
        entity('npc', 'Trader', at.x, at.y, {
          color: 0xffd166,
          events: [{ trigger: 'tap', actions: [{ cmd: 'shop' }] }],
        }),
      );
    }

    // A prop or two so a level is never a bare field.
    for (let k = 0; k < range(rng, 2, 5); k++) {
      const at = spot(rng, s, taken);
      taken.push(at);
      s.entities.push(entity(theme.prop, `Prop ${i + 1}-${k + 1}`, at.x, at.y));
    }

    // ---- how this level ENDS. Every level must have an exit, or the game
    // is a room with no door — the single most important validation.
    const levelEvents: EventDef[] = [];
    if (last) {
      if (boss) {
        const at = { x: s.worldW / 2, y: view === 'depth' ? 460 : 260 };
        s.entities.push(
          entity('boss', 'Warden', at.x, at.y, {
            color: theme.mobColor,
            hp: 6 + p.difficulty * 3,
            damage: 1,
            xp: 40,
            shootEvery: p.difficulty >= 3 ? 2.2 : 0,
          }),
        );
      }
      levelEvents.push({ trigger: 'cleared', actions: [{ cmd: 'win', text: 'YOU WIN! 🏆' }] });
      // Nothing to clear? Then collecting is the win.
      if (!combat) {
        levelEvents.length = 0;
        s.entities.push(
          entity('lantern', 'Goal', s.worldW / 2, view === 'depth' ? 420 : 200, {
            events: [{ trigger: 'touch', actions: [{ cmd: 'win', text: 'YOU MADE IT! 🌟' }] }],
          }),
        );
      }
    } else {
      const nextName = `${theme.nouns[(i + 1) % theme.nouns.length]} ${i + 2}`;
      s.entities.push(
        entity('lantern', 'Exit', s.worldW - 140, view === 'depth' ? 420 : 180, {
          events: [{ trigger: 'touch', actions: [{ cmd: 'goto', text: nextName }] }],
        }),
      );
    }
    if (levelEvents.length) s.events = levelEvents;

    const lines = [`api.player('Hero', ${view === 'depth' ? 330 : 300});`, `api.music.play('${theme.music}');`];
    if (combat) {
      lines.push(`api.hearts(${p.difficulty >= 3 ? 3 : 4});`);
      lines.push("api.ability('Attack', { icon: 'sword', cooldown: 0.5, key: 'q' }, function () { api.meleeAttack(130, 1); });");
    }
    if (m.skills) {
      lines.push('api.levels({ xpPerLevel: 20 });');
      lines.push(
        `api.skills.define({ title: 'SKILLS', points: 1, pointsPerTier: 3, branches: [` +
          `{ id: 'power', name: 'POWER', color: 0xff6b6b, nodes: [` +
          `{ id: 'might', name: 'Might', emoji: 'sword', cost: 1, maxRank: 3, tier: 0 },` +
          `{ id: 'crit', name: 'Crit', emoji: 'bolt', cost: 1, maxRank: 3, tier: 1 }] },` +
          `{ id: 'grit', name: 'GRIT', color: 0x6bc7ff, nodes: [` +
          `{ id: 'tough', name: 'Tough', emoji: 'shield', cost: 1, maxRank: 3, tier: 0 }] }] });`,
      );
      lines.push('api.onDefeat(function () { api.skills.addPoints(1); });');
    }
    s.script = lines.join('\n');
    scenes.push(s);
  }

  const project: ProjectDef = {
    version: 1,
    name: title,
    interverse: false,
    multiplayer: false,
    startScene: scenes[0]!.id,
    scenes,
    assets: {},
  };
  if (items.length) project.db = { items };
  return project;
}

/** Problems that would make a generated game unplayable or pointless. The
 *  generator runs this on its own output — a generator you cannot trust is
 *  worse than no generator. */
export function validateGame(p: ProjectDef): string[] {
  const problems: string[] = [];
  if (!p.scenes.length) problems.push('no levels');
  if (!p.scenes.some((s) => s.id === p.startScene)) problems.push('start level is missing');

  const names = new Set(p.scenes.map((s) => s.name));
  for (const s of p.scenes) {
    const events = [...(s.events ?? []), ...s.entities.flatMap((e) => e.events)];
    for (const ev of events) {
      for (const a of ev.actions) {
        if (a.cmd === 'goto' && a.text && !names.has(a.text)) problems.push(`${s.name}: door to a level that does not exist (${a.text})`);
      }
    }
    // Every level needs a player, or nothing moves.
    if (s.name !== 'Menu' && !s.script.includes('api.player(')) problems.push(`${s.name}: no player`);
    // ...and a way out, or it is a room with no door.
    const hasExit = events.some((ev) => ev.actions.some((a) => a.cmd === 'goto' || a.cmd === 'win'));
    if (s.name !== 'Menu' && !hasExit) problems.push(`${s.name}: no way to finish or leave`);
    // Actors must not be stacked on the player's spawn.
    const hero = s.entities.find((e) => e.name === 'Hero');
    if (hero) {
      for (const e of s.entities) {
        if (e !== hero && Math.hypot(e.x - hero.x, e.y - hero.y) < 90) problems.push(`${s.name}: ${e.name} spawns on top of the player`);
      }
    }
  }
  // The whole game must be winnable somewhere.
  const winnable = p.scenes.some((s) =>
    [...(s.events ?? []), ...s.entities.flatMap((e) => e.events)].some((ev) => ev.actions.some((a) => a.cmd === 'win')),
  );
  if (!winnable) problems.push('the game can never be won');
  return problems;
}
