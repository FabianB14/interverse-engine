// Headless test for family wallet sync: two isolated "phones" (separate
// storage, like two installed apps), device A uploads its wallet, device B
// enters the code — B must KEEP its own money and gain A's (additive), and
// the same code must refuse to apply twice. Run the farm dev server first:
//
//   node scripts/verify-sync.mjs [url]
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
    relayUp = (await fetch('http://localhost:8787/health')).ok;
  } catch {
    await sleep(250);
  }
}
if (!relayUp) {
  console.error('relay did not come up on :8787');
  relay.kill();
  process.exit(1);
}

const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});
const errors = [];
const q = '?relay=ws://localhost:8787';

async function phone(name) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console.error: ${m.text()}`);
  });
  await page.goto(`${url}${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__farm?.scene() === 'title', null, { timeout: 15_000 });
  await page.evaluate(() => window.__farm.settings());
  await page.waitForFunction(() => window.__farm?.scene() === 'settings', null, { timeout: 8_000 });
  return page;
}

// Device A: 777 in the wallet, upload it.
const a = await phone('A');
await a.evaluate(() => window.__farm.grantVerium(777));
const code = await a.evaluate(() => window.__farm.syncSend());
const sendOk = typeof code === 'string' && code.length === 5;
console.error(`sync code: ${code}`);

// Device B: has 100 of its own; receiving must ADD (money from both is kept).
const b = await phone('B');
await b.evaluate(() => window.__farm.grantVerium(100));
const beforeB = await b.evaluate(() => window.__farm.verium());
await b.evaluate(() => window.__farm.openReceive());
await b.waitForFunction(() => window.__farm?.scene() === 'syncenter', null, { timeout: 8_000 });
await b.evaluate((c) => window.__farm.setCode(c), code);
await b.evaluate(() => window.__farm.syncApply());
await sleep(900);
const afterB = await b.evaluate(() => window.__farm.verium());
const addOk = afterB === beforeB + 777;

// Re-applying the same code must be refused (no double money).
await b.evaluate(() => window.__farm.syncApply());
await sleep(600);
const afterRepeat = await b.evaluate(() => window.__farm.verium());
const guardOk = afterRepeat === afterB;

await b.screenshot({ path: `${outDir}/sync-b.png` });
await browser.close();
relay.kill();

const ok = sendOk && addOk && guardOk && errors.length === 0;
console.log(JSON.stringify({ ok, code, sendOk, beforeB, afterB, addOk, guardOk, errors }, null, 2));
process.exit(ok ? 0 : 1);
