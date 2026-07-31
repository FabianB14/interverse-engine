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
  // This test never dodges anything, and at full pace that is dead in about
  // four seconds — far less than the mechanics below take to exercise. A
  // missed corner still ends the run, which is checked at the end.
  await page.evaluate(() => window.__rush.safe(true));
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

  // Corners now come often enough that a few seconds of sampling will meet
  // one, and missing a corner ends the run even in safe mode. So take them.
  const takeAnyCorner = async () => {
    const s = await page.evaluate(() => window.__rush.run());
    if (!s || s.turnZ > 2600) return;
    const d = await page.evaluate(() => window.__rush.corner());
    await page.evaluate((dir) => window.__rush.swipe(dir > 0 ? 'right' : 'left'), d);
  };

  // The road has to actually wander. Sample it over a few seconds: a bend
  // that is always near zero is a straight road with extra maths, which is
  // exactly what the first cut of this shipped as.
  const bends = [];
  for (let i = 0; i < 14; i++) {
    await takeAnyCorner();
    bends.push((await page.evaluate(() => window.__rush.run()))?.bend ?? 0);
    await sleep(220);
  }
  const peakBend = Math.max(...bends.map(Math.abs));
  const bendSpread = Math.max(...bends) - Math.min(...bends);
  await page.screenshot({ path: `${outDir}/rush-5-bend.png` });

  // Corners: bring one into the window, take it, and check the zone changed
  // and the world swung round rather than cutting.
  const zoneBefore = (await page.evaluate(() => window.__rush.run()))?.zone ?? '';
  const turnDir = await page.evaluate(() => window.__rush.corner());
  await page.screenshot({ path: `${outDir}/rush-6-corner.png` });
  await page.evaluate((d) => window.__rush.swipe(d > 0 ? 'right' : 'left'), turnDir);
  // The camera has to come round. In a headless browser the game loop runs
  // far faster than realtime and the whole 420-unit arc can pass inside one
  // sample, so poll hard and take the largest yaw seen rather than hoping to
  // catch a particular frame.
  let peakYaw = 0;
  for (let i = 0; i < 60; i++) {
    const r = await page.evaluate(() => window.__rush.run());
    if (r) peakYaw = Math.max(peakYaw, Math.abs(r.yaw));
    if (r && r.zone !== zoneBefore) break;
    await sleep(16);
  }
  const turned = await waitFor(
    () => page.evaluate(() => window.__rush.run()),
    (r) => !!r && r.zone !== zoneBefore,
    5000,
  );
  // Coming out of a corner the road leans the way you turned, so the turn
  // has a direction you can feel and not just a change of scenery.
  const bendAfterTurn = turned?.bend ?? 0;
  // The camera yaw ends flat again — the corner frame is dropped on exactly
  // the frame a straight one produces identical output, so nothing is left
  // rotated behind it.
  const yawAfter = turned?.yaw ?? 99;

  // Getting the corner WRONG ends the run. That is the one mistake in this
  // game with no recovery, so it had better actually be one.
  const wrongDir = await page.evaluate(() => window.__rush.corner());
  await page.evaluate((d) => window.__rush.swipe(d > 0 ? 'left' : 'right'), wrongDir);
  const ended = await waitFor(
    () => page.evaluate(() => window.__rush.screen()),
    (s) => s === 'result',
    6000,
  );
  await page.screenshot({ path: `${outDir}/rush-7-result.png` });

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
  // Temple Run pace, not a stroll: over a thousand out of the gate and
  // still climbing.
  const speedOk = later > early && early > 900;
  // A road that leans hard and does not stay leaning one way.
  const bendOk = peakBend > 90 && bendSpread > 90;
  const cornerOk =
    // The run starts in the swamp's first zone…
    run0.zone === 'Misty Bog' &&
    // …the corner moves you to a different one, the world swings round
    // rather than cutting, and the road comes out leaning the way you turned.
    !!turned && turned.zone !== zoneBefore &&
    peakYaw > 0.02 && yawAfter === 0 && Math.sign(bendAfterTurn) === Math.sign(turnDir);
  const missOk = ended === 'result';
  const bankOk = banked.best > 0 && banked.coins >= 250 && banked.runs === 1;
  const persistOk =
    rerun === 'run' && reloaded.best === banked.best && reloaded.coins === banked.coins &&
    reloaded.owned.includes('party');

  const ok =
    shopOk && rollOk && laneOk && moveOk && speedOk && bendOk && cornerOk && missOk &&
    bankOk && persistOk && errors.length === 0;
  report = {
    ok, shopOk, rollOk, laneOk, moveOk, speedOk, bendOk, cornerOk, missOk, bankOk, persistOk,
    screen0, hats0, afterBuy, afterBroke,
    run0, roll0, roll1, spun, hatLevel,
    laneRight, laneClamped, jumped, landed, slid,
    early, later, bends, peakBend, bendSpread,
    zoneBefore, turnDir, peakYaw, bendAfterTurn, yawAfter, turned, ended,
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
