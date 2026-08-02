// Headless measurement for the 3D spike: does the three.js stack — tone
// mapping, shadows, bloom, instanced low-poly world — actually render, and
// what does a frame cost?
//
// The fps number here comes from SwiftShader (software GL): a floor, not a
// forecast. A real phone GPU is far faster; if even software rendering is
// interactive the verdict is a clear go. The hard gates are correctness
// (it renders, the blob rolls, the hat stays level, no errors) — fps is
// REPORTED, and only gated at "catastrophic".
//
//   node scripts/verify-spike3d.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5183/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

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

const dev = spawn('pnpm', ['--filter', '@interverse/spike3d', 'dev'], {
  stdio: 'ignore',
  detached: true,
});
const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
});
const errors = [];
let report = {};
try {
  // One configuration: load, warm up, sample the steady state.
  const measure = async (page, target, label, shot) => {
    for (let i = 0; i < 40; i++) {
      try {
        await page.goto(target, { waitUntil: 'networkidle', timeout: 5000 });
        break;
      } catch {
        await sleep(1000);
      }
    }
    await page.waitForFunction(() => window.__spike3d?.ready?.() === true, null, {
      timeout: 30_000,
    });
    // Warm up — shader compilation happens on the first frames and should
    // not be billed to the steady state.
    await sleep(2000);
    const first = await page.evaluate(() => window.__spike3d.stats());
    const samples = [];
    for (let i = 0; i < 8; i++) {
      await sleep(500);
      samples.push(await page.evaluate(() => window.__spike3d.stats()));
    }
    if (shot) await page.screenshot({ path: `${outDir}/${shot}` });
    const last = samples[samples.length - 1];
    return {
      label,
      fps: Math.round((samples.reduce((n, s) => n + s.fps, 0) / samples.length) * 10) / 10,
      frameMs:
        Math.round((samples.reduce((n, s) => n + s.frameMs, 0) / samples.length) * 100) / 100,
      drawCalls: last.drawCalls,
      triangles: last.triangles,
      first,
      last,
      hatOk: samples.every((s) => Math.abs(s.hatLevel) < 0.01),
    };
  };

  // The matrix: the full stack at desktop size, then bloom off, then bloom
  // and shadows off, then the full stack at phone size. The point is
  // ATTRIBUTION — one slow number says "slow", the differences say why.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const full = await measure(page, url, 'full 1280x720', 'spike3d.png');
  const noBloom = await measure(page, `${url}?bloom=0`, 'no bloom 1280x720', 'spike3d-nobloom.png');
  const bare = await measure(page, `${url}?bloom=0&shadows=0`, 'no bloom/shadows 1280x720', null);
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await measure(page, url, 'full 390x844', 'spike3d-phone.png');

  // It renders: a real scene's worth of triangles in a handful of draw
  // calls — instancing working is the difference between ~10 calls and 600.
  const renderOk = full.drawCalls > 3 && full.drawCalls < 60 && full.triangles > 20_000;
  // The blob rolls, and keeps rolling between samples.
  const rollOk = full.last.spin > full.first.spin && full.last.spin > 1;
  // The hat never pitches with the wheel — the cosmetic contract, in 3D.
  const hatOk = full.hatOk && phone.hatOk;
  // Catastrophe gate only; the real numbers are the report.
  const fpsOk = bare.fps > 5;
  // Software rendering is hopelessly over the 15ms budget, which makes it a
  // free test of the quality ladder: after the sampling window it MUST have
  // walked down to the floor tier and actually shrunk the pixel ratio.
  const tierOk = full.last.tier === 3 && full.last.pixelRatio < 1;

  const ok = renderOk && rollOk && hatOk && fpsOk && tierOk && errors.length === 0;
  report = {
    ok,
    renderOk,
    rollOk,
    hatOk,
    fpsOk,
    tierOk,
    matrix: [full, noBloom, bare, phone].map(({ label, fps, frameMs, drawCalls, triangles }) => ({
      label,
      fps,
      frameMs,
      drawCalls,
      triangles,
    })),
    note: 'fps is SwiftShader software rendering — a floor, not a phone forecast',
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
