/**
 * 📖 The api catalogue — one searchable index of everything a scene script
 * can call. It backs two surfaces: the 🔍 palette beside the Code window
 * (click an entry to insert a working snippet) and the ⛓ Flow drag-off
 * search. Keeping both on one list is the point: the api is large enough
 * that nobody discovers it by reading runtime.ts, and two hand-kept lists
 * would drift apart within a phase.
 *
 * Entries mirror `ScriptApi` in runtime.ts. When you add to that interface,
 * add here too — the unit test asserts every documented name actually
 * resolves on the live api object, so drift fails the build rather than
 * quietly shipping a lie.
 */

import type { ScriptApi } from './runtime.js';

/** Members deliberately left out of the palette: raw engine handles that
 *  are escape hatches for people already writing real code, not commands a
 *  beginner should be offered. Listing them keeps the guard below honest. */
type Undocumented = 'scene' | 'game' | 'verium';

export interface ApiEntry {
  /** Group shown in the palette. */
  category: string;
  /** Dotted call name, e.g. 'api.coins.spend'. Also the search key. */
  name: string;
  signature: string;
  blurb: string;
  /** Inserted at the cursor when the entry is chosen. */
  snippet: string;
}

export const API_CATEGORIES = [
  '🕹 Player & controls',
  '🎭 Actors',
  '⏱ Timing & logic',
  '⚔ Combat',
  '📈 Progress',
  '🗺 World & camera',
  '🖼 Screens & UI',
  '🎁 Items & shop',
  '✨ Looks & effects',
  '🎵 Audio',
  '💾 Save & state',
  '🌐 Language',
  '👥 Multiplayer',
] as const;

export const API_DOCS: ApiEntry[] = [
  // ---------------------------------------------------------- player
  {
    category: '🕹 Player & controls',
    name: 'api.player',
    signature: 'api.player(name, speed?) → Entity',
    blurb: 'Make an actor player-controlled: arrow keys / WASD, and a touch joystick on phones.',
    snippet: "api.player('Hero', 300);",
  },
  {
    category: '🕹 Player & controls',
    name: 'api.ability',
    signature: 'api.ability(name, { icon?, cooldown?, key? }, cb)',
    blurb: 'Add an on-screen ability button (bottom-right) with an optional cooldown and keyboard shortcut.',
    snippet: "api.ability('Slash', { icon: 'sword', cooldown: 0.6, key: 'q' }, () => {\n  api.meleeAttack(120, 1);\n});",
  },
  {
    category: '🕹 Player & controls',
    name: 'api.onTap',
    signature: 'api.onTap(target, cb)',
    blurb: 'Run something when an actor is tapped or clicked.',
    snippet: "api.onTap('Chest', () => {\n  api.coins.add(5);\n});",
  },
  // ---------------------------------------------------------- actors
  {
    category: '🎭 Actors',
    name: 'api.entity',
    signature: 'api.entity(name) → Entity | undefined',
    blurb: 'Look up one actor by its name so you can move or read it.',
    snippet: "const hero = api.entity('Hero');",
  },
  {
    category: '🎭 Actors',
    name: 'api.entities',
    signature: 'api.entities() → Record<string, Entity>',
    blurb: 'Every actor in the level, keyed by name.',
    snippet: 'const all = api.entities();',
  },
  {
    category: '🎭 Actors',
    name: 'api.spawn',
    signature: 'api.spawn(kind, x, y) → Entity',
    blurb: 'Create a new actor mid-game at a position.',
    snippet: "api.spawn('crate', 360, 640);",
  },
  {
    category: '🎭 Actors',
    name: 'api.remove',
    signature: 'api.remove(target)',
    blurb: 'Take an actor out of the level.',
    snippet: "api.remove('Crate');",
  },
  {
    category: '🎭 Actors',
    name: 'api.tween',
    signature: 'api.tween(target, { x?, y?, rotation?, alpha?, scale? }, secs)',
    blurb: 'Glide an actor to new values over time — the easiest way to animate anything.',
    snippet: "api.tween('Door', { y: 200, alpha: 0 }, 0.8);",
  },
  {
    category: '🎭 Actors',
    name: 'api.patrol',
    signature: 'api.patrol(target, points, speed?)',
    blurb: 'Walk an actor around a looping route — town NPCs, guards, wandering animals.',
    snippet: "api.patrol('Villager', [[160, 300], [560, 300]], 90);",
  },
  {
    category: '🎭 Actors',
    name: 'api.overlap',
    signature: 'api.overlap(a, b, dist) → boolean',
    blurb: 'Are two actors within dist of each other? Use it inside api.onUpdate for touch checks.',
    snippet: "if (api.overlap('Hero', 'Goal', 60)) {\n  api.gameOver('YOU WIN! 🏆');\n}",
  },
  // ---------------------------------------------------------- timing
  {
    category: '⏱ Timing & logic',
    name: 'api.every',
    signature: 'api.every(secs, cb)',
    blurb: 'Repeat something forever on a timer — spawners, ticking damage, blinking lights.',
    snippet: 'api.every(2, () => {\n  api.spawn(\'blob\', api.random(80, 640), 100);\n});',
  },
  {
    category: '⏱ Timing & logic',
    name: 'api.after',
    signature: 'api.after(secs, cb)',
    blurb: 'Do something once, later.',
    snippet: "api.after(3, () => {\n  api.say('Guide', 'Head north!');\n});",
  },
  {
    category: '⏱ Timing & logic',
    name: 'api.onUpdate',
    signature: 'api.onUpdate(cb)',
    blurb: 'Run every frame (dt = seconds since the last one). Keep it cheap — this runs 60x a second.',
    snippet: 'api.onUpdate((dt) => {\n  // runs every frame\n});',
  },
  {
    category: '⏱ Timing & logic',
    name: 'api.random',
    signature: 'api.random(min, max) → number',
    blurb: 'A random number between min and max.',
    snippet: 'const x = api.random(80, 640);',
  },
  // ---------------------------------------------------------- combat
  {
    category: '⚔ Combat',
    name: 'api.hearts',
    signature: 'api.hearts(n)',
    blurb: 'Give the player a hearts HUD. Touching a mob costs one; at zero it is game over.',
    snippet: 'api.hearts(3);',
  },
  {
    category: '⚔ Combat',
    name: 'api.meleeAttack',
    signature: 'api.meleeAttack(radius?, dmg?) → number',
    blurb: 'Hit every mob near the player at once. Returns how many were hit.',
    snippet: 'api.meleeAttack(120, 1);',
  },
  {
    category: '⚔ Combat',
    name: 'api.hurt',
    signature: 'api.hurt(target, dmg)',
    blurb: 'Damage one named mob or boss directly.',
    snippet: "api.hurt('Gloomfang', 2);",
  },
  {
    category: '⚔ Combat',
    name: 'api.hpOf',
    signature: 'api.hpOf(target) → number',
    blurb: 'Current HP of a mob or boss (0 once it is defeated).',
    snippet: "const hp = api.hpOf('Gloomfang');",
  },
  {
    category: '⚔ Combat',
    name: 'api.onDefeat',
    signature: 'api.onDefeat(cb)',
    blurb: 'Called with the name whenever any mob or boss goes down — the hook for win conditions.',
    snippet: "api.onDefeat((name) => {\n  if (name === 'Gloomfang') api.gameOver('VICTORY! 🏆');\n});",
  },
  // ---------------------------------------------------------- progress
  {
    category: '📈 Progress',
    name: 'api.score',
    signature: 'api.score.add(n) · .set(n) · .get()',
    blurb: 'Score with an automatic HUD in the top-right.',
    snippet: 'api.score.add(1);',
  },
  {
    category: '📈 Progress',
    name: 'api.levels',
    signature: 'api.levels({ xpPerLevel? })',
    blurb: 'Turn on the XP bar and levelling. Each level-up grants a skill point.',
    snippet: 'api.levels({ xpPerLevel: 20 });',
  },
  {
    category: '📈 Progress',
    name: 'api.xp',
    signature: 'api.xp.add(n) · .get()',
    blurb: 'Grant experience directly (mob defeats already grant theirs).',
    snippet: 'api.xp.add(10);',
  },
  {
    category: '📈 Progress',
    name: 'api.level',
    signature: 'api.level() → number',
    blurb: 'Which level the player has reached (needs api.levels first).',
    snippet: 'const lvl = api.level();',
  },
  {
    category: '📈 Progress',
    name: 'api.coins',
    signature: 'api.coins.get() · .add(n) · .spend(n) → boolean',
    blurb: 'The coin wallet. spend() returns false when the player cannot afford it.',
    snippet: 'if (api.coins.spend(5)) {\n  api.say(\'Shop\', \'Sold!\');\n}',
  },
  {
    category: '📈 Progress',
    name: 'api.vars',
    signature: 'api.vars.get(name) · .set(name, v) · .add(name, n?)',
    blurb: 'Numeric counters for quest progress. Shared with the ⚡ "needs variable ≥ n" event gate.',
    snippet: "api.vars.add('chests', 1);",
  },
  {
    category: '📈 Progress',
    name: 'api.switches',
    signature: 'api.switches.on(name) · .off(name) · .isOn(name)',
    blurb: 'On/off flags for "has this happened yet". Shared with the ⚡ "only if switch" gate.',
    snippet: "api.switches.on('opened');",
  },
  {
    category: '📈 Progress',
    name: 'api.skills',
    signature: 'api.skills.define(tree) · .open() · .addPoints(n) · .isUnlocked(id)',
    blurb: 'The skill tree: branches of tiered, multi-rank skills the player invests points into.',
    snippet:
      "api.skills.define({\n  title: 'SKILLS',\n  points: 1,\n  branches: [\n    {\n      id: 'might',\n      name: 'MIGHT',\n      color: 0xff6b6b,\n      nodes: [\n        { id: 'str', name: 'Strength', emoji: '💪', cost: 1, maxRank: 5, tier: 0 },\n        { id: 'crit', name: 'Crit', emoji: '⚡', cost: 1, maxRank: 3, tier: 1 },\n      ],\n    },\n  ],\n});",
  },
  // ---------------------------------------------------------- world
  {
    category: '🗺 World & camera',
    name: 'api.goto',
    signature: 'api.goto(levelName)',
    blurb: 'Send the player to another level.',
    snippet: "api.goto('Boss Lair');",
  },
  {
    category: '🗺 World & camera',
    name: 'api.gen',
    signature: 'api.gen.maze() · .dungeon() · .island() → string[]',
    blurb: 'Generate tile rows sized to this level, ready for api.setTiles.',
    snippet: 'api.setTiles(api.gen.dungeon());',
  },
  {
    category: '🗺 World & camera',
    name: 'api.setTiles',
    signature: 'api.setTiles(rows)',
    blurb: 'Replace the level’s painted tiles live, collision included.',
    snippet: 'api.setTiles(api.gen.maze());',
  },
  {
    category: '🗺 World & camera',
    name: 'api.camera',
    signature: 'api.camera.panTo(x, y, secs?) · .shake(power?, secs?) · .follow(name) · .letterbox(on)',
    blurb: 'Point the camera somewhere for a reveal, shake it on impact, or frame a cutscene.',
    snippet: "api.camera.panTo(1200, 400, 1.2);\napi.after(2, () => api.camera.follow('Hero'));",
  },
  // ---------------------------------------------------------- screens
  {
    category: '🖼 Screens & UI',
    name: 'api.say',
    signature: 'api.say(speaker, ...lines)',
    blurb: 'Show a dialogue box. Each extra line is another tap to advance.',
    snippet: "api.say('Guide', 'Welcome!', 'Find both chests.');",
  },
  {
    category: '🖼 Screens & UI',
    name: 'api.menu',
    signature: 'api.menu.settings() · .pause() · .close() · .isOpen()',
    blurb: 'The built-in ⚙ settings screen (volumes + language) and ⏸ pause menu. Both pause the game.',
    snippet: 'api.menu.pause();',
  },
  {
    category: '🖼 Screens & UI',
    name: 'api.title',
    signature: 'api.title()',
    blurb: 'Pause on a title screen with ▶ CONTINUE / ✚ NEW GAME and volume bars.',
    snippet: 'api.title();',
  },
  {
    category: '🖼 Screens & UI',
    name: 'api.gameOver',
    signature: 'api.gameOver(message?)',
    blurb: 'End the run with a message and the final score.',
    snippet: "api.gameOver('QUEST COMPLETE! 🏆');",
  },
  // ---------------------------------------------------------- items
  {
    category: '🎁 Items & shop',
    name: 'api.items',
    signature: 'api.items.give(id, n?) · .count(id) · .use(id) · .buy(id) · .list() · .open()',
    blurb: 'The 🗄 Database items. open() shows the player’s 🎒 inventory.',
    snippet: "api.items.give('potion');",
  },
  {
    category: '🎁 Items & shop',
    name: 'api.shop',
    signature: 'api.shop.open()',
    blurb: 'Open the ready-made 🛒 shop over every database item with a price.',
    snippet: 'api.shop.open();',
  },
  // ---------------------------------------------------------- looks
  {
    category: '✨ Looks & effects',
    name: 'api.vfx',
    signature: "api.vfx(preset, x, y) — 'confetti'|'sparkle'|'poof'|'hearts'|'embers'|'coins'",
    blurb: 'A one-shot particle burst.',
    snippet: "api.vfx('confetti', 360, 640);",
  },
  {
    category: '✨ Looks & effects',
    name: 'api.outfit',
    signature: 'api.outfit(target, { hat?, held? })',
    blurb: 'Restyle a character live — hats and held items. Pair with api.coins.spend for a cosmetic shop.',
    snippet: "api.outfit('Hero', { hat: 'crown', held: 'sword' });",
  },
  {
    category: '✨ Looks & effects',
    name: 'api.playClip',
    signature: 'api.playClip(target, clipName)',
    blurb: 'Play a named animation clip on an imported spritesheet.',
    snippet: "api.playClip('Hero', 'attack');",
  },
  // ---------------------------------------------------------- audio
  {
    category: '🎵 Audio',
    name: 'api.music',
    signature: "api.music.play(id) · .stop() · .fanfare() · .setVolume(bus, v) — 'adventure'|'cozy'|'battle'|'spooky'",
    blurb: 'Looping chiptune background music, plus a victory fanfare that ducks and resumes it.',
    snippet: "api.music.play('adventure');",
  },
  {
    category: '🎵 Audio',
    name: 'api.sfx',
    signature: 'api.sfx.pop() · .blip() · .chime() · .buzz()',
    blurb: 'The built-in sound effects.',
    snippet: 'api.sfx.chime();',
  },
  // ---------------------------------------------------------- save
  {
    category: '💾 Save & state',
    name: 'api.save',
    signature: 'api.save.set(key, value) · .get(key, fallback) · .remove(key) · .clear()',
    blurb: 'The player’s save file on this device — survives closing the game.',
    snippet: "api.save.set('quest', 'met-the-warden');",
  },
  // ---------------------------------------------------------- language
  {
    category: '🌐 Language',
    name: 'api.t',
    signature: 'api.t(key) → string',
    blurb: 'Look a string up in the 🗄 Database language table.',
    snippet: "api.say('Guide', api.t('greet'));",
  },
  {
    category: '🌐 Language',
    name: 'api.setLang',
    signature: 'api.setLang(lang)',
    blurb: 'Switch language and remember it on this device.',
    snippet: "api.setLang('es');",
  },
  // ---------------------------------------------------------- net
  {
    category: '👥 Multiplayer',
    name: 'api.net',
    signature: 'api.net.players() · .setState(k, v) · .state(k) · .onState(cb) · .send(d) · .onMessage(cb)',
    blurb: 'Null when solo. Other players already appear as live avatars; this is for shared game state.',
    snippet: "if (api.net) {\n  api.net.setState('round', 1);\n}",
  },
];

/** The api members this catalogue documents, checked against the real
 *  interface. `satisfies` proves every name here exists on ScriptApi; the
 *  Uncovered line below proves the reverse — add a member to ScriptApi and
 *  this file stops compiling until it is either catalogued or explicitly
 *  listed as an escape hatch. Documentation cannot silently rot. */
const DOCUMENTED_ROOTS = [
  'player', 'ability', 'onTap', 'entity', 'entities', 'spawn', 'remove', 'tween', 'patrol',
  'overlap', 'every', 'after', 'onUpdate', 'random', 'hearts', 'meleeAttack', 'hurt', 'hpOf',
  'onDefeat', 'score', 'levels', 'xp', 'level', 'coins', 'vars', 'switches', 'skills', 'goto',
  'gen', 'setTiles', 'camera', 'say', 'title', 'menu', 'gameOver', 'items', 'shop', 'vfx', 'outfit',
  'playClip', 'music', 'sfx', 'save', 't', 'setLang', 'net',
] as const satisfies readonly (keyof ScriptApi)[];

type Uncovered = Exclude<keyof ScriptApi, (typeof DOCUMENTED_ROOTS)[number] | Undocumented>;
const _everyApiMemberIsAccountedFor: [Uncovered] extends [never] ? true : Uncovered = true;
void _everyApiMemberIsAccountedFor;

/** The second segment of every catalogued name, e.g. 'api.camera.shake' →
 *  'camera'. The unit test asserts these are exactly DOCUMENTED_ROOTS. */
export const documentedRoots = (): string[] => [...DOCUMENTED_ROOTS];

/** Shown in an empty Code window so the first thing an author sees is an
 *  explanation rather than a blinking cursor. */
export const STARTER_SCRIPT = `// This is the Code window. It runs once when the level starts.
// Everything happens through "api" — click 🔍 Find a command on the
// right to browse what it can do and drop working lines in here.

api.player('Hero', 300);        // arrows / WASD / touch joystick
api.say('Guide', 'Welcome!');   // a dialogue box

// Try: api.hearts(3) · api.score.add(1) · api.music.play('adventure')
`;

/** Match a query against one field. A literal substring always beats a
 *  scattered subsequence — typing 'music' should surface api.music, not
 *  every blurb whose letters happen to spell it. Returns a score (lower is
 *  better) or -1 when the query does not fit at all. */
function fieldScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const literal = h.indexOf(n);
  if (literal >= 0) return literal;
  let hi = 0;
  let score = 100; // any subsequence match ranks below every literal one
  let lastHit = -1;
  for (const ch of n) {
    const found = h.indexOf(ch, hi);
    if (found === -1) return -1;
    // Adjacent matches are cheaper than scattered ones.
    score += lastHit === -1 ? found : found - lastHit - 1;
    lastHit = found;
    hi = found + 1;
  }
  return score;
}

/** Rank the catalogue against a query. Empty query = everything, in order. */
export function searchApi(query: string, limit = 60): ApiEntry[] {
  const q = query.trim();
  if (!q) return API_DOCS.slice(0, limit);
  const hits: { entry: ApiEntry; score: number }[] = [];
  for (const entry of API_DOCS) {
    // Name first, then the prose. The signature counts because the preset
    // lists ('confetti', 'adventure') only ever appear there.
    const byName = fieldScore(entry.name, q);
    const byText = fieldScore(`${entry.blurb} ${entry.signature}`, q);
    const score = byName >= 0 ? byName : byText >= 0 ? byText + 1000 : -1;
    if (score >= 0) hits.push({ entry, score });
  }
  hits.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
  return hits.slice(0, limit).map((h) => h.entry);
}
