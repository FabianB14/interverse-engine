// One-time PWA icon generator: renders each game's blob mascot to PNG
// (512/192/180) into games/<dir>/public/. Uses the local Chromium.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const GAMES = [
  { dir: 'hello', bg: '#1b1035', body: '#ff6f91' },
  { dir: 'room', bg: '#2b1d16', body: '#81b29a' },
  { dir: 'taps', bg: '#1b1035', body: '#6fc3ff' },
  { dir: 'blobvale', bg: '#16281c', body: '#6b4f8f' },
  { dir: '_template', bg: '#1b1035', body: '#ffc75f' },
];

function findChromium() {
  for (const d of readdirSync('/opt/pw-browsers')) {
    if (d.startsWith('chromium-')) return `/opt/pw-browsers/${d}/chrome-linux/chrome`;
  }
  return undefined;
}

const svg = (bg, body) => `<!doctype html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
  <rect width="64" height="64" rx="14" fill="${bg}"/>
  <circle cx="32" cy="35" r="22" fill="${body}" stroke="#ffffff" stroke-width="3"/>
  <circle cx="24.5" cy="30" r="3.4" fill="#2b2b3a"/>
  <circle cx="39.5" cy="30" r="3.4" fill="#2b2b3a"/>
  <circle cx="21" cy="40" r="3.2" fill="#000000" opacity="0.15"/>
  <circle cx="43" cy="40" r="3.2" fill="#000000" opacity="0.15"/>
</svg></body>`;

const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ['--no-sandbox'],
});
for (const g of GAMES) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(svg(g.bg, g.body));
  const out = `games/${g.dir}/public`;
  mkdirSync(out, { recursive: true });
  for (const size of [512, 192, 180]) {
    await page.setViewportSize({ width: size, height: size });
    await page.evaluate((s) => {
      const el = document.querySelector('svg');
      el.setAttribute('width', String(s));
      el.setAttribute('height', String(s));
    }, size);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    writeFileSync(`${out}/${name}`, png);
  }
  await page.close();
  console.log(`icons: games/${g.dir}/public`);
}
await browser.close();
