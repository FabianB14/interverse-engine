// Headless smoke test for Cozy Farm (single-player). Start the dev server
// first (pnpm dev:farm), then:  node scripts/verify-farm.mjs [url]
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5177/';
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 30_000 });

await page.waitForFunction(() => window.__farm?.scene() === 'title', null, { timeout: 10_000 });
await page.evaluate(() => window.__farm.play());
await page.waitForFunction(() => window.__farm?.scene() === 'farm', null, { timeout: 10_000 });
await sleep(400);

// Economy + plant/grow/harvest loop.
await page.evaluate(() => window.__farm.grantVerium(500));
await page.evaluate(() => window.__farm.selectSeed('carrot'));
const vBeforePlant = await page.evaluate(() => window.__farm.verium());
const planted = await page.evaluate(() => window.__farm.plant(0));
await sleep(100);
const plot0 = await page.evaluate(() => window.__farm.plotInfo()[0]);
const vAfterPlant = await page.evaluate(() => window.__farm.verium());
const plantOk = planted === true && plot0.c === 'carrot' && vAfterPlant === vBeforePlant - 5;

await page.evaluate(() => window.__farm.growAll());
await sleep(120);
const ripe = (await page.evaluate(() => window.__farm.plotInfo()[0])).g >= 1;
await page.screenshot({ path: `${outDir}/farm-1.png` });

const vBeforeHarvest = await page.evaluate(() => window.__farm.verium());
const harvested = await page.evaluate(() => window.__farm.harvest(0));
await sleep(120);
const harvestedN = await page.evaluate(() => window.__farm.harvested());
const vAfterHarvest = await page.evaluate(() => window.__farm.verium());
const plot0Cleared = (await page.evaluate(() => window.__farm.plotInfo()[0])).c === null;
const harvestOk =
  harvested === true && harvestedN >= 1 && vAfterHarvest === vBeforeHarvest + 12 && plot0Cleared;

// Watering.
await page.evaluate(() => window.__farm.plant(1, 'radish'));
await page.evaluate(() => window.__farm.waterAll());
await sleep(80);
const moistOk = (await page.evaluate(() => window.__farm.plotInfo()[1])).m > 0.9;

// Weather: force rain and confirm it registers.
await page.evaluate(() => window.__farm.rainNow());
await sleep(300);
const rainOk = (await page.evaluate(() => window.__farm.weather())) === 'rain';

const musicOk = typeof (await page.evaluate(() => window.__farm.musicOn())) === 'boolean';

await browser.close();

const ok = plantOk && ripe && harvestOk && moistOk && rainOk && musicOk && errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      plantOk,
      ripe,
      harvestOk,
      harvestedN,
      moistOk,
      rainOk,
      musicOk,
      errors: errors.slice(0, 5),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
