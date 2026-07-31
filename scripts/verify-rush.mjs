// Headless playtest for Blob Rush: buys a hat, runs a stretch of road, and
// checks the things a runner can quietly get wrong — that the blob actually
// rolls, that the hat on top of it does NOT, that swipes move and jump and
// slide, that a corner can be taken and missed, and that coins and a best
// distance survive a reload.
//
//   node scripts/verify-rush.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5182/';
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

const dev = spawn('pnpm', ['--filter', '@interverse/rush', 'dev'], {
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
  await page.waitForFunction(() => window.__rush?.ready?.() === true, null, { timeout: 30_000 });
  // Start from a known profile, so the run is the same every time.
  await page.evaluate(() =>
    window.__rush.setProfile({ best: 0, coins: 400, lifetime: 0, runs: 0, owned: ['none'], wearing: 'none' }),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rush?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(600);

  // ---------------------------------------------------------------- shop
  const screen0 = await page.evaluate(() => window.__rush.screen());
  const hats0 = await page.evaluate(() => window.__rush.hats());
  // A hat you can afford, and one you cannot — the shop has to say no as
  // clearly as it says yes.
  await page.evaluate(() => window.__rush.pickHat('party'));
  await page.evaluate(() => window.__rush.buy());
  await sleep(300);
  const afterBuy = await page.evaluate(() => window.__rush.profile());
  await page.evaluate(() => window.__rush.pickHat('prop'));
  await page.evaluate(() => window.__rush.buy());
  await sleep(300);
  const afterBroke = await page.evaluate(() => window.__rush.profile());
  await page.screenshot({ path: `${outDir}/rush-1-shop.png` });

  // ----------------------------------------------------------------- run
  await page.evaluate(() => window.__rush.play());
  const run0 = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && r.metres > 0,
  );
  // The blob rolls, and it rolls because the road moved: the wheel angle has
  // to change while the run progresses.
  const roll0 = await page.evaluate(() => window.__rush.hat());
  await sleep(900);
  const roll1 = await page.evaluate(() => window.__rush.hat());
  const spun = Math.abs(roll1.wheel - roll0.wheel) > 0.2;
  // …and the hat did NOT. Its angle on screen is its own rotation plus the
  // rider's lean, and both must stay near level through any amount of roll.
  const hatLevel = Math.abs(roll1.hat + roll1.lean) < 0.5 && Math.abs(roll0.hat + roll0.lean) < 0.5;
  await page.screenshot({ path: `${outDir}/rush-2-run.png` });

  // Lanes: swipe right twice, and the second must be refused at the edge.
  await page.evaluate(() => window.__rush.swipe('right'));
  await page.evaluate(() => window.__rush.swipe('right'));
  await sleep(400);
  const laneRight = (await page.evaluate(() => window.__rush.run())).lane;
  await page.evaluate(() => window.__rush.swipe('right'));
  await sleep(300);
  const laneClamped = (await page.evaluate(() => window.__rush.run())).lane;

  // Jump and slide have to actually happen and actually end.
  await page.evaluate(() => window.__rush.swipe('up'));
  const jumped = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && r.airborne,
    3000,
  );
  await page.screenshot({ path: `${outDir}/rush-3-jump.png` });
  const landed = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && !r.airborne,
    4000,
  );
  await page.evaluate(() => window.__rush.swipe('down'));
  const slid = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && r.sliding,
    3000,
  );
  await page.screenshot({ path: `${outDir}/rush-4-slide.png` });

  // Speed ramps as you go — a runner that never gets harder is a screensaver.
  const early = run0.speed;
  const later = (await page.evaluate(() => window.__rush.run())).speed;

  // Corners: bring one into the window, take it, and check the zone changed.
  const zoneBefore = (await page.evaluate(() => window.__rush.run())).zone;
  const turnDir = await page.evaluate(() => window.__rush.corner());
  await page.screenshot({ path: `${outDir}/rush-5-corner.png` });
  await page.evaluate((d) => window.__rush.swipe(d > 0 ? 'right' : 'left'), turnDir);
  const turned = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && r.zone !== zoneBefore,
    5000,
  );

  // Getting the corner WRONG ends the run. That is the one mistake in this
  // game with no recovery, so it had better actually be one.
  const wrongDir = await page.evaluate(() => window.__rush.corner());
  await page.evaluate((d) => window.__rush.swipe(d > 0 ? 'left' : 'right'), wrongDir);
  const ended = await waitFor(
    () => page.evaluate(() => window.__rush.screen()),
    (s) => s === 'result',
    6000,
  );
  await page.screenshot({ path: `${outDir}/rush-6-result.png` });

  // -------------------------------------------------------------- result
  const banked = await page.evaluate(() => window.__rush.profile());
  await page.evaluate(() => window.__rush.again());
  const rerun = await waitFor(
    () => page.evaluate(() => window.__rush.screen()),
    (s) => s === 'run',
    5000,
  );

  // The profile has to survive a reload, or a coin economy is pointless.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rush?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(400);
  const reloaded = await page.evaluate(() => window.__rush.profile());

  const shopOk =
    screen0 === 'menu' &&
    hats0.length === 8 &&
    afterBuy.owned.includes('party') &&
    afterBuy.wearing === 'party' &&
    afterBuy.coins === 250 &&
    // Could not afford the propeller, so nothing happened at all.
    !afterBroke.owned.includes('prop') &&
    afterBroke.coins === 250;
  const rollOk = spun && hatLevel && roll0.children > 0;
  const laneOk = laneRight === 2 && laneClamped === 2;
  const moveOk = !!jumped?.airborne && !!landed && !landed.airborne && !!slid?.sliding;
  const speedOk = later > early;
  const cornerOk = !!turned && turned.zone !== zoneBefore && zoneBefore === 'Temple Steps';
  const missOk = ended === 'result';
  const bankOk = banked.best > 0 && banked.coins >= 250 && banked.runs === 1;
  const persistOk =
    rerun === 'run' && reloaded.best === banked.best && reloaded.coins === banked.coins &&
    reloaded.owned.includes('party');

  const ok =
    shopOk && rollOk && laneOk && moveOk && speedOk && cornerOk && missOk && bankOk &&
    persistOk && errors.length === 0;
  report = {
    ok, shopOk, rollOk, laneOk, moveOk, speedOk, cornerOk, missOk, bankOk, persistOk,
    screen0, hats0, afterBuy, afterBroke,
    run0, roll0, roll1, spun, hatLevel,
    laneRight, laneClamped, jumped, landed, slid,
    early, later, zoneBefore, turnDir, turned, ended,
    banked, rerun, reloaded, errors,
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
