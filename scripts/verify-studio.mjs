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
/**
 * Wait for something to become true rather than guessing how long it takes.
 * A loaded machine runs the game loop slowly, and a fixed sleep then tests
 * the machine instead of the code. Returns the last value either way, so a
 * timeout still fails the assertion it was gathering evidence for.
 */
const waitFor = async (read, ok, timeout = 8000) => {
  const until = Date.now() + timeout;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(100);
    v = await read();
  }
  return v;
};

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
const templateIds = ['topdown', 'quest', 'vault', 'blobvale', 'bloomstead', 'hushfall', 'side25', 'side', 'runner', 'slash', 'action', 'cozy', 'rpg'];
const templates = {};
const MULTIPLAYER_TEMPLATES = ['blobvale', 'hushfall'];
for (const id of templateIds) {
  await page.evaluate((t) => window.__studio.loadTemplate(t), id);
  await sleep(250);
  // A multiplayer project opens the room-code lobby on Play (correct), so
  // drive those straight into a solo session.
  if (MULTIPLAYER_TEMPLATES.includes(id)) await page.evaluate(() => window.__studio.playSolo());
  else await page.evaluate(() => window.__studio.play());
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
// CAMERA DIRECTION: panTo parks the camera away from the hero; follow resumes.
await page.evaluate(() => window.__studio.applyScriptNow("api.camera.panTo(1800, 360, 0.3); api.camera.shake(10, 0.2);"));
await sleep(600);
const camPanX = await page.evaluate(() => window.__studio.cameraX());
const camHeld = await page.evaluate(() => window.__studio.cameraHolding());
await page.evaluate(() => window.__studio.applyScriptNow("api.camera.follow('Hero')"));
const camReleased = await page.evaluate(() => window.__studio.cameraHolding());
const camDirOk = camPanX > 900 && camHeld === true && camReleased === false;
const cameraOk =
  worldSize.w === 2160 && worldSize.h === 720 && heroX2 > 750 && camX > 60 && horizonOk && subtleOk &&
  jumpOk && camDirOk;
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
// Wait for the level to actually be live before counting what is in it.
const evCount0 = await waitFor(
  () => page.evaluate(() => window.__studio.playEntityCount()),
  (n) => n > 0,
);
const evCoins0 = await page.evaluate(() => window.__studio.coinsNow());
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

// DATABASE ITEMS + LOCALES + HIERARCHY + FLOW-LINK: the content database
// feeds inventory/shop apis; @keys translate per language; the hierarchy
// lists actors; dragging a flow wire writes the switch gate itself.
await page.evaluate(() => {
  window.__studio.setDbItems([
    { id: 'potion', name: 'Potion', emoji: '🧪', desc: '', price: 4, effect: 'coins', n: 3 },
  ]);
  window.__studio.setLocales({ en: { greet: 'Hello' }, es: { greet: 'Hola' } });
});
const hierN = await page.evaluate(() => window.__studio.hierarchyCount());
// two FRESH actors — the wire must invent the switch and gate the target
await page.evaluate(() => {
  window.__studio.addEntity('plant', 200, 900);
  window.__studio.addEntity('crate', 500, 900);
  window.__studio.setProp('name', 'LinkTarget');
  window.__studio.select('plant');
  window.__studio.setProp('name', 'LinkSource');
});
const linked = await page.evaluate(() => window.__studio.flowLink('LinkSource', 'LinkTarget'));
const srcDef = await page.evaluate(() => window.__studio.getEntity('LinkSource'));
const tgtDef = await page.evaluate(() => window.__studio.getEntity('LinkTarget'));
const linkSwitch = srcDef?.events?.[0]?.actions?.find((a) => a.cmd === 'switchOn' && a.text?.startsWith('link-'))?.text ?? '';
const linkOk =
  linked === true && linkSwitch.startsWith('link-') &&
  tgtDef?.events?.some((ev) => ev.ifSwitch === linkSwitch) === true;
await page.evaluate(() => window.__studio.play());
await sleep(700);
const gave = await page.evaluate(() => window.__studio.giveItem('potion'));
const itemN1 = await page.evaluate(() => window.__studio.itemCountOf('potion'));
const coinsBeforeUse = await page.evaluate(() => window.__studio.coinsNow());
await page.evaluate(() => window.__studio.useItem('potion'));
const itemN0 = await page.evaluate(() => window.__studio.itemCountOf('potion'));
const coinsAfterUse = await page.evaluate(() => window.__studio.coinsNow());
const bought = await page.evaluate(() => window.__studio.buyItem('potion'));
const trEs = await page.evaluate(() => {
  window.__studio.applyScriptNow("api.setLang('es'); window.__probeTr = api.t('greet'); api.setLang('en');");
  return window.__probeTr;
});
const dbOk =
  gave === true && itemN1 === 1 && itemN0 === 0 && coinsAfterUse === coinsBeforeUse + 3 &&
  bought === true && trEs === 'Hola' && hierN > 4 && linkOk;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// PROJECT ORIGIN: a project remembers WHERE it lives, the toolbar says so,
// and — the part that matters — the credential never enters the game file.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const whereBefore = await page.evaluate(() => window.__studio.whereText());
const whereLabel = await page.evaluate(() =>
  window.__studio.setOriginGitHub({ owner: 'fabian', repo: 'my-games', branch: 'main', path: 'g.json' }),
);
const whereAfter = await page.evaluate(() => window.__studio.whereText());
const originKind = await page.evaluate(() => window.__studio.originNow().kind);
// Editing must show as unsaved.
await page.evaluate(() => window.__studio.addEntity('crate', 300, 300));
await sleep(150);
const syncDirty = await page.evaluate(() => window.__studio.syncState());
// The exported game must carry no origin, token or key of any kind.
const leaks = await page.evaluate(() => window.__studio.projectHasSecrets());
const exportedJson = await page.evaluate(() => window.__studio.exportJson());
await page.evaluate(() => window.__studio.setOriginDevice());
const originDevice = await page.evaluate(() => window.__studio.originNow().kind);
const originOk =
  whereBefore.includes('device') && whereLabel === 'fabian/my-games@main' &&
  whereAfter.includes('fabian/my-games') && originKind === 'github' &&
  syncDirty === 'dirty' && leaks.length === 0 &&
  !exportedJson.includes('my-games') && originDevice === 'device';

// ART LIBRARY: imported pictures are listed, reusable across actors,
// deletable without stranding anyone, and budget-counted.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const artId = await page.evaluate(() =>
  window.__studio.importAsset('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
);
const artList0 = await page.evaluate(() => window.__studio.assetList());
const artUnused = await page.evaluate(() => window.__studio.unusedAssets());
const artAssigned = await page.evaluate((id) => window.__studio.assignAsset('Hero', id), artId);
const artList1 = await page.evaluate(() => window.__studio.assetList());
const artBytes = await page.evaluate(() => window.__studio.assetBytes());
// The picture must actually render in Play, not merely be recorded.
await page.evaluate(() => window.__studio.play());
await sleep(800);
const artPlays = await page.evaluate(() => window.__studio.playVisibleCount());
const artCount = await page.evaluate(() => window.__studio.playEntityCount());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// Deleting must blank the reference rather than leave a dangling id.
const artCleared = await page.evaluate((id) => window.__studio.deleteAsset(id), artId);
const heroAfter = await page.evaluate(() => window.__studio.getEntity('Hero'));
// A 3D model gets an honest answer, not a silent failure.
const artReject = await page.evaluate(() => window.__studio.importReject('hero.glb', ''));
await page.evaluate(() => window.__studio.openAssets());
await sleep(200);
await page.screenshot({ path: `${outDir}/st-21-art.png` });
await page.keyboard.press('Escape');
await sleep(150);
const artModalClosed = await page.evaluate(() => !document.getElementById('modal-back')?.classList.contains('open'));
const artOk =
  artId.length > 0 && artList0.length === 1 && artUnused.length === 1 &&
  artAssigned === true && artList1[0].users === 1 && artBytes > 0 &&
  artPlays === artCount && artCleared === 1 && heroAfter.assetId === '' &&
  /2D/.test(artReject) && artModalClosed === true;

// DRAG-OFF SEARCH: drag a ⛓ Flow port into empty canvas, type, and the
// thing you pick arrives already wired to where you dragged from.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const nodeIds = await page.evaluate(() => window.__studio.flowNodeIds());
const dropOpened = await page.evaluate((id) => window.__studio.flowDropOff(id), nodeIds[0]);
const dropAll = await page.evaluate(() => window.__studio.paletteVisible());
const dropCoin = await page.evaluate(() => window.__studio.paletteQuery('coin'));
const dropHigh = await page.evaluate(() => window.__studio.paletteHighlighted());
await page.evaluate(() => window.__studio.paletteMove(1));
const dropMoved = await page.evaluate(() => window.__studio.paletteHighlighted());
await page.evaluate(() => window.__studio.paletteClose());
const dropClosedEmpty = await page.evaluate(() => window.__studio.paletteVisible());
// Commit one for real: a new level plus the door that reaches it.
const scenesBefore = await page.evaluate(() => window.__studio.sceneCount());
await page.evaluate((id) => window.__studio.flowDropOff(id), nodeIds[0]);
await page.evaluate(() => window.__studio.paletteCommit('lvl:new'));
const scenesAfter = await page.evaluate(() => window.__studio.sceneCount());
const lvlEvAfter = await page.evaluate(() => window.__studio.levelEventCount());
await page.screenshot({ path: `${outDir}/st-20-dropoff.png` });
const dropOk =
  dropOpened === true && dropAll.length > 20 && dropCoin[0] === 'act:coins' &&
  dropHigh === 'act:coins' && dropMoved !== dropHigh && dropClosedEmpty.length === 0 &&
  scenesAfter === scenesBefore + 1 && lvlEvAfter > 0;

// PROCEDURAL GAME MAKER: parameters in, a complete PLAYABLE game out —
// and what comes out has to survive Play, not merely validate on paper.
const genProblems = await page.evaluate(() =>
  window.__studio.genGame({
    seed: 42, genre: 'rpg', theme: 'dungeon', levels: 3, difficulty: 2,
    mechanics: { combat: true, collect: true, shop: true, dialogue: true, boss: true, skills: true },
  }),
);
await sleep(300);
const genName = await page.evaluate(() => window.__studio.projectName());
const genScenes = await page.evaluate(() => window.__studio.sceneCount());
const genFirst = await page.evaluate(() => window.__studio.sceneName());
await page.evaluate(() => window.__studio.play());
await sleep(900);
const genPlays = await page.evaluate(() => window.__studio.playEntityCount());
const genVisible = await page.evaluate(() => window.__studio.playVisibleCount());
const genOver = await page.evaluate(() => window.__studio.gameIsOver());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// Walk into a real level and confirm it is populated and winnable.
await page.evaluate(() => window.__studio.switchSceneByName('Vault 1'));
await page.evaluate(() => window.__studio.play());
await sleep(900);
const genMobs = await page.evaluate(() => window.__studio.mobCount());
const genLive = await page.evaluate(() => window.__studio.playVisibleCount());
await page.screenshot({ path: `${outDir}/st-19-generated.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// A cozy game must come out with no enemies at all, and still be winnable.
await page.evaluate(() => window.__studio.genGame({ seed: 3, genre: 'cozy', theme: 'candy', levels: 2 }));
await sleep(250);
await page.evaluate(() => window.__studio.switchSceneByName('Bakery 1'));
await page.evaluate(() => window.__studio.play());
await sleep(700);
const cozyMobs = await page.evaluate(() => window.__studio.mobCount());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
const gameGenOk =
  genProblems.length === 0 && genScenes === 4 && genFirst === 'Menu' && genName.length > 3 &&
  genPlays > 0 && genVisible === genPlays && genOver === false &&
  genMobs > 0 && genLive > genMobs && cozyMobs === 0;

// BRANCHING DIALOGUE: choices, conditions that update mid-conversation,
// and replies that run actions.
await page.evaluate(() => window.__studio.loadTemplate('rpg'));
await sleep(300);
const npc = 'Elder';
await page.evaluate((who) => {
  window.__studio.setDialogue(who, {
    start: 'greet',
    nodes: [
      {
        id: 'greet',
        text: 'Well met, traveller.',
        choices: [
          { text: 'Who are you?', to: 'who', actions: [{ cmd: 'switchOn', text: 'introduced' }] },
          { text: 'Got work?', to: 'work', ifSwitch: 'introduced', actions: [{ cmd: 'coins', n: 5 }] },
        ],
      },
      { id: 'who', text: 'The village elder.', next: 'greet' },
      { id: 'work', text: 'Clear the crypt.' },
    ],
  });
}, npc);
await page.evaluate(() => window.__studio.play());
await sleep(700);
// Open the conversation the way a player does — by tapping the NPC.
await page.evaluate((who) => window.__studio.tapEntity(who), npc);
await sleep(400);
const dlgAt = await page.evaluate(() => window.__studio.dialogueAt());
// Only the unconditional reply is offered before the switch is set.
const dlgFirst = await page.evaluate(() => window.__studio.dialogueOptions());
const coins0 = await page.evaluate(() => window.__studio.coinsNow());
await page.evaluate(() => window.__studio.dialoguePick(0));
await sleep(300);
const dlgWho = await page.evaluate(() => window.__studio.dialogueAt());
await page.evaluate(() => window.__studio.dialogueAdvance());
await sleep(300);
// Back at greet, the gated reply has appeared because the pick set a switch.
const dlgSecond = await page.evaluate(() => window.__studio.dialogueOptions());
await page.evaluate(() => window.__studio.dialoguePick(1));
await sleep(300);
const dlgWork = await page.evaluate(() => window.__studio.dialogueAt());
const coins1 = await page.evaluate(() => window.__studio.coinsNow());
await page.screenshot({ path: `${outDir}/st-27-dialogue.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);
const dialogueOk =
  dlgAt === 'greet' && dlgFirst.length === 1 && dlgWho === 'who' &&
  dlgSecond.length === 2 && dlgWork === 'work' && coins1 === coins0 + 5;

// TILE PLATFORMER: painted floors hold the player up, walls block, and a
// ledge is one-way. A level with NO tiles keeps the old flat ground.
await page.evaluate(() => {
  window.__studio.loadTemplate('topdown');
});
await sleep(250);
await page.evaluate(() => {
  window.__studio.setGravity(true);
  // A floor across the bottom, a ledge halfway up.
  for (let c = 0; c < 18; c++) window.__studio.setTile(c, 28, 'b');
  for (let c = 6; c < 12; c++) window.__studio.setTile(c, 20, 'l');
  window.__studio.setScript("api.player('Hero', 300);");
});
await page.evaluate(() => window.__studio.select('Hero'));
await page.evaluate(() => window.__studio.setProp('x', 360));
await page.evaluate(() => window.__studio.setProp('y', 300));
await page.evaluate(() => window.__studio.play());
// Wait for the fall to finish rather than betting on the frame rate.
await waitFor(() => page.evaluate(() => window.__studio.playerGrounded()), (g) => g === true);
// It should have fallen and be standing on the ledge (row 20 -> y 800).
const restY = await page.evaluate(() => window.__studio.getPlayPos('Hero').y);
const onGround = await page.evaluate(() => window.__studio.playerGrounded());
// Walking into the world edge must not escape the board.
await page.keyboard.down('ArrowLeft');
await sleep(900);
await page.keyboard.up('ArrowLeft');
const leftX = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
const fellY = await page.evaluate(() => window.__studio.getPlayPos('Hero').y);
await page.screenshot({ path: `${outDir}/st-28-platformer.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);
const platformOk =
  restY > 700 && restY < 820 && onGround === true && leftX >= 0 && leftX < 360 && fellY > restY;

// UNDO / REDO: an edit can be taken back, and taken back again.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const undoBefore = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => window.__studio.addEntity('crate', 200, 300));
await page.evaluate(() => window.__studio.addEntity('crate', 260, 300));
const undoAdded = await page.evaluate(() => window.__studio.entityCount());
const canUndo = await page.evaluate(() => window.__studio.historyState().canUndo);
const undoWhat = await page.evaluate(() => window.__studio.historyState().undoLabel);
await page.evaluate(() => window.__studio.undo());
const afterUndo1 = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => window.__studio.undo());
const afterUndo2 = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => window.__studio.redo());
const afterRedo = await page.evaluate(() => window.__studio.entityCount());
// A property edit is undoable too, and coalesces into ONE step.
await page.evaluate(() => window.__studio.select('Hero'));
await page.evaluate(() => window.__studio.setProp('x', 500));
await sleep(700);
await page.evaluate(() => window.__studio.setProp('x', 501));
await page.evaluate(() => window.__studio.setProp('x', 502));
await page.evaluate(() => window.__studio.undo());
const undoHeroX = await page.evaluate(() => window.__studio.getEntity('Hero').x);
// Ctrl+Z from the canvas drives the editor.
await page.evaluate(() => window.__studio.addEntity('crate', 300, 300));
const beforeKey = await page.evaluate(() => window.__studio.entityCount());
await page.keyboard.press('Control+z');
await sleep(200);
const afterKey = await page.evaluate(() => window.__studio.entityCount());
const undoOk =
  undoBefore > 0 && undoAdded === undoBefore + 2 && canUndo === true && undoWhat === 'add actor' &&
  afterUndo1 === undoBefore + 1 && afterUndo2 === undoBefore && afterRedo === undoBefore + 1 &&
  undoHeroX === 500 && afterKey === beforeKey - 1;

// MULTI-SELECT + CLIPBOARD: pick several actors, move them as one group,
// tidy them up, and copy them into a different level.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
const msA = await page.evaluate(() => window.__studio.addEntity('crate', 200, 300));
const msB = await page.evaluate(() => window.__studio.addEntity('crate', 240, 300));
const msC = await page.evaluate(() => window.__studio.addEntity('crate', 500, 360));
await page.evaluate((n) => window.__studio.select(n), msA);
await page.evaluate((n) => window.__studio.selectAdd(n), msB);
await page.evaluate((n) => window.__studio.selectAdd(n), msC);
const msNames = await page.evaluate(() => window.__studio.selectedNames());
const msTitle = await page.evaluate(() => window.__studio.inspectorTitle());
// Dragging one carries the rest, spacing intact.
await page.evaluate((n) => window.__studio.dragSel(n, 300, 500), msA);
const msDragged = await page.evaluate((n) => window.__studio.getEntity(n), msB);
// Arrow keys nudge the whole selection.
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
const msNudged = await page.evaluate((n) => window.__studio.getEntity(n).x, msB);
// Tidy: align tops, then space them evenly along the long axis.
await page.evaluate(() => window.__studio.alignSel('top'));
const msYs = await page.evaluate(() =>
  window.__studio.selectedNames().map((n) => window.__studio.getEntity(n).y),
);
await page.evaluate(() => window.__studio.distributeSel());
const msXs = await page.evaluate(() =>
  window.__studio.selectedNames().map((n) => window.__studio.getEntity(n).x),
);
await page.screenshot({ path: `${outDir}/st-29-multiselect.png` });
// A marquee over the whole board takes everything.
const msMarquee = await page.evaluate(() => window.__studio.marqueeSelect(-50, -50, 9000, 9000));
const msTotal = await page.evaluate(() => window.__studio.entityCount());
// And the same thing with a REAL mouse. This gets its own empty level with
// three crates at known spots: a rubber-band test that depends on where
// earlier steps happened to leave things is a test of the earlier steps.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(400);
const bandNames = await page.evaluate(() => [
  window.__studio.addEntity('crate', 200, 400),
  window.__studio.addEntity('crate', 340, 400),
  window.__studio.addEntity('crate', 620, 400),
]);
await sleep(300);
// Invert the editor's own client->design mapping from two samples.
const s0 = await page.evaluate(() => window.__studio.designAt(400, 300));
const s1 = await page.evaluate(() => window.__studio.designAt(600, 500));
const msScale = 200 / (s1.x - s0.x);
const toClient = (x, y) => ({ x: 400 + (x - s0.x) * msScale, y: 300 + (y - s0.y) * msScale });
await page.evaluate(() => window.__studio.marqueeSelect(-1, -1, -1, -1)); // start from nothing
// Band the first two, stopping well short of the third.
const bandFrom = toClient(120, 300);
const bandTo = toClient(460, 500);
await page.mouse.move(bandFrom.x, bandFrom.y);
await page.mouse.down();
await page.mouse.move((bandFrom.x + bandTo.x) / 2, (bandFrom.y + bandTo.y) / 2, { steps: 4 });
await page.mouse.move(bandTo.x, bandTo.y, { steps: 4 });
await page.screenshot({ path: `${outDir}/st-30-marquee.png` });
await page.mouse.up();
await sleep(200);
const msBand = await page.evaluate(() => window.__studio.selectedNames());
// Keyed by name, so a selection that changes size is a failed assertion
// rather than a crash in the harness.
const posOf = () =>
  page.evaluate(() =>
    Object.fromEntries(
      window.__studio.selectedNames().map((n) => {
        const e = window.__studio.getEntity(n);
        return [n, [e.x, e.y]];
      }),
    ),
  );
const msBefore = await posOf();
// Drag one of them 100 right / 60 down; every other one must follow exactly.
let msTowed = [];
const msNames0 = Object.keys(msBefore);
if (msNames0.length) {
  const grab = toClient(msBefore[msNames0[0]][0], msBefore[msNames0[0]][1]);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 100 * msScale, grab.y + 60 * msScale, { steps: 6 });
  await page.mouse.up();
  await sleep(200);
  const msAfterDrag = await posOf();
  msTowed = msNames0
    .filter((n) => msAfterDrag[n])
    .map((n) => [msAfterDrag[n][0] - msBefore[n][0], msAfterDrag[n][1] - msBefore[n][1]]);
}
// Back to the crates that were copied, for the paste test below.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(400);
const msA2 = await page.evaluate(() => window.__studio.addEntity('crate', 200, 300));
const msB2 = await page.evaluate(() => window.__studio.addEntity('crate', 300, 300));
const msC2 = await page.evaluate(() => window.__studio.addEntity('crate', 400, 300));
await page.evaluate((n) => window.__studio.select(n), msA2);
await page.evaluate((n) => window.__studio.selectAdd(n), msB2);
await page.evaluate((n) => window.__studio.selectAdd(n), msC2);

// Copy here, paste into a level that has never seen them.
const msCopied = await page.evaluate(() => window.__studio.copySel());
await page.evaluate(() => window.__studio.addScene('Paste Target'));
const msEmpty = await page.evaluate(() => window.__studio.entityCount());
const msPasted = await page.evaluate(() => window.__studio.pasteSel(360, 640));
const msAfter = await page.evaluate(() => window.__studio.entityCount());
// Delete the whole selection, and take it back with ONE undo.
await page.keyboard.press('Delete');
await sleep(150);
const msDeleted = await page.evaluate(() => window.__studio.entityCount());
await page.evaluate(() => window.__studio.undo());
const msUndone = await page.evaluate(() => window.__studio.entityCount());
// Ctrl+A then Ctrl+D from the keyboard, like a real author.
await page.keyboard.press('Control+a');
const msAll = await page.evaluate(() => window.__studio.selectedNames().length);
await page.keyboard.press('Control+d');
await sleep(200);
const msDup = await page.evaluate(() => window.__studio.entityCount());
const msUniqueNames = await page.evaluate(() => {
  const json = JSON.parse(window.__studio.exportJson());
  const scene = json.scenes.find((s) => s.name === 'Paste Target');
  return new Set(scene.entities.map((e) => e.name)).size === scene.entities.length;
});
const multiOk =
  msNames.length === 3 && msTitle.includes('3 actors') &&
  msDragged.x === 340 && msDragged.y === 500 && msNudged === 342 &&
  msYs.join() === '500,500,500' && msXs.join() === '302,452,602' &&
  msMarquee === msTotal &&
  msBand.includes(bandNames[0]) && msBand.includes(bandNames[1]) &&
  !msBand.includes(bandNames[2]) &&
  msTowed.length === msNames0.length && msNames0.length === 2 &&
  msTowed.every(([dx, dy]) => Math.abs(dx - 100) <= 1 && Math.abs(dy - 60) <= 1) &&
  msCopied === 3 && msPasted === 3 && msAfter === msEmpty + 3 &&
  msDeleted === msEmpty && msUndone === msEmpty + 3 &&
  msAll === msUndone && msDup === msUndone * 2 && msUniqueNames === true;

// ⚔ ENEMY ATTACK PATTERNS: each one puts something different in the air (or
// moves the enemy), and every one of them telegraphs first.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(300);
const atkMob = await page.evaluate(() => {
  const j = JSON.parse(window.__studio.exportJson());
  const m = j.scenes[0].entities.find((e) => e.kind === 'mob' || e.kind === 'boss');
  return m ? m.name : null;
});
// Count what one attack of each pattern leaves in the air.
const shotsFor = async (pattern) => {
  await page.evaluate(() => window.__studio.stop());
  await sleep(150);
  await page.evaluate(
    ([n, p]) => window.__studio.setAttack(n, p, 0.8),
    [atkMob, pattern],
  );
  await page.evaluate(() => window.__studio.play());
  await sleep(2200);
  const live = await page.evaluate(() => window.__studio.liveShots());
  return live;
};
const atkAimed = await shotsFor('aimed');
const atkSpread = await shotsFor('spread');
const atkRing = await shotsFor('ring');
// The telegraph: the enemy must spend real time winding up before anything
// happens, or "dodge it" is not advice a player can act on.
await page.evaluate(() => window.__studio.stop());
await sleep(150);
await page.evaluate(([n]) => window.__studio.setAttack(n, 'charge', 1.2), [atkMob]);
await page.evaluate(() => window.__studio.play());
let sawWindup = false;
let sawDash = false;
for (let i = 0; i < 40; i++) {
  const [w, d] = await page.evaluate(
    ([n]) => [window.__studio.mobWindup(n), window.__studio.mobDashing(n)],
    [atkMob],
  );
  if (w > 0) sawWindup = true;
  if (d) sawDash = true;
  if (sawWindup && sawDash) break;
  await sleep(100);
}
// Ground slam sends out a wave.
await page.evaluate(() => window.__studio.stop());
await sleep(150);
await page.evaluate(([n]) => window.__studio.setAttack(n, 'slam', 1), [atkMob]);
await page.evaluate(() => window.__studio.play());
let sawSlam = false;
for (let i = 0; i < 40; i++) {
  const t = await page.evaluate(([n]) => window.__studio.slamNow(n), [atkMob]);
  if (t >= 0) {
    sawSlam = true;
    break;
  }
  await sleep(100);
}
await page.screenshot({ path: `${outDir}/st-33-attacks.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// An old project that only said "shoots every N secs" still means one shot.
const atkLegacy = await page.evaluate(() => {
  const j = JSON.parse(window.__studio.exportJson());
  const m = j.scenes[0].entities.find((e) => e.kind === 'mob' || e.kind === 'boss');
  delete m.attack;
  m.shootEvery = 1.5;
  window.__studio.importJson(JSON.stringify(j));
  return window.__studio.attackOf(m.name);
});
const attackOk =
  !!atkMob && atkAimed >= 1 && atkSpread > atkAimed && atkRing > atkSpread &&
  sawWindup && sawDash && sawSlam && atkLegacy === 'aimed';

// 🥞 TILE LAYERS: paint behind and in front; only the main layer collides.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(300);
await page.evaluate(() => {
  window.__studio.setPaintLayer('back');
  for (let c = 0; c < 18; c++) window.__studio.setTile(c, 14, 'g');
  window.__studio.setPaintLayer('over');
  for (let c = 0; c < 18; c++) window.__studio.setTile(c, 6, 'k');
  window.__studio.setPaintLayer('main');
  for (let c = 0; c < 18; c++) window.__studio.setTile(c, 20, 'k');
});
await sleep(250);
const layBack = await page.evaluate(() => window.__studio.tileAt(3, 14, 'back'));
const layOver = await page.evaluate(() => window.__studio.tileAt(3, 6, 'over'));
const layMain = await page.evaluate(() => window.__studio.tileAt(3, 20, 'main'));
// Painting one layer must not touch another.
const layClean = await page.evaluate(() => window.__studio.tileAt(3, 14, 'main'));
await page.screenshot({ path: `${outDir}/st-34-layers.png` });
// In play: the decoration renders, and walking into a decorative wall works.
await page.evaluate(() => {
  window.__studio.setScript("api.player('Hero', 300);");
  window.__studio.play();
});
await sleep(900);
const layPlays = await page.evaluate(() => window.__studio.playHasTiles());
const layOverPlays = await page.evaluate(() => window.__studio.playHasOverTiles());
// Stand the player on the decorative row and push: nothing should stop them.
await page.evaluate(() =>
  window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=140; h.y=520;"),
);
await sleep(200);
await page.keyboard.down('d');
await sleep(700);
await page.keyboard.up('d');
const layWalkedThrough = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// Layers survive a save/load round-trip and a level resize.
const layRound = await page.evaluate(() => {
  window.__studio.importJson(window.__studio.exportJson());
  return [window.__studio.tileAt(3, 14, 'back'), window.__studio.tileAt(3, 6, 'over')];
});
const layersOk =
  layBack === 'g' && layOver === 'k' && layMain === 'k' && layClean === '.' &&
  layPlays === true && layOverPlays === true && layWalkedThrough > 200 &&
  layRound[0] === 'g' && layRound[1] === 'k';

// 🧱 GENERATED LEVELS + MOB WALLS: a generated maze has to be walkable, and
// enemies have to respect the walls the player does.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(400);
await page.evaluate(() => window.__studio.genTiles('maze'));
await sleep(300);
const genRows = await page.evaluate(() => window.__studio.tileRows());
const SOLID_CH = new Set(['w', 'k', 't', 'b']);
// The narrowest walkable run anywhere: a one-tile corridor is narrower than
// the character walking down it, which is what made mazes unplayable.
let narrowest = Infinity;
const scanRun = (get, len) => {
  let run = 0;
  for (let i = 0; i < len; i++) {
    if (get(i)) run++;
    else {
      if (run) narrowest = Math.min(narrowest, run);
      run = 0;
    }
  }
  if (run) narrowest = Math.min(narrowest, run);
};
for (let r = 0; r < genRows.length; r++) {
  scanRun((c) => !SOLID_CH.has(genRows[r][c] ?? '.'), genRows[0].length);
}
for (let c = 0; c < genRows[0].length; c++) {
  scanRun((r) => !SOLID_CH.has(genRows[r]?.[c] ?? '.'), genRows.length);
}
// Drop a fast chaser across the maze and watch where it ends up.
const wallMob = await page.evaluate(() => {
  const n = window.__studio.addEntity('mob', 620, 1100);
  window.__studio.select(n);
  window.__studio.setProp('moveSpeed', 220);
  return n;
});
await page.evaluate(() => {
  window.__studio.setScript("api.player('Hero', 300);");
  window.__studio.play();
});
await sleep(2500);
let mobInWall = 0;
for (let i = 0; i < 15; i++) {
  const pos = await page.evaluate((n) => window.__studio.getPlayPos(n), wallMob);
  if (SOLID_CH.has(genRows[Math.floor(pos.y / 40)]?.[Math.floor(pos.x / 40)] ?? '.')) mobInWall++;
  await sleep(120);
}
await page.screenshot({ path: `${outDir}/st-37-maze.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(200);
const terrainOk = narrowest >= 2 && mobInWall === 0;

// ▾ FOLDING PANEL: every heading collapses, and remembers it.
await page.evaluate(() => window.__studio.loadTemplate('quest'));
await sleep(500);
const foldRows0 = await page.evaluate(() => window.__studio.leftRowCount());
const foldHit = await page.evaluate(() => window.__studio.foldToggle('Props'));
await sleep(250);
const foldRows1 = await page.evaluate(() => window.__studio.leftRowCount());
const foldState = await page.evaluate(() => window.__studio.foldsNow());
await page.locator('#left').screenshot({ path: `${outDir}/st-38-folds.png` });
// It has to survive a reload, or folding is just a fidget.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
await sleep(600);
const foldRows2 = await page.evaluate(() => window.__studio.leftRowCount());
const foldKept = await page.evaluate(() => window.__studio.foldsNow());
// And unfold again.
await page.evaluate(() => window.__studio.foldToggle('Props'));
await sleep(250);
const foldRows3 = await page.evaluate(() => window.__studio.leftRowCount());
const foldOk =
  foldHit === true && foldRows1 < foldRows0 && foldState.length > 0 &&
  foldRows2 === foldRows1 && foldKept.length === foldState.length && foldRows3 === foldRows0;

// 💾 SAVE SLOTS: three separate runs, each remembering where it was.
// The quest template has three levels, which is what makes "continue" and
// "unlocked" mean anything.
await page.evaluate(() => window.__studio.loadTemplate('quest'));
await sleep(400);
// Wipe any slots left over from an earlier block so this starts honest.
await page.evaluate(() => window.__studio.play());
await sleep(700);
await page.evaluate(() => [1, 2, 3].forEach((n) => window.__studio.slotErase(n)));
await page.evaluate(() => window.__studio.stop());
await sleep(200);
// With a title screen up, NOTHING may be claimed until the player chooses a
// slot — otherwise every title screen shows a run nobody started.
await page.evaluate(() => {
  window.__studio.setScript("api.player('Hero', 300); api.title();");
  window.__studio.play();
});
await waitFor(() => page.evaluate(() => window.__studio.titleVisible()), (v) => v === true);
await sleep(600);
const slotFresh = await page.evaluate(() => window.__studio.saveSlots().map((s) => s.used));
// Choosing a slot is what starts recording into it.
await page.evaluate(() => window.__studio.slotPick(1, true));
await sleep(600);
await page.evaluate(() => window.__studio.applyScriptNow("api.goto('Village')"));
await sleep(900);
const slotAfterEnter = await page.evaluate(() => window.__studio.saveSlots()[0]);
const slotLevel = slotAfterEnter ? slotAfterEnter.level : '';
// Progression: only the level you finished, plus the next one, are open.
const slotUnlocked1 = await page.evaluate(() => window.__studio.unlockedLevels());
await page.evaluate(() => window.__studio.levelDone());
await sleep(400);
const slotUnlocked2 = await page.evaluate(() => window.__studio.unlockedLevels());
// A second slot is a separate run: starting it must not touch the first.
await page.evaluate(() => window.__studio.slotPick(2, true));
await sleep(900);
const slotTwo = await page.evaluate(() => window.__studio.slotNow());
const slotBackAgain = await page.evaluate(() => window.__studio.saveSlots()[0]);
await page.screenshot({ path: `${outDir}/st-36-slots.png` });
// Erasing one leaves the others alone.
await page.evaluate(() => window.__studio.slotErase(1));
await sleep(300);
const slotErased = await page.evaluate(() => window.__studio.saveSlots().map((s) => s.used));
// The slot survives a level change, which rebuilds the whole play scene.
await page.evaluate(() => window.__studio.applyScriptNow("api.goto('Boss Lair')"));
await sleep(900);
const slotCarried = await page.evaluate(() => window.__studio.slotNow());
await page.evaluate(() => window.__studio.stop());
await sleep(200);
const slotsOk =
  // Merely opening the game must not claim a slot — until you pick one,
  // every slot on the title screen still reads "Empty".
  slotFresh.every((u) => u === false) &&
  slotLevel === 'Village' &&
  // Standing in Village opens Menu + Village, and nothing past them.
  slotUnlocked1.join() === 'Menu,Village' &&
  // Finishing Village opens the level after it.
  slotUnlocked2.length === slotUnlocked1.length + 1 &&
  slotTwo === 2 &&
  // Slot 1 still holds its run after slot 2 was started.
  !!slotBackAgain && slotBackAgain.used === true && slotBackAgain.level === 'Village' &&
  slotErased[0] === false && slotErased[1] === true &&
  slotCarried === 2;

// SELECTION RING: the highlight has to sit ON the actor — after panning a
// tall level (the ring used to live on the un-scrolling stage and drift off
// entirely) and in a 2.5D level (where actors are scaled by depth).
const ringHugs = (s) =>
  !!s &&
  s.ring.x <= s.view.x && s.ring.y <= s.view.y &&
  s.ring.x + s.ring.w >= s.view.x + s.view.w &&
  s.ring.y + s.ring.h >= s.view.y + s.view.h &&
  // ...and snugly: a ring three times the size of the art is not a highlight.
  s.ring.w < s.view.w + 40 && s.ring.h < s.view.h + 40;
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(300);
await page.evaluate(() => window.__studio.setWorldSize(720, 2560));
await sleep(400);
const ringName = await page.evaluate(() => window.__studio.addEntity('crate', 300, 300));
await sleep(200);
const ringFlat = await page.evaluate(() => window.__studio.selectionBoxes());
await page.mouse.move(600, 400);
for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 60);
await sleep(300);
await page.evaluate((n) => window.__studio.select(n), ringName);
await sleep(200);
const ringPanned = await page.evaluate(() => window.__studio.selectionBoxes());
// 2.5D: the view is depth-scaled, so a ring sized from def.scale alone drifts.
await page.evaluate(() => window.__studio.loadTemplate('blank'));
await sleep(300);
await page.evaluate(() => window.__studio.setView('depth'));
await sleep(500);
const ringDeep = [];
for (const y of [260, 650]) {
  const n = await page.evaluate((yy) => window.__studio.addEntity('mob', 300, yy), y);
  await sleep(300);
  await page.evaluate((nn) => window.__studio.select(nn), n);
  await sleep(200);
  ringDeep.push(await page.evaluate(() => window.__studio.selectionBoxes()));
}
await page.screenshot({ path: `${outDir}/st-31-ring.png` });
const ringOk = ringHugs(ringFlat) && ringHugs(ringPanned) && ringDeep.every(ringHugs);

// 🧰 TOOLBAR: ▶ Play used to fall off the right-hand edge with no way to
// reach it. Nothing may ever be off-screen, at any window size.
const barAt = async (w, h) => {
  await page.setViewportSize({ width: w, height: h });
  await sleep(400);
  return page.evaluate(() => ({
    hidden: window.__studio.toolbarOverflow(),
    play: window.__studio.onScreen('btn-play'),
    more: window.__studio.onScreen('btn-more'),
    scene: window.__studio.onScreen('scene-select'),
  }));
};
const barWide = await barAt(1920, 900);
const barMid = await barAt(1280, 860);
const barNarrow = await barAt(900, 800);
// The ⋯ panel really holds the missing controls, and closes again.
await page.evaluate(() => window.__studio.toolbarOpen());
await sleep(200);
const barPanelOpen = await page.evaluate(() => window.__studio.toolbarIsOpen());
const barPanelHas = await page.evaluate(
  () => document.querySelectorAll('#top-more .btn, #top-more label').length,
);
await page.screenshot({ path: `${outDir}/st-32-toolbar.png` });
await page.evaluate(() => window.__studio.toolbarClose());
await sleep(150);
const barPanelShut = await page.evaluate(() => window.__studio.toolbarIsOpen());
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(400);
const toolbarOk =
  [barWide, barMid, barNarrow].every((b) => b.play && b.scene) &&
  // Wide enough for everything: no menu at all. Narrow: a menu, and it grows.
  barWide.hidden.length === 0 && !barWide.more &&
  barNarrow.more && barNarrow.hidden.length > barMid.hidden.length &&
  barPanelOpen === true && barPanelHas > 0 && barPanelShut === false;

// HUD LAYOUT: a piece moved in the editor lands there in the running game,
// and safe areas push it clear of a notch.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(300);
const hudDefault = await page.evaluate(() => window.__studio.hudNow());
const moved = await page.evaluate(() => window.__studio.hudMove('hearts', 700, 1200));
await page.evaluate(() => window.__studio.hudSet('score', { show: false }));
await page.evaluate(() => window.__studio.play());
await sleep(800);
const heartsAt = await page.evaluate(() => window.__studio.hudScreenPos('hearts'));
const scoreAt = await page.evaluate(() => window.__studio.hudScreenPos('score'));
await page.evaluate(() => window.__studio.hudSafe(60, 40));
await sleep(200);
const heartsSafe = await page.evaluate(() => window.__studio.hudScreenPos('hearts'));
await page.screenshot({ path: `${outDir}/st-25-hud.png` });
await page.evaluate(() => window.__studio.stop());
await sleep(150);
await page.evaluate(() => window.__studio.openHud());
await sleep(250);
await page.screenshot({ path: `${outDir}/st-26-hud-editor.png` });
await page.keyboard.press('Escape');
await sleep(150);
const hudOk =
  hudDefault === null && moved.anchor === 'bottom-right' &&
  heartsAt.x > 400 && heartsAt.y > 400 && scoreAt.visible === false &&
  heartsSafe.y === heartsAt.y - 40;

// MENUS: the ⚙ settings and ⏸ pause screens exist, pause the game, and are
// reachable from a no-code button action.
await page.evaluate(() => window.__studio.loadTemplate('hushfall'));
await sleep(300);
await page.evaluate(() => window.__studio.switchSceneByName('The Grounds'));
await page.evaluate(() => window.__studio.playSolo());
await sleep(800);
await page.evaluate(() => window.__studio.applyScriptNow('api.menu.pause();'));
await sleep(250);
const pauseOpen = await page.evaluate(() => window.__studio.menuVisible());
const pausedMove = await page.evaluate(() => window.__studio.gamePaused());
await page.screenshot({ path: `${outDir}/st-23-pause.png` });
await page.evaluate(() => window.__studio.applyScriptNow('api.menu.settings();'));
await sleep(250);
const settingsOpen = await page.evaluate(() => window.__studio.menuVisible());
await page.screenshot({ path: `${outDir}/st-24-settings.png` });
await page.evaluate(() => window.__studio.applyScriptNow('api.menu.close();'));
await sleep(200);
const menuClosed = await page.evaluate(() => window.__studio.menuVisible());
const resumed = await page.evaluate(() => window.__studio.gamePaused());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// The three real games load, and the menu button action is wired with no code.
const gameTemplates = {};
for (const id of ['blobvale', 'bloomstead', 'hushfall']) {
  await page.evaluate((t) => window.__studio.loadTemplate(t), id);
  await sleep(250);
  gameTemplates[id] = {
    scenes: await page.evaluate(() => window.__studio.sceneCount()),
    first: await page.evaluate(() => window.__studio.sceneName()),
  };
}
const menuOk =
  pauseOpen === true && pausedMove === true && settingsOpen === true &&
  menuClosed === false && resumed === false &&
  gameTemplates.blobvale.scenes === 3 && gameTemplates.blobvale.first === 'Menu' &&
  gameTemplates.bloomstead.scenes === 2 && gameTemplates.hushfall.scenes === 2;

// ACTOR-OWNED ABILITIES: create one with no code, give it to an actor, and
// it becomes a working on-screen button when that actor is the player.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(300);
const abId = await page.evaluate(() => window.__studio.createAbility('Cleave'));
await page.evaluate((id) => window.__studio.setAbility(id, { effect: 'melee', power: 5, radius: 4000, cooldown: 0 }), abId);
const granted = await page.evaluate((id) => window.__studio.grantAbility('Hero', id, true), abId);
const heroAbilities = await page.evaluate(() => window.__studio.abilitiesOf('Hero'));
await page.evaluate(() => window.__studio.play());
await sleep(800);
const abCount = await page.evaluate(() => window.__studio.abilityCount());
const mobsBefore = await page.evaluate(() => window.__studio.mobCount());
// Firing the BUTTON (not a script call) must actually damage enemies.
await page.evaluate(() => window.__studio.fireAbility('Cleave'));
await sleep(300);
await page.evaluate(() => window.__studio.fireAbility('Cleave'));
await sleep(400);
const mobsAfter = await page.evaluate(() => window.__studio.mobCount());
await page.evaluate(() => window.__studio.stop());
await sleep(250);
// The inspector is where this feature lives — show it selecting the Hero.
await page.evaluate(() => window.__studio.select('Hero'));
await sleep(200);
await page.screenshot({ path: `${outDir}/st-22-abilities.png` });
// A heal ability restores hearts, proving the effect list is not just melee.
const healId = await page.evaluate(() => window.__studio.createAbility('Mend'));
await page.evaluate((id) => window.__studio.setAbility(id, { effect: 'heal', power: 2, cooldown: 0 }), healId);
await page.evaluate((id) => window.__studio.grantAbility('Hero', id, true), healId);
// A SKILL NODE can hand out an ability when invested in.
await page.evaluate((id) => {
  window.__studio.setSkillTreeDb('paths', {
    points: 3,
    branches: [{ id: 'war', name: 'WAR', nodes: [{ id: 'unlock-mend', name: 'Mend', emoji: 'heart', cost: 1, maxRank: 1, tier: 0, grants: id }] }],
  });
  window.__studio.setActorSkillTree('Hero', 'paths');
}, healId);
// Take it away so only the skill node can grant it back.
await page.evaluate((id) => window.__studio.grantAbility('Hero', id, false), healId);
await page.evaluate(() => window.__studio.play());
await sleep(800);
const beforeUnlock = await page.evaluate(() => window.__studio.abilityCount());
await page.evaluate(() => window.__studio.skillInvest('unlock-mend'));
await sleep(300);
const afterUnlock = await page.evaluate(() => window.__studio.abilityCount());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
const abilityOk =
  abId === 'cleave' && granted === true && heroAbilities.includes('cleave') &&
  abCount >= 3 && mobsBefore > 0 && mobsAfter < mobsBefore &&
  afterUnlock === beforeUnlock + 1;

// BRANCHED SKILL TREE: three coloured paths, multi-rank cells, and tiers
// that only open once enough points are spent IN THAT branch.
await page.evaluate(() => window.__studio.loadTemplate('vault'));
await sleep(300);
await page.evaluate(() => window.__studio.play());
await sleep(800);
const brN = await page.evaluate(() => window.__studio.skillBranchCount());
await page.evaluate(() => window.__studio.skillAddPoints(12));
await page.evaluate(() => window.__studio.skillOpen());
const skOpen = await page.evaluate(() => window.__studio.skillIsOpen());
const layout = await page.evaluate(() => window.__studio.skillLayout());
// Multi-rank: invest three times in one cell.
await page.evaluate(() => {
  window.__studio.skillInvest('muscle');
  window.__studio.skillInvest('muscle');
  window.__studio.skillInvest('muscle');
});
const rank3 = await page.evaluate(() => window.__studio.skillRank('muscle'));
// Spend in a DIFFERENT branch — the brawler tier must stay shut.
await page.evaluate(() => {
  for (let i = 0; i < 5; i++) window.__studio.skillInvest('steady');
});
const crossBranch = await page.evaluate(() => window.__studio.skillCanInvest('cleave'));
// Now finish the 5 in brawler and it opens.
await page.evaluate(() => {
  window.__studio.skillInvest('muscle');
  window.__studio.skillInvest('muscle');
});
const sameBranch = await page.evaluate(() => window.__studio.skillCanInvest('cleave'));
const spentBrawl = await page.evaluate(() => window.__studio.skillSpentIn('brawl'));
const refunded = await page.evaluate(() => window.__studio.skillRespec());
const afterRespec = await page.evaluate(() => window.__studio.skillRank('muscle'));
await page.screenshot({ path: `${outDir}/st-18-skills.png` });
const skillsBranchOk =
  brN === 3 && skOpen === true && layout.cols >= 1 && layout.fit > 0.5 && layout.cell >= 60 && rank3 === 3 &&
  crossBranch === 'needsTier' && sameBranch === 'ok' && spentBrawl === 5 &&
  refunded === 10 && afterRespec === 0;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// KEYBOARD: real key presses must move the hero. Nothing in this playtest
// pressed a key before, so a movement regression could ship green.
await page.evaluate(() => window.__studio.loadTemplate('topdown'));
await sleep(300);
await page.evaluate(() => window.__studio.play());
await sleep(700);
const kx0 = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
await page.keyboard.down('d');
await sleep(450);
await page.keyboard.up('d');
const kxD = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
await page.keyboard.down('ArrowLeft');
await sleep(450);
await page.keyboard.up('ArrowLeft');
const kxL = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
const ky0 = await page.evaluate(() => window.__studio.getPlayPos('Hero').y);
await page.keyboard.down('s');
await sleep(400);
await page.keyboard.up('s');
const kyS = await page.evaluate(() => window.__studio.getPlayPos('Hero').y);
const keysOk = kxD > kx0 + 20 && kxL < kxD - 20 && kyS > ky0 + 20;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// CONTROLS: rebinding must actually change what the keyboard does. This is
// the whole point of the feature — data, not literals in the update loop.
await page.evaluate(() => window.__studio.resetControls());
const defRight = await page.evaluate(() => window.__studio.keysOf('move-right'));
// Bind J to move-right, and drop the defaults so only J can drive it.
await page.evaluate(() => window.__studio.bindKey('move-right', 'j'));
await page.evaluate(() => window.__studio.unbindKey('move-right', 'd'));
await page.evaluate(() => window.__studio.unbindKey('move-right', 'arrowright'));
const reboundRight = await page.evaluate(() => window.__studio.keysOf('move-right'));
await page.evaluate(() => window.__studio.play());
const rx0 = await waitFor(
  () => page.evaluate(() => window.__studio.getPlayPos('Hero').x),
  (x) => x > 0,
);
await page.keyboard.down('d');
await sleep(350);
await page.keyboard.up('d');
const rxOldKey = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
await page.keyboard.down('j');
await sleep(350);
await page.keyboard.up('j');
const rxNewKey = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
await page.evaluate(() => window.__studio.stop());
await sleep(150);
// Custom actions, deletion rules, and conflict reporting.
const addedCustom = await page.evaluate(() => window.__studio.addAction('Dash'));
const killBuiltin = await page.evaluate(() => window.__studio.removeAction('move-left'));
const killCustom = await page.evaluate(() => window.__studio.removeAction('Dash'));
await page.evaluate(() => window.__studio.bindKey('interact', 'a'));
const conflicts = await page.evaluate(() => window.__studio.keyConflicts());
await page.evaluate(() => window.__studio.resetControls());
const controlsOk =
  defRight.join(',') === 'arrowright,d' && reboundRight.join(',') === 'j' &&
  rxOldKey === rx0 && rxNewKey > rx0 + 20 &&
  addedCustom === true && killBuiltin === false && killCustom === true &&
  conflicts.includes('a');

// SCRIPTING PALETTE: the 🔍 command dock finds api calls, inserts working
// code at the cursor, and script failures render in the panel (not alert()).
const apiAll = await page.evaluate(() => window.__studio.apiSearch(''));
const apiHit = await page.evaluate(() => window.__studio.apiSearch('coin'));
const apiFuzzy = await page.evaluate(() => window.__studio.apiSearch('apmusic'));
await page.evaluate(() => window.__studio.setScript(''));
const inserted = await page.evaluate(() => window.__studio.apiInsert('api.hearts'));
const codeAfter = await page.evaluate(() => window.__studio.codeText());
// A bad script must surface in the panel with a readable hint, not a dialog.
await page.evaluate(() => window.__studio.play());
await sleep(400);
await page.evaluate(() => window.__studio.applyScriptNow('apu.player("Hero")'));
await sleep(200);
const scriptErr = await page.evaluate(() => window.__studio.scriptError());
await page.evaluate(() => window.__studio.stop());
await sleep(150);
const apiOk =
  apiAll.length > 30 && apiHit[0] === 'api.coins' && apiFuzzy.includes('api.music') &&
  inserted === true && codeAfter.includes('api.hearts(3)') && /apu/.test(scriptErr);

// LEVEL EVENTS: the level itself carries ⚡ events — start music, tick a
// timer, tap empty ground, and win when the last enemy goes down.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(300);
await page.evaluate(() =>
  window.__studio.setLevelEvents([
    { trigger: 'start', actions: [{ cmd: 'music', text: 'battle' }] },
    { trigger: 'every', every: 0.2, actions: [{ cmd: 'var', text: 'ticks', n: 1 }] },
    { trigger: 'tap', actions: [{ cmd: 'switchOn', text: 'tapped-ground' }] },
    { trigger: 'cleared', actions: [{ cmd: 'win', text: 'ROOM CLEAR' }] },
  ]),
);
const lvlEvN = await page.evaluate(() => window.__studio.levelEventCount());
await page.evaluate(() => window.__studio.play());
// This is a "does the timer run" assertion, not a "how fast" one, so wait
// for the ticks rather than betting on the frame rate.
const lvlTicks = await waitFor(
  () => page.evaluate(() => window.__studio.varNow('ticks')),
  (n) => n >= 2,
);
const lvlMusic = await page.evaluate(() => window.__studio.musicNow());
await page.evaluate(() => window.__studio.tapLevel());
const lvlTap = await page.evaluate(() => window.__studio.switchIsOn('tapped-ground'));
// 'cleared' must NOT have fired while mobs are still alive.
const lvlMobs = await page.evaluate(() => window.__studio.mobCount());
const lvlEarly = await page.evaluate(() => window.__studio.gameIsOver());
// Kill every mob and the level's own win event should fire.
await page.evaluate(() => {
  window.__studio.applyScriptNow('for (var i = 0; i < 40; i++) api.meleeAttack(4000, 99);');
});
await sleep(500);
const lvlCleared = await page.evaluate(() => window.__studio.gameIsOver());
const levelEvOk =
  lvlEvN === 4 && lvlMusic === 'battle' && lvlTicks >= 2 && lvlTap === true &&
  lvlMobs > 0 && lvlEarly === false && lvlCleared === true;
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// QUEST CAPSTONE: menu button -> village; shop opens; chests bump the
// variable; the gate stays shut at 1 and opens at 2 into the boss lair.
await page.evaluate(() => window.__studio.loadTemplate('quest'));
await sleep(300);
await page.evaluate(() => window.__studio.play());
await sleep(700);
const qScene0 = await page.evaluate(() => window.__studio.sceneName());
await page.evaluate(() => window.__studio.applyScriptNow("api.goto('Village')"));
await sleep(700);
await page.evaluate(() => window.__studio.applyScriptNow('api.shop.open()'));
const qShop = await page.evaluate(() => window.__studio.shopVisible());
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=560; h.y=380;"));
await sleep(400);
const qVar1 = await page.evaluate(() => window.__studio.varNow('chests'));
// gate must stay shut with one chest
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=560; h.y=900;"));
await sleep(400);
const qStillVillage = await page.evaluate(() => window.__studio.sceneName());
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=160; h.y=760;"));
await sleep(400);
const qVar2 = await page.evaluate(() => window.__studio.varNow('chests'));
await page.evaluate(() => window.__studio.applyScriptNow("var h=api.entity('Hero'); h.x=560; h.y=900;"));
await sleep(700);
const qScene2 = await page.evaluate(() => window.__studio.sceneName());
const questOk =
  qScene0 === 'Menu' && qShop === true && qVar1 === 1 && qStillVillage === 'Village' &&
  qVar2 === 2 && qScene2 === 'Boss Lair';
await page.evaluate(() => window.__studio.stop());
await sleep(150);

// FLOW TAB + PANEL + TITLE SCREEN: the visual scripting map renders nodes
// for the event-built actors; the bottom panel minimizes and restores; and
// api.title() pauses on a save-slot screen until a choice is made.
const flowN = await page.evaluate(() => window.__studio.flowNodes());
await page.evaluate(() => window.__studio.togglePanel());
const minOn = await page.evaluate(() => window.__studio.panelMinimized());
await page.evaluate(() => window.__studio.togglePanel());
const minOff = await page.evaluate(() => window.__studio.panelMinimized());
// ⇱ Undock: floating survives a reload, and undocking clears minimize.
await page.evaluate(() => window.__studio.toggleFloat());
const floatOn = await page.evaluate(() => window.__studio.panelFloating());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
await sleep(400);
const floatKept = await page.evaluate(() => window.__studio.panelFloating());
await page.evaluate(() => window.__studio.toggleFloat());
const floatOff = await page.evaluate(() => window.__studio.panelFloating());
await page.evaluate(() => {
  window.__studio.setScript("api.player('Hero', 300); api.title();");
  window.__studio.play();
});
const titleShown = await waitFor(
  () => page.evaluate(() => window.__studio.titleVisible()),
  (v) => v === true,
);
await page.screenshot({ path: `${outDir}/st-14-title.png` });
await page.evaluate(() => window.__studio.titlePick('new'));
const titleGone = await page.evaluate(() => window.__studio.titleVisible());
const uiOk = flowN >= 3 && minOn === true && minOff === false && titleShown === true && titleGone === false &&
  floatOn === true && floatKept === true && floatOff === false;
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
const mazePlays = await waitFor(
  () => page.evaluate(() => window.__studio.playHasTiles()),
  (v) => v === true,
);
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

// 🛰 HOST AUTHORITY: one machine runs the enemies, the other renders them.
// The action template has mobs, so both sides load it and host/join again.
await page.evaluate(() => window.__studio.loadTemplate('action'));
await pageB.evaluate(() => window.__studio.loadTemplate('action'));
await sleep(400);
await page.evaluate(() => window.__studio.setMultiplayer(true));
await pageB.evaluate(() => window.__studio.setMultiplayer(true));
const authCode = await page.evaluate(() => window.__studio.netHost());
await pageB.evaluate((c) => window.__studio.netJoin(c), authCode);
await sleep(1800);
const roleA = await page.evaluate(() => window.__studio.netRole());
const roleB = await pageB.evaluate(() => window.__studio.netRole());
// The host describes the world; the joiner receives it.
const worldB = await waitFor(
  () => pageB.evaluate(() => window.__studio.netWorld()),
  (w) => !!w && w.mobs.length > 0,
);
const authMobs = worldB ? worldB.mobs.length : 0;
const authMobName = worldB?.mobs[0]?.n ?? '';
// Both sides agree on where that enemy is, without either simulating twice.
const posOn = (pg, name) =>
  pg.evaluate((n) => window.__studio.getPlayPos(n), name);
await sleep(900);
const authHostPos = await posOn(page, authMobName);
const authJoinPos = await posOn(pageB, authMobName);
const authAgree =
  Math.abs(authHostPos.x - authJoinPos.x) < 90 && Math.abs(authHostPos.y - authJoinPos.y) < 90;
// A joiner's hit is a REQUEST: the host applies it, and the new HP comes
// back to the joiner in a snapshot rather than being invented locally.
const hpBefore = await page.evaluate((n) => window.__studio.mobHp(n), authMobName);
await pageB.evaluate((n) => window.__studio.netRequestHit(n, 1), authMobName);
const hpAfter = await waitFor(
  () => page.evaluate((n) => window.__studio.mobHp(n), authMobName),
  (hp) => hp < hpBefore,
);
const hpSeenByJoiner = await waitFor(
  () => pageB.evaluate(() => window.__studio.netWorld()),
  (w) => !!w && (w.mobs.find((m) => m.n === authMobName)?.hp ?? 99) <= hpAfter,
);
const joinerSawHp = hpSeenByJoiner?.mobs.find((m) => m.n === authMobName)?.hp ?? -1;
// A hit on an enemy that does not exist must change nothing at all.
const mobsBeforeJunk = await page.evaluate(() => window.__studio.mobCount());
await pageB.evaluate(() => window.__studio.netRequestHit('NoSuchMonster', 99));
await sleep(400);
const mobsAfterJunk = await page.evaluate(() => window.__studio.mobCount());
const linkB = await pageB.evaluate(() => window.__studio.netLink());
await pageB.screenshot({ path: `${outDir}/st-35-authority.png` });
await page.evaluate(() => window.__studio.stop());
await pageB.evaluate(() => window.__studio.stop());
const authorityOk =
  roleA === 'host' && roleB === 'joiner' && authMobs > 0 && !!authMobName &&
  authAgree && hpBefore > 0 && hpAfter === hpBefore - 1 && joinerSawHp === hpAfter &&
  mobsAfterJunk === mobsBeforeJunk && linkB === 'live';

await browser.close();
relay.kill();
aiBridge.kill();

const ok =
  placeOk && editOk && storyOk && levelsOk && playOk && stopOk && exportOk && importOk &&
  templatesOk && skillsOk && scoreOk && tilesOk && cameraOk && frameOk && combatOk && rangedOk &&
  patrolOk && chatOk && coinsOk && persistOk && libOk && eventsOk && genOk && uiOk && dbOk &&
  questOk && levelEvOk && apiOk && keysOk && controlsOk && skillsBranchOk && gameGenOk && dropOk && artOk && originOk && abilityOk && menuOk && undoOk && hudOk && dialogueOk && platformOk && multiOk && ringOk && toolbarOk && attackOk && layersOk && netOk && authorityOk && slotsOk && terrainOk && foldOk &&
  errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok, placeOk, editOk, storyOk, levelsOk, playOk, playCount, stopOk, exportOk, importOk,
      templatesOk, templates, skillsOk, skillNodes, stormEarly, strength, scoreOk, score,
      tilesOk, tileBefore, tilePainted, tilesPersist, playTiles, heroX,
      cameraOk, worldSize, heroX2, camX, heroY2, horizonOk, heroScale, subtleOk, frameOk,
      jumpOk, zMid, zLand, yPlain, ySteer, camDirOk, camPanX, camHeld, camReleased,
      combatOk, musicOk, music, vfx, outfitOk, outfit, mobCount0, abilities, bossBar, chaseOk, gap0, gap1, hp0, hp1, mobsLeft, xp, level, hearts,
      rangedOk, shots, enraged, patrolOk, gardenerX,
      chatOk, bridged, chatCount0, chatCount1,
      coinsOk, coins, persistOk, savedQuest, xpBefore, xpRestored,
      libOk, libId, savedName, restoredName, libCount,
      eventsOk, evCoins0, evCoinsGated, evScore, evSwitch, evCount0, evCount1, evCoins1,
      genOk, mazeHasWalls, mazePlays, islandLive,
      uiOk, flowN, minOn, minOff, floatOn, floatKept, floatOff, titleShown, titleGone,
      dbOk, hierN, linkOk, linkSwitch, itemN1, itemN0, coinsBeforeUse, coinsAfterUse, bought, trEs,
      questOk, qScene0, qShop, qVar1, qStillVillage, qVar2, qScene2,
      levelEvOk, lvlEvN, lvlMusic, lvlTicks, lvlTap, lvlMobs, lvlEarly, lvlCleared,
      apiOk, apiN: apiAll.length, apiHit0: apiHit[0], inserted, scriptErr,
      keysOk, kx0, kxD, kxL, ky0, kyS,
      controlsOk, defRight, reboundRight, rx0, rxOldKey, rxNewKey, addedCustom, killBuiltin, killCustom, conflicts,
      dialogueOk, dlgAt, dlgFirst, dlgWho, dlgSecond, dlgWork, coins0, coins1,
      platformOk, restY, onGround, leftX, fellY,
      attackOk, atkMob, atkAimed, atkSpread, atkRing, sawWindup, sawDash, sawSlam, atkLegacy,
      layersOk, layBack, layOver, layMain, layClean, layPlays, layOverPlays, layWalkedThrough, layRound,
      ringOk, ringFlat, ringPanned, ringDeep,
      toolbarOk, barWide, barMid, barNarrow, barPanelOpen, barPanelHas, barPanelShut,
      multiOk, msNames, msTitle, bandNames, msDragged, msNudged, msYs, msXs, msMarquee, msTotal, msBand, msTowed,
      msCopied, msEmpty, msPasted, msAfter, msDeleted, msUndone, msAll, msDup, msUniqueNames,
      undoOk, undoBefore, undoAdded, undoWhat, afterUndo1, afterUndo2, afterRedo, undoHeroX, beforeKey, afterKey,
      hudOk, moved, heartsAt, scoreAt, heartsSafe,
      menuOk, pauseOpen, pausedMove, settingsOpen, menuClosed, resumed, gameTemplates,
      abilityOk, abId, granted, heroAbilities, abCount, mobsBefore, mobsAfter, beforeUnlock, afterUnlock,
      skillsBranchOk, brN, skOpen, layout, rank3, crossBranch, sameBranch, spentBrawl, refunded, afterRespec,
      gameGenOk, genProblems, genName, genScenes, genFirst, genPlays, genVisible, genMobs, genLive, cozyMobs,
      originOk, whereBefore, whereLabel, whereAfter, originKind, syncDirty, leaks, originDevice,
      artOk, artId, artUnused, artModalClosed, artAssigned, artBytes, artPlays, artCount, artCleared, artReject,
      dropOk, dropOpened, dropN: dropAll.length, dropCoin0: dropCoin[0], dropHigh, dropMoved, scenesBefore, scenesAfter, lvlEvAfter,
      netOk, playersA, playersB, remotesB, moveOk, remotePosB, stateB,
      authorityOk, roleA, roleB, authMobs, authMobName, authHostPos, authJoinPos, authAgree,
      hpBefore, hpAfter, joinerSawHp, mobsBeforeJunk, mobsAfterJunk, linkB,
      terrainOk, narrowest, mobInWall,
      foldOk, foldRows0, foldRows1, foldRows2, foldRows3, foldState, foldKept,
      slotsOk, slotFresh, slotAfterEnter, slotLevel, slotUnlocked1, slotUnlocked2, slotTwo,
      slotBackAgain, slotErased, slotCarried,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
