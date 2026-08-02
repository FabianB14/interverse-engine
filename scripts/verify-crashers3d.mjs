// Headless playtest for Blob Crashers 3D — the gates that matter are the
// three new engine features doing their jobs for real:
//   - Actor3's model slot (golem.glb loads, has BOTH clips)
//   - the animation slot (idle plays on arrival, swing plays on telegraph,
//     clip time actually advances)
//   - the sfx/vfx slots (emit counters move when combat happens)
//   - splines (mobs arrive along the entrance path, then fight)
// plus the combat loop borrowed whole from core: waves gate the arena,
// hits kill, telegraphed slams hurt, and the run can be won.
//
//   node scripts/verify-crashers3d.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5185/';
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

const dev = spawn('pnpm', ['--filter', '@interverse/crashers3d', 'dev'], {
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
  await page.waitForFunction(() => window.__crashers3d?.ready?.() === true, null, {
    timeout: 30_000,
  });
  await sleep(400);

  const screen0 = await page.evaluate(() => window.__crashers3d.screen());
  await page.evaluate(() => window.__crashers3d.play());
  await page.evaluate(() => window.__crashers3d.safe(true));

  // Walk right into the first gate; a wave should spawn.
  await page.evaluate(() => window.__crashers3d.move(1, 0));
  const gated = await waitFor(
    () => page.evaluate(() => window.__crashers3d.state()),
    (s) => s.wave.state === 'fighting',
    20_000,
  );
  await page.evaluate(() => window.__crashers3d.move(0, 0));

  // Mobs enter along splines: someone should be mid-path, then all arrive.
  const entering = gated.entering;
  const arrived = await waitFor(
    () => page.evaluate(() => window.__crashers3d.state()),
    (s) => s.mobs > 0 && s.entering === 0,
    15_000,
  );

  // The model slot: golem loaded with both clips, idle playing, clip time
  // advancing between samples.
  const mob0 = await waitFor(
    () => page.evaluate(() => window.__crashers3d.mob(0)),
    (m) => !!m && m.modelLoaded,
    15_000,
  );
  await sleep(700);
  const mob0b = await page.evaluate(() => window.__crashers3d.mob(0));
  await page.screenshot({ path: `${outDir}/crashers3d-1-wave.png` });

  // Wait for a golem to close in and wind up: the swing clip + sfx slot.
  const swinger = await waitFor(
    () => page.evaluate(() => window.__crashers3d.mob(0)),
    (m) => !!m && m.playing === 'swing',
    20_000,
  );
  await page.screenshot({ path: `${outDir}/crashers3d-2-swing.png` });

  // Get hurt for real: drop safe, stand in the slam.
  await page.evaluate(() => window.__crashers3d.safe(false));
  const hurt = await waitFor(
    () => page.evaluate(() => window.__crashers3d.state()),
    (s) => s.hearts < 5,
    20_000,
  );
  await page.evaluate(() => window.__crashers3d.safe(true));

  // Fight back: attack until the wave clears. The emit counters on the
  // PLAYER prove the sfx/vfx slots fire on connection.
  const before = await page.evaluate(() => window.__crashers3d.state());
  for (let i = 0; i < 240 && (await page.evaluate(() => window.__crashers3d.state())).mobs > 0; i++) {
    await page.evaluate(() => window.__crashers3d.attack());
    await sleep(90);
  }
  const cleared = await waitFor(
    () => page.evaluate(() => window.__crashers3d.state()),
    (s) => s.wave.state === 'travelling' || s.wave.index > 0,
    10_000,
  );
  const hits = await page.evaluate(() => window.__crashers3d.emitted('hit'));
  const swings = await page.evaluate(() => window.__crashers3d.emitted('swing'));
  await page.screenshot({ path: `${outDir}/crashers3d-3-cleared.png` });

  // Fast-forward the rest: warp to each gate, clear, until won.
  let final = cleared;
  for (let round = 0; round < 3 && !final.won; round++) {
    await page.evaluate(() => window.__crashers3d.move(1, 0));
    await waitFor(
      () => page.evaluate(() => window.__crashers3d.state()),
      (s) => s.wave.state === 'fighting' || s.won || s.wave.state === 'done',
      25_000,
    );
    await page.evaluate(() => window.__crashers3d.move(0, 0));
    for (
      let i = 0;
      i < 400 && (await page.evaluate(() => window.__crashers3d.state())).mobs > 0;
      i++
    ) {
      await page.evaluate(() => window.__crashers3d.attack());
      await sleep(80);
    }
    final = await page.evaluate(() => window.__crashers3d.state());
    if (final.wave.state === 'done') {
      await page.evaluate(() => window.__crashers3d.move(1, 0));
      final = await waitFor(
        () => page.evaluate(() => window.__crashers3d.state()),
        (s) => s.won,
        20_000,
      );
      await page.evaluate(() => window.__crashers3d.move(0, 0));
    }
  }
  await page.screenshot({ path: `${outDir}/crashers3d-4-end.png` });
  const stats = await page.evaluate(() => window.__crashers3d.stats());

  const waveOk = screen0 === 'menu' && gated.wave.state === 'fighting' && gated.wave.index === 0;
  const splineOk = entering > 0 && arrived.entering === 0 && arrived.mobs === 2;
  const modelOk =
    !!mob0 && mob0.modelLoaded && mob0.clips.includes('idle') && mob0.clips.includes('swing');
  const animOk =
    !!mob0b && mob0b.playing === 'idle' && mob0b.clipTime !== mob0.clipTime &&
    !!swinger && swinger.playing === 'swing' && swinger.swings > 0;
  const hurtOk = hurt.hearts < 5 && !hurt.over;
  const fightOk = before.mobs > 0 && cleared.mobs === 0 && hits > 0 && swings > 0;
  const winOk = final.won === true;
  const renderOk = stats.drawCalls > 4 && stats.drawCalls < 90 && stats.triangles > 4_000;

  const ok = waveOk && splineOk && modelOk && animOk && hurtOk && fightOk && winOk && renderOk && errors.length === 0;
  report = {
    ok, waveOk, splineOk, modelOk, animOk, hurtOk, fightOk, winOk, renderOk,
    gated, entering, arrived, mob0, mob0b, swinger, hurt: hurt.hearts, hits, swings,
    final, stats, errors,
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
