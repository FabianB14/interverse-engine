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
await sleep(1500);
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
await sleep(700);
const rx0 = await page.evaluate(() => window.__studio.getPlayPos('Hero').x);
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
await sleep(800);
const lvlMusic = await page.evaluate(() => window.__studio.musicNow());
const lvlTicks = await page.evaluate(() => window.__studio.varNow('ticks'));
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
await sleep(700);
const titleShown = await page.evaluate(() => window.__studio.titleVisible());
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
  patrolOk && chatOk && coinsOk && persistOk && libOk && eventsOk && genOk && uiOk && dbOk &&
  questOk && levelEvOk && apiOk && keysOk && controlsOk && skillsBranchOk && gameGenOk && dropOk && artOk && originOk && abilityOk && menuOk && undoOk && hudOk && dialogueOk && platformOk && netOk &&
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
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
