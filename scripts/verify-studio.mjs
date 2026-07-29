// Headless playtest for Interverse Studio: boots the editor, places entities,
// edits props, runs the code window against a live Play session, adds a
// second level and switches, saves a story, and round-trips export/import.
// Run the studio dev server first (pnpm dev:studio):
//
//   node scripts/verify-studio.mjs [url]
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5179/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
mkdirSync(outDir, { recursive: true });

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
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__studio?.ready?.() === true, null, { timeout: 30_000 });
// Fresh slate: an earlier session's autosave must not leak into the checks.
await page.evaluate(() => {
  window.localStorage.removeItem('interverse.studio.project');
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

await browser.close();

const ok = placeOk && editOk && storyOk && levelsOk && playOk && stopOk && exportOk && importOk && errors.length === 0;
console.log(
  JSON.stringify(
    { ok, placeOk, editOk, storyOk, levelsOk, playOk, playCount, stopOk, exportOk, importOk, errors: errors.slice(0, 6) },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
