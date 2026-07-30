/**
 * Game templates — playable starter projects per view style + genre. Each is
 * plain project data (model.ts) + scene scripts written against the runtime
 * api, so authors can open one, press Play, and then reshape everything.
 * First-person arrives with the 3D engine (shown as a locked tile in the UI).
 */
import { defaultEntity, defaultScene } from './model.js';
import type { EntityDef, EntityKind, ProjectDef, SceneDef } from './model.js';

export interface TemplateDef {
  id: string;
  name: string;
  emoji: string;
  view: string;
  blurb: string;
  make: () => ProjectDef;
}

function E(kind: EntityKind, name: string, x: number, y: number, over: Partial<EntityDef> = {}): EntityDef {
  const d = defaultEntity(kind, x, y);
  d.name = name;
  Object.assign(d, over);
  return d;
}

function project(name: string, scenes: SceneDef[], multiplayer = false): ProjectDef {
  return {
    version: 1,
    name,
    interverse: false,
    multiplayer,
    startScene: scenes[0]!.id,
    scenes,
    assets: {},
  };
}

const S = (lines: string[]): string => lines.join('\n');

// ---------------------------------------------------------------- templates

/** Painted garden terrain: tree border, grass + flowers, a path, a pond. */
function gardenTiles(): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 32; r++) {
    let line = '';
    for (let c = 0; c < 18; c++) {
      let ch = (r * 7 + c * 3) % 5 === 0 ? 'f' : 'g';
      if (r === 0 || r === 31 || c === 0 || c === 17) ch = 't';
      if ((c === 8 || c === 9) && r > 1 && r < 30) ch = 'd';
      if (r >= 3 && r <= 6 && c >= 12 && c <= 15) ch = 'w';
      line += ch;
    }
    rows.push(line);
  }
  return rows;
}

function topDown(): ProjectDef {
  const s = defaultScene('Garden');
  s.background = 0x14261c;
  s.tiles = gardenTiles();
  s.entities.push(
    E('blob', 'Hero', 360, 1000, { color: 0xffd166 }),
    E('npc', 'Gardener', 160, 300, {
      color: 0x8affc1,
      lines: ['My fireflies escaped!', 'Walk into all six to catch them.'],
    }),
    ...[1, 2, 3, 4, 5, 6].map((i) =>
      E('lantern', `Firefly ${i}`, 90 + ((i * 173) % 560), 220 + ((i * 331) % 900), { scale: 0.7 }),
    ),
    ...[1, 2, 3, 4, 5].map((i) => E('plant', `Bush ${i}`, 60 + ((i * 233) % 600), 160 + ((i * 449) % 1000))),
  );
  s.script = S([
    "// Top-down collect-a-thon: move with WASD/arrows or the joystick.",
    "api.player('Hero', 320);",
    'var left = 6;',
    'api.onUpdate(function () {',
    '  for (var i = 1; i <= 6; i++) {',
    "    var f = api.entity('Firefly ' + i);",
    "    if (f && !f.destroyed && api.overlap('Hero', f, 70)) {",
    '      api.remove(f); api.sfx.pop(); api.score.add(1); left--;',
    "      if (left === 0) api.gameOver('ALL FIREFLIES FOUND! 🌟');",
    '    }',
    '  }',
    '});',
  ]);
  return project('Garden Explorer', [s]);
}

function side25(): ProjectDef {
  const s = defaultScene('Street');
  s.background = 0x1a1826;
  s.view = 'depth'; // 2.5D: a landscape-height board, journey runs LONG-WAYS
  s.gravity = true; // in 2.5D this is the BRAWLER jump (Space / Jump button)
  s.worldW = 2160; // three screens long
  s.entities.push(
    E('text', 'Sky', 360, 90, { text: '🌇 SUNSET STREET →', fontSize: 40, color: 0xffb86b }),
    E('blob', 'Hero', 200, 560, { color: 0x6fc3ff }),
    E('npc', 'Vendor', 360, 420, { color: 0xffd166, lines: ['Fresh juice!', 'The street runs east — the camera follows you.', 'Walk up toward the horizon; things shrink into the distance.'] }),
    E('crate', 'Stall', 540, 470, { color: 0x4a3826 }),
    E('plant', 'Tree A', 820, 340, { color: 0x2f8d4a }),
    E('plant', 'Tree B', 1120, 560, { color: 0x2f8d4a }),
    E('lantern', 'Lamp A', 960, 330),
    E('npc', 'Busker', 1400, 540, { color: 0xc77dff, lines: ['🎶 Halfway down the street!', 'Keep going east.'] }),
    E('plant', 'Tree C', 1700, 380, { color: 0x2f8d4a }),
    E('lantern', 'Lamp B', 1860, 330),
    E('npc', 'Innkeeper', 2000, 480, { color: 0x8affc1, lines: ['You made it to the end of the street!', 'Rooms are free for travelers.'] }),
  );
  s.script = S([
    '// 2.5D + a 3-screen-wide world: the camera follows the Hero long-ways.',
    '// Gravity on a 2.5D level = brawler jump: Space (or the Jump button),',
    '// steer while airborne, land anywhere on the ground plane.',
    "api.player('Hero', 300);",
  ]);
  return project('Sunset Street (2.5D)', [s]);
}

function sideView(): ProjectDef {
  const s = defaultScene('Hills');
  s.background = 0x11202e;
  s.gravity = true; // physics option: ← → run, ↑ / W / joystick-up to jump
  s.worldW = 2160; // a long run — the camera follows
  s.entities.push(
    E('text', 'Hint', 360, 180, { text: '⬅➡ run · ⬆ jump\ncatch every spark!', fontSize: 30, color: 0x9a97b8 }),
    E('blob', 'Hero', 120, 1020, { color: 0x8affc1 }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
      E('lantern', `Spark ${i}`, 150 + i * 240, i % 2 ? 880 : 700, { scale: 0.6 }),
    ),
  );
  s.script = S([
    '// Gravity is a physics toggle on the level (not a "view" — rotate the',
    '// device any time; the game just letterboxes).',
    "api.player('Hero', 330);",
    'var left = 8;',
    'api.onUpdate(function () {',
    '  for (var i = 1; i <= 8; i++) {',
    "    var sp = api.entity('Spark ' + i);",
    "    if (sp && !sp.destroyed && api.overlap('Hero', sp, 70)) {",
    '      api.remove(sp); api.sfx.chime(); api.score.add(1); left--;',
    "      if (left === 0) api.gameOver('ALL SPARKS CAUGHT! ⚡');",
    '    }',
    '  }',
    '});',
  ]);
  return project('Hilltop Hop (gravity run)', [s]);
}

function runner(): ProjectDef {
  const s = defaultScene('Track');
  s.background = 0x101826;
  s.entities.push(
    E('blob', 'Runner', 180, 1000, { color: 0x8affc1 }),
    E('text', 'Hint', 360, 200, { text: 'JUMP the crates!\n(space / ⬆ / tap JUMP)', fontSize: 30, color: 0x9a97b8 }),
    E('button', 'Jump', 570, 1160, { text: 'JUMP', color: 0x8affc1, tapSound: '' }),
  );
  s.script = S([
    '// Endless runner: gravity + jump, crates fly in faster and faster.',
    "var hero = api.entity('Runner');",
    'var groundY = 1000, vy = 0, speed = 320, obstacles = [];',
    'function jump() { if (hero.y >= groundY - 2) { vy = -820; api.sfx.blip(1.2); } }',
    "api.onTap('Jump', jump);",
    "api.onTap('Runner', jump);",
    'api.every(1.15, function () {',
    "  var c = api.spawn('crate', 800, groundY);",
    '  c.scale.set(0.8); obstacles.push(c);',
    '});',
    'api.onUpdate(function (dt) {',
    '  vy += 2200 * dt; hero.y = Math.min(groundY, hero.y + vy * dt);',
    '  speed += 8 * dt;',
    '  for (var i = obstacles.length - 1; i >= 0; i--) {',
    '    var c = obstacles[i];',
    '    if (c.destroyed) { obstacles.splice(i, 1); continue; }',
    '    c.x -= speed * dt;',
    '    if (c.x < -60) { api.remove(c); obstacles.splice(i, 1); api.score.add(1); api.sfx.pop(0.8); }',
    "    else if (api.overlap(hero, c, 58)) api.gameOver('TRIPPED! 🩹');",
    '  }',
    '});',
  ]);
  return project('Blob Dash (runner)', [s]);
}

function slash(): ProjectDef {
  const s = defaultScene('Dojo');
  s.background = 0x201626;
  s.entities.push(
    E('text', 'Hint', 360, 200, { text: 'SLASH the fruit —\ndon’t let 5 escape!', fontSize: 32, color: 0x9a97b8 }),
  );
  s.script = S([
    '// Fruit-frenzy: fruit arcs up from the bottom; tap to slash.',
    'var colors = [0xff6f91, 0xffd166, 0x8affc1, 0x6fc3ff, 0xc77dff];',
    'var missed = 0, fruit = [];',
    'api.every(0.85, function () {',
    "  var f = api.spawn('blob', api.random(90, 630), 1360);",
    '  f.vy = -api.random(950, 1250); f.vx = api.random(-140, 140);',
    '  f.scale.set(0.8);',
    '  fruit.push(f);',
    '  api.onTap(f, function () {',
    '    if (f.destroyed) return;',
    '    api.remove(f); api.sfx.pop(1.3); api.score.add(1);',
    '  });',
    '});',
    'api.onUpdate(function (dt) {',
    '  for (var i = fruit.length - 1; i >= 0; i--) {',
    '    var f = fruit[i];',
    '    if (f.destroyed) { fruit.splice(i, 1); continue; }',
    '    f.vy += 1500 * dt; f.x += f.vx * dt; f.y += f.vy * dt;',
    '    if (f.y > 1420) {',
    '      api.remove(f); fruit.splice(i, 1); missed++; api.sfx.buzz();',
    "      if (missed >= 5) api.gameOver('THE FRUIT WON 🍉');",
    '    }',
    '  }',
    '});',
  ]);
  return project('Slash Frenzy', [s]);
}

function action(): ProjectDef {
  const s = defaultScene('Arena');
  s.background = 0x26161a;
  s.entities.push(
    E('blob', 'Hero', 360, 1020, { color: 0x8affc1 }),
    E('text', 'Hint', 360, 140, { text: 'J slash · K shockwave — or tap the buttons!', fontSize: 26, color: 0x9a97b8 }),
    E('mob', 'Slime A', 160, 460, {}),
    E('mob', 'Slime B', 560, 520, { behavior: 'patrol', color: 0xff8f5b }),
    E('mob', 'Slime C', 360, 340, { behavior: 'wander', color: 0xffb86b }),
    E('boss', 'Warden', 360, 250, {}),
  );
  s.script = S([
    '// Arena brawl: slash the slimes, level up, take down the Warden.',
    '// Mobs/bosses are palette actors — HP, damage, XP and AI live in the',
    '// inspector; abilities are on-screen buttons mapped to code below.',
    "api.player('Hero', 330);",
    'api.hearts(3);',
    'api.levels();',
    "api.ability('Slash', { icon: 'sword', cooldown: 0.5, key: 'j' }, function () {",
    '  api.meleeAttack(140, 1);',
    '});',
    "api.ability('Shockwave', { icon: 'bolt', cooldown: 4, key: 'k' }, function () {",
    '  api.meleeAttack(340, 2);',
    '});',
    'api.onDefeat(function (name) {',
    '  api.score.add(5);',
    "  if (name === 'Warden') api.gameOver('ARENA CHAMPION! 🏆');",
    '});',
  ]);
  return project('Blob Arena (action)', [s]);
}

function cozy(): ProjectDef {
  const s = defaultScene('Home');
  s.background = 0x2a2016;
  s.entities.push(
    E('text', 'Title', 360, 120, { text: '🍂 A QUIET EVENING', fontSize: 40, color: 0xffb86b }),
    E('npc', 'Mo', 200, 520, { color: 0xffb86b, lines: ['Welcome home.', 'Water the plant, light the lamp…', 'No rush. Nothing to lose here.'] }),
    E('npc', 'Pip', 540, 760, { color: 0x8affc1, lines: ['I made tea!', 'Tap the crate — I hid biscuits inside.'] }),
    E('plant', 'Fern', 130, 940, { color: 0x2f8d4a }),
    E('lantern', 'Lamp', 590, 420),
    E('crate', 'Biscuit box', 360, 1020, { color: 0x4a3826, tapSound: 'chime' }),
  );
  s.script = S([
    '// Cozy: gentle interactions, no fail state.',
    "var fern = api.entity('Fern');",
    "api.onTap('Fern', function () { fern.scale.set(Math.min(1.6, fern.scale.x + 0.12)); api.sfx.chime(); });",
    "api.onTap('Lamp', function () { api.sfx.chime(); api.say('Lamp', '✨'); });",
  ]);
  return project('A Quiet Evening (cozy)', [s]);
}

function rpg(): ProjectDef {
  const s = defaultScene('Village');
  s.background = 0x16281c;
  s.entities.push(
    E('blob', 'Hero', 360, 1000, { color: 0x6fc3ff }),
    E('npc', 'Elder', 160, 360, {
      color: 0xe8e2ee,
      lines: ['Our village needs a champion.', 'Train on the dummy to earn skill points.', 'Then open your SKILLS and choose a path.'],
    }),
    E('crate', 'Training dummy', 560, 420, { color: 0x8a6a3b, tapSound: 'pop' }),
    E('button', 'Skills', 600, 1180, { text: '✦ SKILLS', color: 0xc77dff }),
  );
  s.script = S([
    '// Tiny RPG: earn points on the dummy, spend them in a branching tree.',
    "api.player('Hero', 300);",
    'api.skills.define({',
    "  title: 'CHAMPION PATHS',",
    '  points: 1,',
    '  nodes: [',
    "    { id: 'strength', name: 'Strength', emoji: '💪', cost: 1 },",
    "    { id: 'focus', name: 'Focus', emoji: '🧘', cost: 1 },",
    "    { id: 'blade', name: 'Blade Arts', emoji: '⚔️', cost: 2, requires: ['strength'] },",
    "    { id: 'guard', name: 'Iron Guard', emoji: '🛡️', cost: 2, requires: ['strength'] },",
    "    { id: 'spark', name: 'Spark', emoji: '✨', cost: 2, requires: ['focus'] },",
    "    { id: 'storm', name: 'Storm Call', emoji: '🌩️', cost: 3, requires: ['spark'] },",
    '  ],',
    '});',
    "api.onTap('Training dummy', function () { api.skills.addPoints(1); api.score.add(1); });",
    "api.onTap('Skills', function () { api.skills.open(); });",
    "api.skills.onUnlock(function (id) { api.sfx.chime(); api.say('Elder', 'You learned ' + id + '!'); });",
  ]);
  return project('Tiny Quest (RPG)', [s]);
}

function party(): ProjectDef {
  const s = defaultScene('Meadow');
  s.background = 0x142618;
  s.entities.push(
    E('blob', 'Hero', 360, 900, { color: 0xffd166 }),
    E('text', 'Title', 360, 130, { text: '🎉 FIREFLY PARTY\ncatch them together!', fontSize: 34, color: 0x8affc1 }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
      E('lantern', `Fly ${i}`, 80 + ((i * 199) % 570), 260 + ((i * 313) % 880), { scale: 0.65 }),
    ),
  );
  s.script = S([
    '// Co-op collect: every player sees every catch, score is shared.',
    "api.player('Hero', 330);",
    'function applyTaken(k) {',
    "  if (k.indexOf('taken-') === 0) {",
    '    var e = api.entity(k.slice(6));',
    '    if (e && !e.destroyed) { api.remove(e); api.sfx.pop(1.2); }',
    '  }',
    "  if (k === 'score' && api.net) api.score.set(api.net.state('score') || 0);",
    '}',
    'if (api.net) {',
    '  api.net.onState(applyTaken);',
    '  // catch up on state that changed before we joined',
    '  for (var i = 1; i <= 8; i++) if (api.net.state("taken-Fly " + i)) applyTaken("taken-Fly " + i);',
    "  api.score.set(api.net.state('score') || 0);",
    '}',
    'api.onUpdate(function () {',
    '  for (var i = 1; i <= 8; i++) {',
    "    var name = 'Fly ' + i;",
    '    var f = api.entity(name);',
    "    if (f && !f.destroyed && api.overlap('Hero', f, 70)) {",
    '      api.remove(f); api.sfx.pop(1.2);',
    '      if (api.net) {',
    "        api.net.setState('taken-' + name, true);",
    "        api.net.setState('score', (api.net.state('score') || 0) + 1);",
    '      } else { api.score.add(1); }',
    '    }',
    '  }',
    '});',
  ]);
  return project('Firefly Party (co-op)', [s], true);
}

export const TEMPLATES: TemplateDef[] = [
  { id: 'blank', name: 'Blank', emoji: '⬜', view: '2D', blurb: 'An empty canvas with one hero.', make: () => project('My Game', [(() => { const s = defaultScene('Level 1'); s.entities.push(E('blob', 'Hero', 360, 640)); return s; })()]) },
  { id: 'topdown', name: 'Garden Explorer', emoji: '🧭', view: 'Top-down', blurb: 'Walk anywhere, collect the fireflies. Cozy-action starter.', make: topDown },
  { id: 'side25', name: 'Sunset Street', emoji: '🌇', view: '2.5D · 3 screens wide', blurb: 'A long street to journey down — depth scaling + camera follow built in.', make: side25 },
  { id: 'side', name: 'Hilltop Hop', emoji: '⛰️', view: 'Gravity run · wide', blurb: 'Run and JUMP across a 3-screen world — gravity is a level physics toggle.', make: sideView },
  { id: 'runner', name: 'Blob Dash', emoji: '🏃', view: 'Side 2D', blurb: 'Endless runner: jump the crates, speed ramps up.', make: runner },
  { id: 'slash', name: 'Slash Frenzy', emoji: '🍉', view: '2D', blurb: 'Fruit-ninja style: tap-slash the flying fruit.', make: slash },
  { id: 'action', name: 'Blob Arena', emoji: '⚔️', view: 'Top-down', blurb: 'Slash mobs, level up, beat the boss.', make: action },
  { id: 'cozy', name: 'A Quiet Evening', emoji: '🍂', view: '2D', blurb: 'A warm room, gentle stories, zero fail states.', make: cozy },
  { id: 'rpg', name: 'Tiny Quest', emoji: '🗡️', view: 'Top-down RPG', blurb: 'NPCs, training, and a branching skill tree.', make: rpg },
  { id: 'party', name: 'Firefly Party', emoji: '🎉', view: 'Multiplayer co-op', blurb: 'Host a room, share the code, catch fireflies together with a shared score.', make: party },
];
