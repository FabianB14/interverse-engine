// Headless playtest check for Blob Tap: boots the demo, taps through
// Title → Play → Results, verifies scoring works, and samples the frame
// rate. Run the dev server first (pnpm dev), then:
//
//   node scripts/verify.mjs [url]
//
// Defaults to http://localhost:5173/?round=6 (short round via debug param).
// Screenshots land in verify-shots/. Requires playwright-core (dev dep) and
// a Chromium binary (CHROMIUM_BIN env, /opt/pw-browsers, or Playwright's own).
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173/?round=6';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
mkdirSync(outDir, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall through to Playwright's default resolution */
  }
  return undefined;
}

const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 10_000 });
await page.waitForTimeout(700); // let the title settle
await page.screenshot({ path: `${outDir}/1-title.png` });

// Tap through the title into the play scene.
await page.mouse.click(195, 600);
await page.waitForFunction(() => Boolean(window.__blobtap), null, { timeout: 5_000 });
await page.waitForTimeout(1500); // let a blob or two spawn

// Tap the first live blob and confirm the score moves.
const blobs = await page.evaluate(() => window.__blobtap?.blobs() ?? []);
if (blobs.length > 0) {
  await page.mouse.click(Math.round(blobs[0].x), Math.round(blobs[0].y));
}
await page.waitForTimeout(300);
const score = await page.evaluate(() => window.__blobtap?.score() ?? -1);
await page.screenshot({ path: `${outDir}/2-play.png` });

// Sample real rAF frame rate for one second mid-round.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const loop = () => {
        frames += 1;
        if (performance.now() - t0 < 1000) requestAnimationFrame(loop);
        else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(loop);
    }),
);

// Wait for the round to end (debug hook disappears when PlayScene exits).
await page.waitForFunction(() => !window.__blobtap, null, { timeout: 20_000 });
await page.waitForTimeout(900); // results pop-in
await page.screenshot({ path: `${outDir}/3-results.png` });

await browser.close();

const ok = score > 0 && fps >= 55 && errors.length === 0;
console.log(JSON.stringify({ ok, score, fps, blobsSeen: blobs.length, errors }, null, 2));
process.exit(ok ? 0 : 1);
