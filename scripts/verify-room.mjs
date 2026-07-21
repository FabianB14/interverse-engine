// Headless playtest for the Cozy Room demo: walks with the virtual
// joystick, teleports next to Fern, taps her, plays through the dialogue
// (including a choice), and samples FPS. Run the room dev server first
// (pnpm dev:room), then:
//
//   node scripts/verify-room.mjs [url]
//
// Screenshots land in verify-shots/.
import { mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5174/';
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
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas', { timeout: 10_000 });
await page.waitForFunction(() => Boolean(window.__room), null, { timeout: 10_000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/1-room.png` });

// Walk up-left with the joystick for ~0.7s and confirm the player moved.
const p0 = await page.evaluate(() => window.__room.player());
const joy = await page.evaluate(() => window.__room.joystickScreen());
await page.mouse.move(joy.x, joy.y);
await page.mouse.down();
await page.mouse.move(joy.x - 40, joy.y - 55, { steps: 6 });
await page.waitForTimeout(700);
await page.mouse.up();
const p1 = await page.evaluate(() => window.__room.player());
const movedDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);

// Teleport just below Fern and tap her.
const npc = await page.evaluate(() => window.__room.npc());
await page.evaluate(({ x, y }) => window.__room.teleport(x, y + 90), { x: npc.x, y: npc.y });
await page.waitForTimeout(300); // camera catches up
const npcScreen = await page.evaluate(() => window.__room.npcScreen());
await page.mouse.click(Math.round(npcScreen.x), Math.round(npcScreen.y));
await page.waitForTimeout(400);
const dialogueOpened = await page.evaluate(() => window.__room.dialogueOpen());
await page.screenshot({ path: `${outDir}/2-dialogue.png` });

// Reveal intro, advance to the question, reveal it, then pick a choice.
const box = await page.evaluate(() => window.__room.boxScreen());
await page.mouse.click(box.x, box.y); // reveal all of "intro"
await page.waitForTimeout(250);
await page.mouse.click(box.x, box.y); // advance to "ask"
await page.waitForTimeout(300);
await page.mouse.click(box.x, box.y); // reveal all of "ask" -> choices appear
await page.waitForTimeout(400);
const choice = await page.evaluate(() => window.__room.choiceScreen(0));
let choiceWorked = false;
if (choice) {
  await page.mouse.click(Math.round(choice.x), Math.round(choice.y));
  await page.waitForTimeout(400);
  choiceWorked = (await page.evaluate(() => window.__room.nodeId())) === 'happy';
}
await page.screenshot({ path: `${outDir}/3-choice.png` });
await page.close();

// FPS pass at DPR 1 (the CI software renderer can't push 3x pixels).
const fpsPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await fpsPage.goto(url, { waitUntil: 'networkidle' });
await fpsPage.waitForSelector('canvas', { timeout: 10_000 });
await fpsPage.waitForTimeout(1000);
const fps = await fpsPage.evaluate(
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

await browser.close();

// Gate at 50 rather than 55: the CI software renderer (SwiftShader) is
// fill-bound on the fullscreen tilemap and lands a few frames under a real
// GPU. Phone hardware verification is the actual 60fps gate.
const ok = movedDist > 25 && dialogueOpened && choiceWorked && fps >= 50 && errors.length === 0;
console.log(
  JSON.stringify(
    { ok, movedDist: Math.round(movedDist), dialogueOpened, choiceWorked, fps, errors },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
