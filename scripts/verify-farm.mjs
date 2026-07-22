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
// Fresh state so the welcome gift + gift-box cooldown are deterministic.
await page.evaluate(() => window.localStorage.clear());
// Character picker: default blob, switch to a person avatar.
const charDefault = await page.evaluate(() => window.__farm.charType());
await page.evaluate(() => window.__farm.setChar('person', 0x6fb0d8));
const charAfter = await page.evaluate(() => window.__farm.charType());
const charOk = charDefault === 'blob' && charAfter === 'person';
await page.evaluate(() => window.__farm.play());
await page.waitForFunction(() => window.__farm?.scene() === 'farm', null, { timeout: 10_000 });
await sleep(400);

// A brand-new farmer gets a welcome gift so they can afford their first seeds:
// +100 Verium and a few free crops in the basket.
const vWelcome = await page.evaluate(() => window.__farm.verium());
const invWelcome = await page.evaluate(() => window.__farm.inv());
const welcomeCrops = Object.values(invWelcome).reduce((a, b) => a + b, 0);
const welcomeOk = vWelcome >= 100 && welcomeCrops >= 3;
// Clear the gifted basket so later inventory asserts are deterministic.
await page.evaluate(() => window.__farm.clearInv());

// Free recharging gift box: walk up to it and open it for Verium + a crop.
await page.evaluate(() => window.__farm.teleport(416, 736));
const giftReadyBefore = await page.evaluate(() => window.__farm.giftReadyMs());
const vPreGift = await page.evaluate(() => window.__farm.verium());
await page.evaluate(() => window.__farm.claimGift());
await sleep(80);
const vPostGift = await page.evaluate(() => window.__farm.verium());
const giftReadyAfter = await page.evaluate(() => window.__farm.giftReadyMs());
const giftOk = giftReadyBefore === 0 && vPostGift > vPreGift && giftReadyAfter > 0;
await page.evaluate(() => window.__farm.clearInv());

// Walkable world: teleport the player and confirm it moved.
await page.evaluate(() => window.__farm.teleport(600, 640));
const pp = await page.evaluate(() => window.__farm.player());
const walkOk = pp.x === 600 && pp.y === 640;

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

// Harvest now goes to the basket (inventory), not straight to Verium.
const vBeforeHarvest = await page.evaluate(() => window.__farm.verium());
const harvested = await page.evaluate(() => window.__farm.harvest(0));
await sleep(120);
const harvestedN = await page.evaluate(() => window.__farm.harvested());
const vAfterHarvest = await page.evaluate(() => window.__farm.verium());
const invCarrot = (await page.evaluate(() => window.__farm.inv())).carrot ?? 0;
const plot0Cleared = (await page.evaluate(() => window.__farm.plotInfo()[0])).c === null;
const harvestOk =
  harvested === true &&
  harvestedN >= 1 &&
  invCarrot === 1 &&
  vAfterHarvest === vBeforeHarvest &&
  plot0Cleared;

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

// Walk up to the vendor and talk — dialogue opens.
await page.evaluate(() => window.__farm.talkVendor());
await sleep(200);
const vendorOk = (await page.evaluate(() => window.__farm.dialogueOpen())) === true;
await page.screenshot({ path: `${outDir}/farm-3-walk.png` });

// FARMERS MARKET: travel there, quick-sell a crop, and fulfill an order.
await page.evaluate(() => window.__farm.toMarket());
await page.waitForFunction(() => window.__farm?.scene() === 'market', null, { timeout: 8_000 });
await sleep(300);
const ordersLen = await page.evaluate(() => window.__farm.orders().length);

// Bundle pack: pay a flat price for a handful of random crops.
await page.evaluate(() => window.__farm.grantVerium(100));
const vPreBundle = await page.evaluate(() => window.__farm.verium());
const invPreBundle = await page.evaluate(() =>
  Object.values(window.__farm.inv()).reduce((a, b) => a + b, 0),
);
const bundleBought = await page.evaluate(() => window.__farm.buyBundle());
await sleep(80);
const vPostBundle = await page.evaluate(() => window.__farm.verium());
const invPostBundle = await page.evaluate(() =>
  Object.values(window.__farm.inv()).reduce((a, b) => a + b, 0),
);
const bundleOk =
  bundleBought === true && vPostBundle === vPreBundle - 40 && invPostBundle === invPreBundle + 8;

// Deterministic basket for the quick-sell check: one carrot only.
await page.evaluate(() => window.__farm.clearInv());
await page.evaluate(() => window.__farm.giveItem('carrot', 1));
// Quick-sell the carrot at base price (12).
const vPreSell = await page.evaluate(() => window.__farm.verium());
const gained = await page.evaluate(() => window.__farm.quickSell('carrot'));
await sleep(80);
const vPostSell = await page.evaluate(() => window.__farm.verium());
const carrotGone = ((await page.evaluate(() => window.__farm.inv())).carrot ?? 0) === 0;
const quickSellOk = gained === 12 && vPostSell === vPreSell + 12 && carrotGone;
// Fulfill order 0: stock exactly what it needs, then hand it over for the reward.
const order0 = await page.evaluate(() => window.__farm.orders()[0]);
await page.evaluate((o) => window.__farm.giveItem(o.crop, o.qty), order0);
const vPreFill = await page.evaluate(() => window.__farm.verium());
const filled = await page.evaluate(() => window.__farm.fulfill(0));
await sleep(120);
const vPostFill = await page.evaluate(() => window.__farm.verium());
const ordersAfter = await page.evaluate(() => window.__farm.orders().length);
const fulfillOk =
  filled === true && vPostFill === vPreFill + order0.reward && ordersAfter === ordersLen;
await page.screenshot({ path: `${outDir}/farm-2-market.png` });
// Back to the farm.
await page.evaluate(() => window.__farm.toFarm());
await page.waitForFunction(() => window.__farm?.scene() === 'farm', null, { timeout: 8_000 });
const backOk = (await page.evaluate(() => window.__farm.scene())) === 'farm';

await browser.close();

const ok =
  charOk &&
  welcomeOk &&
  giftOk &&
  walkOk &&
  vendorOk &&
  plantOk &&
  ripe &&
  harvestOk &&
  moistOk &&
  rainOk &&
  musicOk &&
  ordersLen === 3 &&
  bundleOk &&
  quickSellOk &&
  fulfillOk &&
  backOk &&
  errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      charOk,
      welcomeOk,
      vWelcome,
      welcomeCrops,
      giftOk,
      giftReadyBefore,
      giftReadyAfter,
      walkOk,
      vendorOk,
      plantOk,
      ripe,
      harvestOk,
      harvestedN,
      invCarrot,
      moistOk,
      rainOk,
      musicOk,
      ordersLen,
      bundleOk,
      bundleBought,
      quickSellOk,
      fulfillOk,
      order0,
      backOk,
      errors: errors.slice(0, 5),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
