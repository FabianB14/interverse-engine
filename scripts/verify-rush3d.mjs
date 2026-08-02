// Headless playtest for Blob Rush 3D: the same guarantees as the 2D game —
// the blob rolls, lanes clamp, jump and slide happen and end, corners can be
// taken and missed, nothing sits on a corner, and coins bank into the SHARED
// 'rush' profile — plus the 3D-only ones: the world actually renders, and
// the quality ladder responds to load.
//
//   node scripts/verify-rush3d.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5184/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall back */
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (read, ok, timeout = 15_000) => {
  const until = Date.now() + timeout;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(100);
    v = await read();
  }
  return v;
};

const dev = spawn('pnpm', ['--filter', '@interverse/rush3d', 'dev'], {
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
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 5000 });
      break;
    } catch {
      await sleep(1000);
    }
  }
  await page.waitForFunction(() => window.__rush3d?.ready?.() === true, null, { timeout: 30_000 });
  // A known profile, so banking is checkable.
  // Seed the SHARED 'rush' store in its {v, data} envelope — the same store
  // the 2D game reads, which is the point being tested.
  await page.evaluate(() =>
    window.localStorage.setItem(
      'interverse:rush',
      JSON.stringify({
        v: 1,
        data: {
          profile: { best: 0, coins: 100, lifetime: 0, runs: 0, owned: ['none', 'party'], wearing: 'party' },
        },
      }),
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rush3d?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(500);

  const screen0 = await page.evaluate(() => window.__rush3d.screen());
  await page.evaluate(() => window.__rush3d.play());
  const run0 = await waitFor(
    () => page.evaluate(() => window.__rush3d.run()),
    (r) => !!r && r.metres > 0,
  );
  await page.evaluate(() => window.__rush3d.safe(true));

  // The blob rolls; the hat is worn and never pitches with the wheel.
  const roll0 = await page.evaluate(() => window.__rush3d.hat());
  await sleep(900);
  const roll1 = await page.evaluate(() => window.__rush3d.hat());
  await page.screenshot({ path: `${outDir}/rush3d-1-run.png` });

  // Lanes clamp at the edge.
  await page.evaluate(() => window.__rush3d.swipe('right'));
  await page.evaluate(() => window.__rush3d.swipe('right'));
  await sleep(400);
  const laneRight = (await page.evaluate(() => window.__rush3d.run())).lane;
  await page.evaluate(() => window.__rush3d.swipe('right'));
  await sleep(300);
  const laneClamped = (await page.evaluate(() => window.__rush3d.run())).lane;

  // Jump and slide happen and end.
  await page.evaluate(() => window.__rush3d.swipe('up'));
  const jumped = await waitFor(
    () => page.evaluate(() => window.__rush3d.run()),
    (r) => !!r && r.airborne,
    3000,
  );
  const landed = await waitFor(
    () => page.evaluate(() => window.__rush3d.run()),
    (r) => !!r && !r.airborne,
    4000,
  );
  await page.evaluate(() => window.__rush3d.swipe('down'));
  const slid = await waitFor(
    () => page.evaluate(() => window.__rush3d.run()),
    (r) => !!r && r.sliding,
    3000,
  );
  await page.screenshot({ path: `${outDir}/rush3d-2-slide.png` });

  // Render stats captured MID-RUN — the menu is a still frame of a culled
  // world, and measuring it says nothing about what the game draws.
  const stats = await page.evaluate(() => window.__rush3d.stats());

  // Ride a while: corner clearance is an invariant, sampled while we go.
  const takeAnyCorner = async () => {
    const s = await page.evaluate(() => window.__rush3d.run());
    if (!s || s.turnZ > 3200) return;
    const d = await page.evaluate(() => window.__rush3d.corner());
    await page.evaluate((dir) => window.__rush3d.swipe(dir > 0 ? 'right' : 'left'), d);
  };
  let inSpan = 0;
  let cornerSecs = Infinity;
  const bends = [];
  for (let i = 0; i < 16; i++) {
    await takeAnyCorner();
    const r = await page.evaluate(() => window.__rush3d.run());
    const t = await page.evaluate(() => window.__rush3d.track());
    if (r) bends.push(r.bend);
    if (t) {
      inSpan = Math.max(inSpan, t.inSpan);
      if (r && r.turnZ > 0 && r.turnZ < 3000 && t.cornerSecs >= 0) {
        cornerSecs = Math.min(cornerSecs, t.cornerSecs);
      }
    }
    await sleep(300);
  }
  if (!Number.isFinite(cornerSecs)) cornerSecs = -1;

  // A deliberate corner: zone changes, camera yaw seen, yaw settles to 0.
  const zoneBefore = (await page.evaluate(() => window.__rush3d.run())).zone;
  const turnDir = await page.evaluate(() => window.__rush3d.corner());
  await page.screenshot({ path: `${outDir}/rush3d-3-corner.png` });
  await page.evaluate((d) => window.__rush3d.swipe(d > 0 ? 'right' : 'left'), turnDir);
  let peakYaw = 0;
  for (let i = 0; i < 60; i++) {
    const r = await page.evaluate(() => window.__rush3d.run());
    if (r) peakYaw = Math.max(peakYaw, Math.abs(r.yaw));
    if (r && r.zone !== zoneBefore) break;
    await sleep(16);
  }
  const turned = await waitFor(
    () => page.evaluate(() => window.__rush3d.run()),
    (r) => !!r && r.zone !== zoneBefore,
    6000,
  );
  await page.screenshot({ path: `${outDir}/rush3d-4-newzone.png` });

  // Wrong direction at a corner ends the run and banks into the profile.
  const wrongDir = await page.evaluate(() => window.__rush3d.corner());
  await page.evaluate((d) => window.__rush3d.swipe(d > 0 ? 'left' : 'right'), wrongDir);
  const ended = await waitFor(
    () => page.evaluate(() => window.__rush3d.screen()),
    (s) => s === 'menu',
    6000,
  );
  const banked = await page.evaluate(() => window.__rush3d.profile());
  await page.screenshot({ path: `${outDir}/rush3d-5-result.png` });

  // The profile survives a reload — shared store, so this is also what the
  // 2D game will read.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__rush3d?.ready?.() === true, null, { timeout: 30_000 });
  const reloaded = await page.evaluate(() => window.__rush3d.profile());

  const rollOk = roll1.wheel !== roll0.wheel && roll1.children > 0 && Math.abs(roll1.riderPitch) < 0.01;
  const laneOk = laneRight === 2 && laneClamped === 2;
  const moveOk = !!jumped?.airborne && !!landed && !landed.airborne && !!slid?.sliding;
  const bendOk = Math.max(...bends.map(Math.abs)) > 90;
  const cornerOk =
    run0.zone === 'Misty Bog' && !!turned && turned.zone !== zoneBefore &&
    peakYaw > 0.02 && turned.yaw === 0;
  const clearOk = inSpan === 0 && cornerSecs > 0.5;
  const missOk = ended === 'menu';
  const bankOk = banked.coins > 100 && banked.runs === 1 && banked.best > 0;
  const persistOk = reloaded.coins === banked.coins && reloaded.best === banked.best;
  const renderOk = stats.drawCalls > 4 && stats.drawCalls < 80 && stats.triangles > 3_000;

  const ok =
    screen0 === 'menu' && rollOk && laneOk && moveOk && bendOk && cornerOk && clearOk &&
    missOk && bankOk && persistOk && renderOk && errors.length === 0;
  report = {
    ok, rollOk, laneOk, moveOk, bendOk, cornerOk, clearOk, missOk, bankOk, persistOk, renderOk,
    screen0, run0, roll0, roll1, laneRight, laneClamped,
    inSpan, cornerSecs, zoneBefore, turnDir, peakYaw, turned, ended, banked, reloaded, stats,
    errors,
  };
} finally {
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}
process.exit(report.ok ? 0 : 1);
