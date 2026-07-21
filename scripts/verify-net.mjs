// Headless multiplayer playtest for Tap Party: starts the relay locally,
// opens THREE headless "phones" — one hosts, two join by room code — and
// checks that everyone sees everyone's taps (the Phase 3 done-condition,
// minus the physical phones). Run the taps dev server first (pnpm dev:taps),
// then:
//
//   node scripts/verify-net.mjs [url]
//
// Screenshots land in verify-shots/.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5175/';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Start the relay (build it first if needed). ---
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

async function phone(query, dpr = 1) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: dpr,
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${url}${query}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 10_000 });
  return page;
}

const errors = [];

// Phone 1 hosts (auto via ?host=1)...
const p1 = await phone('?host=1');
await p1.waitForFunction(() => window.__taps?.scene() === 'party', null, { timeout: 10_000 });
const code = await p1.evaluate(() => window.__taps.code());
console.error(`room code: ${code}`);
await p1.screenshot({ path: `${outDir}/1-host-lobby.png` });

// ...phones 2 and 3 join by code (auto keypad prefill via ?join=CODE).
const p2 = await phone(`?join=${code}`, 3);
const p3 = await phone(`?join=${code}`);
for (const p of [p2, p3]) {
  await p.waitForFunction(() => window.__taps?.scene() === 'party', null, { timeout: 10_000 });
}
// Everyone should agree the room has 3 players.
await p1.waitForFunction(() => window.__taps.playerCount() === 3, null, { timeout: 5_000 });
await p2.waitForFunction(() => window.__taps.playerCount() === 3, null, { timeout: 5_000 });
await p3.waitForFunction(() => window.__taps.playerCount() === 3, null, { timeout: 5_000 });

// Host taps — joiners must see it.
await p1.mouse.click(195, 500);
await sleep(600);
const afterHostTap = [
  await p1.evaluate(() => window.__taps.taps()),
  await p2.evaluate(() => window.__taps.taps()),
  await p3.evaluate(() => window.__taps.taps()),
];

// A joiner taps — host and the other joiner must see it.
await p2.mouse.click(220, 600);
await sleep(600);
const afterJoinerTap = [
  await p1.evaluate(() => window.__taps.taps()),
  await p2.evaluate(() => window.__taps.taps()),
  await p3.evaluate(() => window.__taps.taps()),
];

await p2.screenshot({ path: `${outDir}/2-joiner-sees-taps.png` });
await p1.screenshot({ path: `${outDir}/3-host-sees-taps.png` });

await browser.close();
relay.kill();

const rosterOk = true; // reaching here means all three waits passed
const hostTapSeenByAll = afterHostTap.every((n) => n >= 1);
const joinerTapSeenByAll = afterJoinerTap.every((n) => n >= 2);
const ok = rosterOk && hostTapSeenByAll && joinerTapSeenByAll && errors.length === 0;
console.log(JSON.stringify({ ok, code, afterHostTap, afterJoinerTap, errors }, null, 2));
process.exit(ok ? 0 : 1);
