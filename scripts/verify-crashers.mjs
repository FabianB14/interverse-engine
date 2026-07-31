// Headless playtest for Blob Crashers: picks a class, walks the campaign
// map, fights a stage end to end, and checks that progress sticks.
//
//   node scripts/verify-crashers.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5181/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

/** The bundled Chromium, wherever this environment put it. */
function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall back to whatever playwright finds */
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for a condition rather than guessing how long it takes — a loaded
 *  machine runs the game loop slowly, and a fixed sleep tests the machine. */
const waitFor = async (read, ok, timeout = 15_000) => {
  const until = Date.now() + timeout;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(100);
    v = await read();
  }
  return v;
};

const dev = spawn('pnpm', ['--filter', '@interverse/crashers', 'dev'], {
  stdio: 'ignore',
  detached: true,
});
const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
});
const errors = [];
let report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  // The dev server may still be coming up.
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 5000 });
      break;
    } catch {
      await sleep(1000);
    }
  }
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  // Start from nothing, so the run is the same every time.
  await page.evaluate(() => window.__crashers.setRun({ cleared: 0, xp: 0, coins: 0, upgrades: { power: 0, speed: 0, hearts: 0 } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(500);

  // ---------------------------------------------------------------- menu
  const screen0 = await page.evaluate(() => window.__crashers.screen());
  const stageCount = await page.evaluate(() => window.__crashers.stageCount());
  await page.evaluate(() => window.__crashers.pickClass(2)); // the Brute
  const picked = await page.evaluate(() => window.__crashers.pickedClass());
  await page.screenshot({ path: `${outDir}/cr-1-menu.png` });
  await page.evaluate(() => window.__crashers.start());
  await sleep(700);

  // ----------------------------------------------------------------- map
  const screen1 = await waitFor(
    () => page.evaluate(() => window.__crashers.screen()),
    (s) => s === 'map',
  );
  // A fresh run may only start stage 1 — the rest of the campaign is earned.
  const unlocked0 = await page.evaluate(() => window.__crashers.unlocked());
  const classKept = await page.evaluate(() => window.__crashers.run().classId);
  await page.screenshot({ path: `${outDir}/cr-2-map.png` });

  // --------------------------------------------------------------- fight
  await page.evaluate(() => window.__crashers.play(1));
  const fight0 = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f,
  );
  // Walk right into the first gate; it must stop the player.
  await page.evaluate(() => window.__crashers.move(1, 0));
  const atGate = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f && f.foes > 0,
  );
  const gateHeld = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f && f.heroX >= f.limitX - 12,
  );
  await page.screenshot({ path: `${outDir}/cr-3-fight.png` });
  // A swing has to actually hurt something: clear the wave the hard way for
  // the first one, then shortcut the rest.
  const foesBefore = gateHeld.foes;
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__crashers.fight()))?.foes >= foesBefore; i++) {
    await page.evaluate(() => window.__crashers.swing());
    await sleep(140);
  }
  const afterSwings = await page.evaluate(() => window.__crashers.fight());
  // Then finish the stage: clear each wave as it appears and walk on.
  let cleared = 0;
  for (let i = 0; i < 60; i++) {
    const f = await page.evaluate(() => window.__crashers.fight());
    if (!f) break;
    if (f.foes > 0) {
      await page.evaluate(() => window.__crashers.clearWave());
      cleared++;
    }
    await sleep(160);
  }
  const finished = await waitFor(
    () => page.evaluate(() => window.__crashers.screen()),
    (s) => s === 'result',
    25_000,
  );
  await page.screenshot({ path: `${outDir}/cr-4-result.png` });
  const runAfter = await page.evaluate(() => window.__crashers.run());
  await page.evaluate(() => window.__crashers.next());
  await sleep(700);
  const unlocked1 = await waitFor(
    () => page.evaluate(() => window.__crashers.unlocked()),
    (u) => u.length > 1,
  );
  await page.screenshot({ path: `${outDir}/cr-5-map-after.png` });

  // Progress has to survive a reload, or a 15-stage campaign is pointless.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(500);
  const runReloaded = await page.evaluate(() => window.__crashers.run());

  const menuOk = screen0 === 'menu' && stageCount === 15 && picked === 'brute' && classKept === 'brute';
  const mapOk = screen1 === 'map' && unlocked0.join() === '1';
  const gateOk =
    !!fight0 && atGate.foes > 0 && gateHeld.heroX >= gateHeld.limitX - 12 && gateHeld.hearts > 0;
  const combatOk = !!afterSwings && afterSwings.foes < foesBefore;
  const clearOk = finished === 'result' && cleared > 0 && runAfter.cleared === 1 && runAfter.xp > 0;
  const persistOk =
    unlocked1.includes(2) && runReloaded.cleared === 1 && runReloaded.xp === runAfter.xp;

  const ok = menuOk && mapOk && gateOk && combatOk && clearOk && persistOk && errors.length === 0;
  report = {
    ok, menuOk, mapOk, gateOk, combatOk, clearOk, persistOk,
    screen0, stageCount, picked, classKept, screen1, unlocked0,
    fight0, atGate, gateHeld, foesBefore, afterSwings, cleared, finished,
    runAfter, unlocked1, runReloaded, errors,
  };
} finally {
  await browser.close();
  try {
    process.kill(-dev.pid);
  } catch {
    /* already gone */
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
