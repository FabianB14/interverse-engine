// Headless multiplayer playtest for Blob Farm visits + trading: starts the
// relay locally, opens TWO isolated "phones" — one opens their farm, the
// other drops by with the code — then walks them together and runs a trade,
// checking both baskets swapped. Run the farm dev server first (pnpm dev:farm):
//
//   node scripts/verify-visit.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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

if (!existsSync('relay/dist/server.js')) {
  console.error('relay/dist missing — run: pnpm --filter @interverse/relay build');
  process.exit(1);
}
const relay = spawn('node', ['relay/dist/server.js'], {
  env: { ...process.env, PORT: '8787' },
  stdio: 'inherit',
});
let relayUp = false;
for (let i = 0; i < 20 && !relayUp; i++) {
  try {
    const res = await fetch('http://localhost:8787/health');
    relayUp = res.ok;
  } catch {
    await sleep(250);
  }
}
if (!relayUp) {
  console.error('relay did not come up on :8787');
  relay.kill();
  process.exit(1);
}

const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});
const errors = [];
const q = '?relay=ws://localhost:8787';

async function phone(name) {
  // newPage → isolated context (separate localStorage), so the two farmers
  // have independent baskets like real separate devices.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  await page.goto(`${url}${q}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 15_000 });
  await page.waitForFunction(() => window.__farm?.scene() === 'title', null, { timeout: 10_000 });
  return page;
}

// Drive a hook until the scene matches (survives the transition guard).
async function pump(page, hook, target, timeout = 12_000) {
  await page.waitForFunction(
    ({ h, t }) => {
      if (window.__farm?.scene() === t) return true;
      const fn = window.__farm?.[h];
      if (typeof fn === 'function') fn();
      return false;
    },
    { h: hook, t: target },
    { timeout, polling: 250 },
  );
}

// --- Host opens their farm ---
const host = await phone('host');
await pump(host, 'friends', 'friends');
await pump(host, 'openFarm', 'visit', 45_000);
const code = await host.evaluate(() => window.__farm.code());
console.error(`farm code: ${code}`);

// --- Visitor drops by with the code ---
const guest = await phone('guest');
await pump(guest, 'friends', 'friends');
await guest.evaluate((c) => window.__farm.visitByCode(c), code);
await guest.waitForFunction(() => window.__farm?.scene() === 'visitjoin', null, { timeout: 8_000 });
await pump(guest, 'visit', 'visit', 30_000);

// Both should see one remote (each other).
await host.waitForFunction(() => window.__farm.remoteIds().length === 1, null, { timeout: 8_000 });
await guest.waitForFunction(() => window.__farm.remoteIds().length === 1, null, { timeout: 8_000 });
const bothSeeEachOther = true;

// Stock baskets: host has carrots, guest has radishes. Stand them together.
await host.evaluate(() => window.__farm.giveItem('carrot', 3));
await guest.evaluate(() => window.__farm.giveItem('radish', 3));
await host.evaluate(() => window.__farm.teleport(544, 672));
await guest.evaluate(() => window.__farm.teleport(600, 672));
await sleep(600); // let positions sync so they're in trade range

// Host starts a trade, offers a carrot.
await host.evaluate(() => window.__farm.startTrade());
await sleep(300);
const guestGotReq = await guest.evaluate(() => window.__farm.tradeOpen());
await host.evaluate(() => window.__farm.offerItem('carrot'));
await sleep(200);
// Guest offers a radish.
await guest.evaluate(() => window.__farm.offerItem('radish'));
await sleep(200);
// Both confirm; the host settles the swap.
await guest.evaluate(() => window.__farm.confirmTrade());
await host.evaluate(() => window.__farm.confirmTrade());
await sleep(600);

const hostInv = await host.evaluate(() => window.__farm.inv());
const guestInv = await guest.evaluate(() => window.__farm.inv());
await host.screenshot({ path: `${outDir}/visit-host.png` });
await guest.screenshot({ path: `${outDir}/visit-guest.png` });

// Host gave a carrot (3→2) and got a radish (0→1); guest is the mirror.
const tradeOk =
  (hostInv.carrot ?? 0) === 2 &&
  (hostInv.radish ?? 0) === 1 &&
  (guestInv.radish ?? 0) === 2 &&
  (guestInv.carrot ?? 0) === 1;
const tradeClosed =
  (await host.evaluate(() => window.__farm.tradeOpen())) === false &&
  (await guest.evaluate(() => window.__farm.tradeOpen())) === false;

await browser.close();
relay.kill();

const ok = bothSeeEachOther && guestGotReq && tradeOk && tradeClosed && errors.length === 0;
console.log(
  JSON.stringify(
    { ok, code, bothSeeEachOther, guestGotReq, tradeOk, tradeClosed, hostInv, guestInv, errors },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
