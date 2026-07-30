// Headless playtest for Interverse Studio: boots the editor, places entities,
// edits props, runs the code window against a live Play session, adds a
// second level and switches, saves a story, and round-trips export/import.
// Run the studio dev server first (pnpm dev:studio):
//
//   node scripts/verify-studio.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5179/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
mkdirSync(outDir, { recursive: true });

// Local relay for the multiplayer section.
if (!existsSync('relay/dist/server.js')) {
  console.error('relay/dist missing — run: pnpm --filter @interverse/relay build');
  process.exit(1);
}
const relay = spawn('node', ['relay/dist/server.js'], {
  env: { ...process.env, PORT: '8787' },
  stdio: 'ignore',
});

// Mock AI bridge for the chat section (full protocol, no Claude login).
const aiBridge = spawn('node', ['scripts/ai-bridge.mjs'], {
  env: { ...process.env, AI_BRIDGE_MOCK: '1' },
  stdio: 'ignore',
});

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* default */
  }
  return undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
// Script errors surface as alert() dialogs — treat them as failures.
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  void d.dismiss();
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
// Fresh slate: an earlier session's autosave/skill saves must not leak in.
await page.evaluate(() => {
  window.localStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
await sleep(500);

// PLACE: default project has 1 entity (Hero); add three more kinds.
const count0 = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => window.__studio.addEntity('crate', 200, 400));
await page.evaluate(() => window.__studio.addEntity('button', 360, 1100));
const npcName = await page.evaluate(() => window.__studio.addEntity('npc', 500, 700));
const count1 = await page.evaluate(() => window.__studio.entityCount());
const placeOk = count0 === 1 && count1 === 4;

// EDIT: select the NPC, move + rename it via props (inspector path).
await page.evaluate((n) => window.__studio.select(n), npcName);
await page.evaluate(() => window.__studio.setProp('name', 'Wizard'));
await page.evaluate(() => window.__studio.setProp('x', 300));
const wiz = await page.evaluate(() => window.__studio.getEntity('Wizard'));
const editOk = !!wiz && wiz.x === 300 && wiz.kind === 'npc';

// STORY: give the Wizard lines.
await page.evaluate(() => window.__studio.select('Wizard'));
await page.evaluate(() => window.__studio.setStory(['Welcome to my tower!', 'Mind the crates.']));
const wiz2 = await page.evaluate(() => window.__studio.getEntity('Wizard'));
const storyOk = Array.isArray(wiz2?.lines) && wiz2.lines.length === 2;
await page.screenshot({ path: `${outDir}/st-1-edit.png` });

// LEVELS: add a second scene, switch there and back.
await page.evaluate(() => window.__studio.addScene('Level 2'));
const scenes = await page.evaluate(() => window.__studio.sceneCount());
const onL2 = await page.evaluate(() => window.__studio.sceneName());
await page.evaluate(() => window.__studio.switchSceneByName('Level 1'));
const backOn = await page.evaluate(() => window.__studio.sceneName());
const levelsOk = scenes === 2 && onL2 === 'Level 2' && backOn === 'Level 1';

// CODE + PLAY: script moves the Hero at scene start; play and check both that
// the play scene spawned everything and the script ran.
await page.evaluate(() =>
  window.__studio.setScript("api.entity('Hero').x = 111; api.onUpdate(() => {});"),
);
await page.evaluate(() => window.__studio.play());
await sleep(900);
const playing = await page.evaluate(() => window.__studio.playing());
const playCount = await page.evaluate(() => window.__studio.playEntityCount());
// live-apply against the running game too
await page.evaluate(() => window.__studio.applyScriptNow("api.entity('Wizard').y = 222;"));
const playOk = playing === true && playCount === 4;
await page.screenshot({ path: `${outDir}/st-2-play.png` });
await page.evaluate(() => window.__studio.stop());
const stopped = await page.evaluate(() => window.__studio.playing());
const stopOk = stopped === false;

// EXPORT / IMPORT round-trip.
const json = await page.evaluate(() => window.__studio.exportJson());
const parsed = JSON.parse(json);
const exportOk =
  parsed.scenes.length === 2 && parsed.scenes[0].entities.some((e) => e.name === 'Wizard');
await page.evaluate(() => window.__studio.importJson(JSON.stringify({ ...JSON.parse(window.__studio.exportJson()), name: 'Reimported' })));
const reName = await page.evaluate(() => window.__studio.projectName());
const reCount = await page.evaluate(() => window.__studio.entityCount());
const importOk = reName === 'Reimported' && reCount === 4;
await page.screenshot({ path: `${outDir}/st-3-final.png` });

// TEMPLATES: every starter loads and actually PLAYS — entities spawn, the
// scene script runs without erroring or instantly game-overing, and (the
// vanish-on-play regression) every spawned entity is VISIBLY rendering
// after the pop-in settles.
const templateIds = ['topdown', 'side25', 'side', 'runner', 'slash', 'action', 'cozy', 'rpg'];
const templates = {};
for (const id of templateIds) {
  await page.evaluate((t) => window.__studio.loadTemplate(t), id);
  await sleep(250);
  await page.evaluate(() => window.__studio.play());
  await sleep(1300);
  templates[id] = {
    n: await page.evaluate(() => window.__studio.playEntityCount()),
    vis: await page.evaluate(() => window.__studio.playVisibleCount()),
    over: await page.evaluate(() => window.__studio.gameIsOver()),
  };
  if (id === 'slash') await page.screenshot({ path: `${outDir}/st-4-slash.png` });
  if (id === 'topdown') await page.screenshot({ path: `${outDir}/st-7-topdown-play.png` });
  await page.evaluate(() => window.__studio.stop());
  await sleep(150);
}
const templatesOk = templateIds.every(
  (id) => templates[id].n > 0 && templates[id].vis === templates[id].n && templates[id].over === false,
);

// SKILL TREE: the RPG template defines a 6-node branching tree; points spend
// on unlock, and gated nodes stay locked until their requirement is met.
await page.evaluate(() => window.__studio.loadTemplate('rpg'));
await sleep(250);
await page.evaluate(() => window.__studio.play());
await sleep(900);
const skillNodes = await page.evaluate(() => window.__studio.skillNodeCount());
await page.evaluate(() => window.__studio.skillAddPoints(4));
const stormEarly = await page.evaluate(() => window.__studio.skillUnlock('storm')); // gated
const strength = await page.evaluate(() => window.__studio.skillUnlock('strength'));
const unlockedIds = await page.evaluate(() => window.__studio.skillUnlocked());
// SCORE api against the live game.
await page.evaluate(() => window.__studio.applyScriptNow('api.score.add(7)'));
const score = await page.evaluate(() => window.__studio.playScore());
const skillsOk =
  skillNodes === 6 && stormEarly === false && strength === true && unlockedIds.includes('strength');
const scoreOk = score >= 7;
await page.screenshot({ path: `${outDir}/st-5-rpg.png` });
await page.evaluate(() => window.__studio.stop());

// TILEMAP PAINTER: the garden template ships painted terrain; painting
// persists through export, renders in Play, and solid tiles BLOCK players.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const tileBefore = await page.evaluate(() => window.__studio.tileAt(9, 25)); // template path
await page.evaluate(() => window.__studio.setTile(5, 5, 'w'));
const tilePainted = await page.evaluate(() => window.__studio.tileAt(5, 5));
await page.evaluate(() => {
  for (let r = 20; r <= 30; r++) window.__studio.setTile(6, r, 'k'); // rock wall left of the hero
});
const tProj = JSON.parse(await page.evaluate(() => window.__studio.exportJson()));
const tilesPersist = Array.isArray(tProj.scenes[0].tiles) && tProj.scenes[0].tiles[5][5] === 'w';
await page.evaluate(() => window.__studio.play());
await sleep(900);
const playTiles = await page.evaluate(() => window.__studio.playHasTiles());
await page.screenshot({ path: `${outDir}/st-8-tiles.png` });
// Hold ← : the painted wall (cols 6, x 240..280) must stop the hero (start x 360).
await page.keyboard.down('ArrowLeft');
await sleep(1400);
await page.keyboard.up('ArrowLeft');
const heroX = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeX = api.entity('Hero').x");
  return window.__probeX;
});
const tilesOk =
  tileBefore === 'd' && tilePainted === 'w' && tilesPersist && playTiles === true && heroX > 285 && heroX < 345;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// CAMERA FOLLOW: Sunset Street is 3 screens wide but only ONE landscape
// screen tall (2.5D travels long-ways); walking east must carry the hero
// past the first screen while the camera pans, and walking up must stop at
// the horizon (DEPTH_MIN_Y) instead of climbing into the sky.
await page.evaluate(() => window.__studio.loadTemplate('side25'));
await sleep(300);
const worldSize = await page.evaluate(() => window.__studio.worldSize());
await page.evaluate(() => window.__studio.play());
await sleep(900);
await page.keyboard.down('ArrowRight');
await sleep(3200);
await page.keyboard.up('ArrowRight');
const heroX2 = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeX2 = api.entity('Hero').x");
  return window.__probeX2;
});
const camX = await page.evaluate(() => window.__studio.cameraX());
await page.keyboard.down('ArrowUp');
await sleep(2200);
await page.keyboard.up('ArrowUp');
const heroY2 = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeY2 = api.entity('Hero').y");
  return window.__probeY2;
});
const horizonOk = heroY2 > 300 && heroY2 < 340;
// Castle Crashers feel: depth scaling is SUBTLE — at the horizon the hero
// shrinks only a little (~0.82), never into fake-3D dots.
const heroScale = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeS = api.entity('Hero').scale.x");
  return window.__probeS;
});
const subtleOk = heroScale > 0.75 && heroScale < 0.92;
// BRAWLER JUMP (2.5D + Gravity): Space lifts off the plane; a plain jump
// lands back on the SAME ground row; steering mid-air lands on a NEW row.
await page.keyboard.down(' ');
await sleep(220);
const zMid = await page.evaluate(() => window.__studio.playerZ());
await page.keyboard.up(' ');
await sleep(900);
const zLand = await page.evaluate(() => window.__studio.playerZ());
const yPlain = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeYp = api.entity('Hero').y");
  return window.__probeYp;
});
await page.keyboard.down(' ');
await page.keyboard.down('ArrowDown');
await sleep(500);
await page.keyboard.up(' ');
await sleep(400);
await page.keyboard.up('ArrowDown');
await sleep(600);
const ySteer = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeYs = api.entity('Hero').y");
  return window.__probeYs;
});
const jumpOk = zMid > 20 && zLand === 0 && yPlain > 300 && yPlain < 340 && ySteer > 380;
const cameraOk =
  worldSize.w === 2160 && worldSize.h === 720 && heroX2 > 750 && camX > 60 && horizonOk && subtleOk &&
  jumpOk;
await page.screenshot({ path: `${outDir}/st-9-camera.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// SCREEN-FIT PREVIEW: the editor overlay that shows how things fit on a
// rotated (landscape) or portrait phone screen.
await page.evaluate(() => window.__studio.setFramePreview('landscape'));
const frameMode = await page.evaluate(() => window.__studio.framePreview());
await page.screenshot({ path: `${outDir}/st-10-frame.png` });
await page.evaluate(() => window.__studio.setFramePreview('off'));
const frameOk = frameMode === 'landscape';

// COMBAT: Blob Arena — mobs with AI chase the hero, ability buttons hit
// for damage, defeats grant XP toward levels, and the boss bar shows.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(300);
await page.evaluate(() => window.__studio.play());
await sleep(800);
// Plenty of hearts so mob contact + Warden projectiles can't end the run
// mid-test — the checks below are about mechanics, not survival skill.
await page.evaluate(() => window.__studio.applyScriptNow('api.hearts(9)'));
const mobCount0 = await page.evaluate(() => window.__studio.mobCount());
const abilities = await page.evaluate(() => window.__studio.abilityCount());
const bossBar = await page.evaluate(() => window.__studio.bossBarVisible());
const gap0 = await page.evaluate(() => {
  window.__studio.applyScriptNow(
    "var h=api.entity('Hero'), m=api.entity('Slime A'); window.__gap=Math.hypot(h.x-m.x,h.y-m.y);",
  );
  return window.__gap;
});
await sleep(1100);
const gap1 = await page.evaluate(() => {
  window.__studio.applyScriptNow(
    "var h=api.entity('Hero'), m=api.entity('Slime A'); window.__gap=Math.hypot(h.x-m.x,h.y-m.y);",
  );
  return window.__gap;
});
const chaseOk = gap1 < gap0 - 60;
// Park the slime at slash range (just outside contact range) and cut it down.
const parkSlime =
  "var h=api.entity('Hero'), m=api.entity('Slime A'); if (m && !m.destroyed) { m.x=h.x+70; m.y=h.y; }";
await page.evaluate((c) => window.__studio.applyScriptNow(c), parkSlime);
const hp0 = await page.evaluate(() => window.__studio.mobHp('Slime A'));
await page.evaluate(() => window.__studio.fireAbility('Slash'));
const hp1 = await page.evaluate(() => window.__studio.mobHp('Slime A'));
for (let i = 0; i < 2; i++) {
  await sleep(700); // cooldown
  await page.evaluate((c) => window.__studio.applyScriptNow(c), parkSlime);
  await page.evaluate(() => window.__studio.fireAbility('Slash'));
}
await sleep(400);
const mobsLeft = await page.evaluate(() => window.__studio.mobCount());
const xp = await page.evaluate(() => window.__studio.xpNow());
const level = await page.evaluate(() => window.__studio.levelNow());
const hearts = await page.evaluate(() => window.__studio.heartsNow());
// VFX: the kill poofed + coin pickups sparkle later — bursts were spawned.
const vfx = await page.evaluate(() => window.__studio.vfxCount());
// COSMETICS: crown + sword attach live and read back.
await page.evaluate(() => window.__studio.setOutfit('Hero', { hat: 'crown', held: 'sword' }));
const outfit = await page.evaluate(() => window.__studio.outfitOf('Hero'));
const outfitOk = !!outfit && outfit.hat === 'crown' && outfit.held === 'sword';
// Ranged: the Warden (shootEvery 2.4) has been in range this whole fight.
const shots = await page.evaluate(() => window.__studio.shotsFired());
// Boss phase two: dropping the Warden to half HP enrages it.
await page.evaluate(() => window.__studio.applyScriptNow("api.hurt('Warden', 13)"));
const enraged = await page.evaluate(() => window.__studio.mobEnraged('Warden'));
const rangedOk = shots >= 1 && enraged === true;
// MUSIC: the arena template asked for battle BGM at scene start.
const music = await page.evaluate(() => window.__studio.musicNow());
const musicOk = music === 'battle';
const combatOk =
  musicOk && vfx >= 1 && outfitOk && mobCount0 === 4 && abilities === 2 && bossBar === true && chaseOk &&
  hp1 === hp0 - 1 && mobsLeft === 3 && (xp > 0 || level > 1) && hearts > 0 && hearts <= 9;
// LOOT: the slain slime scattered coins near where it died — walk the hero
// over the spot and the pickup banks them in the game's save file.
await page.evaluate(() => window.__studio.applyScriptNow("api.entity('Hero').x += 90;"));
await sleep(400);
await page.evaluate(() => window.__studio.applyScriptNow("api.entity('Hero').x += 50;"));
await sleep(400);
await page.evaluate(() => window.__studio.applyScriptNow("api.entity('Hero').y -= 60;"));
await sleep(400);
const coins = await page.evaluate(() => window.__studio.coinsNow());
const coinsOk = coins >= 1;
// IN-GAME SAVE: script data + XP/level survive stopping and replaying.
await page.evaluate(() => window.__studio.applyScriptNow("api.save.set('quest', 'met-the-warden')"));
const xpBefore = await page.evaluate(() => window.__studio.xpNow());
await page.screenshot({ path: `${outDir}/st-11-combat.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(200);
await page.evaluate(() => window.__studio.play());
await sleep(900);
const savedQuest = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeQ = api.save.get('quest', '')");
  return window.__probeQ;
});
const xpRestored = await page.evaluate(() => window.__studio.xpNow());
const persistOk = savedQuest === 'met-the-warden' && xpRestored === xpBefore && xpBefore > 0;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// PROJECT LIBRARY: 💾 Save keeps the whole game in My Games; opening it
// back restores the project after switching to something else.
const savedName = await page.evaluate(() => window.__studio.projectName());
const libId = await page.evaluate(() => window.__studio.librarySave());
await page.evaluate(() => window.__studio.loadTemplate('cozy'));
await sleep(300);
const otherName = await page.evaluate(() => window.__studio.projectName());
const reopened = await page.evaluate((id) => window.__studio.libraryOpen(id), libId);
await sleep(300);
const restoredName = await page.evaluate(() => window.__studio.projectName());
const libCount = await page.evaluate(() => window.__studio.libraryList().length);
const libOk =
  reopened === true && restoredName === savedName && otherName !== savedName && libCount >= 1;

// NPC WAYPOINT PATROL: api.patrol walks the Gardener along its loop.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
await page.evaluate(() => window.__studio.play());
await sleep(2600);
const gardenerX = await page.evaluate(() => {
  window.__studio.applyScriptNow("window.__probeGx = api.entity('Gardener').x");
  return window.__probeGx;
});
const patrolOk = gardenerX > 240; // started at 160, walking its loop
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// NO-CODE EVENTS: an entirely event-built chest: touching it gives score,
// flips a switch, and removes itself; a second entity is gated on that
// switch, so touching it only pays out after the chest is opened.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(300);
await page.evaluate(() => {
  window.__studio.addEntity('crate', 560, 640);
  window.__studio.addEntity('lantern', 160, 640);
  window.__studio.setEvents('crate', [
    {
      trigger: 'touch',
      actions: [
        { cmd: 'score', n: 7 },
        { cmd: 'switchOn', text: 'opened' },
        { cmd: 'remove' },
      ],
    },
  ]);
  window.__studio.setEvents('lantern', [
    { trigger: 'touch', ifSwitch: 'opened', actions: [{ cmd: 'coins', n: 2 }] },
  ]);
  window.__studio.setScript("api.player('Hero', 300);");
  window.__studio.play();
});
await sleep(700);
const evCoins0 = await page.evaluate(() => window.__studio.coinsNow());
const evCount0 = await page.evaluate(() => window.__studio.playEntityCount());
// gated lantern first: nothing should happen (switch is off)
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=160; h.y=640;"));
await sleep(400);
const evCoinsGated = await page.evaluate(() => window.__studio.coinsNow());
// open the chest: +7 score, switch on, chest disappears
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=560; h.y=640;"));
await sleep(400);
const evScore = await page.evaluate(() => window.__studio.playScore());
const evSwitch = await page.evaluate(() => window.__studio.switchIsOn('opened'));
const evCount1 = await page.evaluate(() => window.__studio.playEntityCount());
// back to the lantern: the gate is open now, coins pay out
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=160; h.y=640;"));
await sleep(400);
const evCoins1 = await page.evaluate(() => window.__studio.coinsNow());
const eventsOk =
  evCoinsGated === evCoins0 && evScore === 7 && evSwitch === true &&
  evCount1 === evCount0 - 1 && evCoins1 === evCoins0 + 2;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// PROCGEN: generate a maze into the editor, play it (solid walls), then
// swap to a generated island LIVE via the script api.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(300);
await page.evaluate(() => window.__studio.genTiles('maze'));
const mazeTiles = await page.evaluate(() => window.__studio.tileRows());
const mazeHasWalls = !!mazeTiles && mazeTiles.join('').includes('k') && mazeTiles.join('').includes('d');
await page.evaluate(() => {
  window.__studio.setScript("api.player('Hero', 300);");
  window.__studio.play();
});
await sleep(700);
const mazePlays = await page.evaluate(() => window.__studio.playHasTiles());
await page.evaluate(() => window.__studio.applyScriptNow('api.setTiles(api.gen.island())'));
await sleep(300);
const islandLive = await page.evaluate(() => window.__studio.playHasTiles());
const genOk = mazeHasWalls && mazePlays === true && islandLive === true;
await page.screenshot({ path: `${outDir}/st-13-procgen.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// AI CHAT BRIDGE: the chat tab talks to Claude through the local bridge
// (mock mode here) — no API key. The mock replies, calls add_entity over
// the wire, and the lantern lands in the editor.
const bridged = await page.evaluate(() => window.__studio.chatBridged());
const chatCount0 = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => {
  const input = document.getElementById('chat-input');
  input.value = 'add a lantern';
  document.getElementById('btn-chat-send').click();
});
await sleep(1200);
const chatCount1 = await page.evaluate(() => window.__studio.entityCount());
const chatOk = bridged === true && chatCount1 === chatCount0 + 1;

// MULTIPLAYER BLOCKS: two browsers share a room on the co-op template —
// roster syncs, the remote avatar appears and tracks movement, and shared
// state (the co-op score) reaches the joiner.
const pageB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pageB.on('pageerror', (e) => errors.push(`B pageerror: ${e.message}`));
pageB.on('dialog', (d) => void d.dismiss());
await pageB.goto(url, { waitUntil: 'networkidle' });
await pageB.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
await page.evaluate(() => window.__studio.loadTemplate('party'));
await pageB.evaluate(() => window.__studio.loadTemplate('party'));
await sleep(300);
const roomCode = await page.evaluate(() => window.__studio.netHost());
await pageB.evaluate((c) => window.__studio.netJoin(c), roomCode);
await sleep(1600);
const playersA = await page.evaluate(() => window.__studio.netPlayerCount());
const playersB = await pageB.evaluate(() => window.__studio.netPlayerCount());
const remotesB = await pageB.evaluate(() => window.__studio.netRemoteCount());
// Host's hero moves; the joiner's view of that avatar follows.
await page.evaluate(() => window.__studio.applyScriptNow("api.entity('Hero').x = 620; api.entity('Hero').y = 400;"));
await sleep(1200);
const remotePosB = await pageB.evaluate(() => window.__studio.netRemotePos());
const moveOk = !!remotePosB && Math.abs(remotePosB.x - 620) < 60 && Math.abs(remotePosB.y - 400) < 60;
// Shared state: host bumps the co-op score; joiner reads it.
await page.evaluate(() => window.__studio.netSetState('score', 5));
await sleep(500);
const stateB = await pageB.evaluate(() => window.__studio.netGetState('score'));
const netOk = playersA === 2 && playersB === 2 && remotesB === 1 && moveOk && stateB === 5;
await pageB.screenshot({ path: `${outDir}/st-6-mp.png` });
await page.evaluate(() => window.__studio.stop());
await pageB.evaluate(() => window.__studio.stop());

await browser.close();
relay.kill();
aiBridge.kill();

const ok =
  placeOk && editOk && storyOk && levelsOk && playOk && stopOk && exportOk && importOk &&
  templatesOk && skillsOk && scoreOk && tilesOk && cameraOk && frameOk && combatOk && rangedOk &&
  patrolOk && chatOk && coinsOk && persistOk && libOk && eventsOk && genOk && netOk && errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok, placeOk, editOk, storyOk, levelsOk, playOk, playCount, stopOk, exportOk, importOk,
      templatesOk, templates, skillsOk, skillNodes, stormEarly, strength, scoreOk, score,
      tilesOk, tileBefore, tilePainted, tilesPersist, playTiles, heroX,
      cameraOk, worldSize, heroX2, camX, heroY2, horizonOk, heroScale, subtleOk, frameOk,
      jumpOk, zMid, zLand, yPlain, ySteer,
      combatOk, musicOk, music, vfx, outfitOk, outfit, mobCount0, abilities, bossBar, chaseOk, gap0, gap1, hp0, hp1, mobsLeft, xp, level, hearts,
      rangedOk, shots, enraged, patrolOk, gardenerX,
      chatOk, bridged, chatCount0, chatCount1,
      coinsOk, coins, persistOk, savedQuest, xpBefore, xpRestored,
      libOk, libId, savedName, restoredName, libCount,
      eventsOk, evCoins0, evCoinsGated, evScore, evSwitch, evCount0, evCount1, evCoins1,
      genOk, mazeHasWalls, mazePlays, islandLive,
      netOk, playersA, playersB, remotesB, moveOk, remotePosB, stateB,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
