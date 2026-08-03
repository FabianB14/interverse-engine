import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
function findChromium() {
  try { for (const d of readdirSync('/opt/pw-browsers')) if (d.startsWith('chromium-')) return `/opt/pw-browsers/${d}/chrome-linux/chrome`; } catch { /* */ }
  return undefined;
}
const browser = await chromium.launch({ ...(findChromium() ? { executablePath: findChromium() } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5186/?fresh=1&name=CodeUser', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__haven, null, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
// The UI path, exactly as a player does it: open store, type, click.
await page.evaluate(() => document.getElementById('b-store').click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  document.getElementById('s-code').value = 'NIGHTBLOOM';
  document.getElementById('s-redeem').click();
});
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => ({
  state: window.__haven.state().avatar,
  owned: window.__haven.owned().avatars,
}));
console.log('after redeem:', JSON.stringify(after));
// Now the avatars tab: what do the rows SAY?
await page.evaluate(() => {
  for (const b of document.querySelectorAll('#s-tabs button')) if (b.textContent.includes('Avatars')) b.click();
});
await new Promise((r) => setTimeout(r, 500));
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('#s-list .friend')].map((d) => d.textContent.trim()),
);
console.log('rows:', JSON.stringify(rows));
// And across a RELOAD (the report smells like lost persistence):
await page.goto('http://localhost:5186/?name=CodeUser', { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__haven, null, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800));
const reloaded = await page.evaluate(() => ({
  state: window.__haven.state().avatar,
  owned: window.__haven.owned().avatars,
}));
console.log('after reload:', JSON.stringify(reloaded));
await browser.close();
