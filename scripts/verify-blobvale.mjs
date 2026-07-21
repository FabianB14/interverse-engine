// Headless Milestone-1 playtest for Blobvale: relay + THREE phones — host
// (knight) and two joiners (mage, rogue) — through lobby, class pick, and
// START ADVENTURE into the shared world. Verifies live position sync (a
// joiner sees the host's blob move) and quick-chat delivery. Run the dev
// server first (pnpm dev:blobvale), then:
//
//   node scripts/verify-blobvale.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5176/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
mkdirSync(outDir, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* playwright default */
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
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 20 && !up; i++) {
  try {
    up = (await fetch('http://localhost:8787/health')).ok;
  } catch {
    await sleep(250);
  }
}
if (!up) {
  console.error('relay did not come up');
  relay.kill();
  process.exit(1);
}

const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});
const errors = [];
async function phone(q, dpr = 1) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: dpr,
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${url}${q}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30_000 });
  return page;
}

// Host (knight) + two joiners with their own classes.
const p1 = await phone('?host=1&class=knight&name=Hosty');
await p1.waitForFunction(() => window.__blobvale?.scene() === 'lobby', null, { timeout: 10_000 });
const code = await p1.evaluate(() => window.__blobvale.code());
const p2 = await phone(`?join=${code}&class=mage&name=Ana`, 3);
const p3 = await phone(`?join=${code}&class=rogue&name=Ana`); // duplicate on purpose
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__blobvale?.playerCount() === 3, null, { timeout: 8_000 });
}
await sleep(400);
// BUGFIX checks: duplicate names deduped; late class re-pick propagates.
const namesSeen = await p2.evaluate(() => window.__blobvale.names());
const dedupeOk = namesSeen.includes('Ana Blob') && namesSeen.includes('Ana2 Blob');
await p3.evaluate(() => window.__blobvale.pick('cleric')); // was rogue — re-pick
await sleep(600);
const p3IdOnP2 = await p2.evaluate(() => {
  const c = window.__blobvale.classes();
  return Object.values(c);
});
const classFixOk = p3IdOnP2.filter((x) => x === 'cleric').length >= 1;
await p1.screenshot({ path: `${outDir}/bv-1-lobby.png` });

// Host starts the adventure -> everyone lands in the world.
await p1.evaluate(() => window.__blobvale.start());
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__blobvale?.scene() === 'world', null, { timeout: 10_000 });
}
await sleep(800);

// Host walks with the joystick; a joiner must see the host's blob move.
const hostId = await p1.evaluate(() => window.__blobvale.remoteIds() && null); // host has remotes only
const hostRemoteOnP2 = await p2.evaluate(() => window.__blobvale.remoteIds());
const before = await p2.evaluate((id) => window.__blobvale.remotePos(id), hostRemoteOnP2[0]);
const joy = await p1.evaluate(() => window.__blobvale.joystickScreen());
await p1.mouse.move(joy.x, joy.y);
await p1.mouse.down();
await p1.mouse.move(joy.x + 55, joy.y - 40, { steps: 5 });
await sleep(1200);
await p1.mouse.up();
await sleep(600);
const after = await p2.evaluate((id) => window.__blobvale.remotePos(id), hostRemoteOnP2[0]);
const movedSeen = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : 0;
const snaps = await p2.evaluate(() => window.__blobvale.snapsSeen());

// Joiner sends quick-chat; host must receive it.
const hostChatsBefore = await p1.evaluate(() => window.__blobvale.chatsSeen());
await p2.evaluate(() => window.__blobvale.sendChat(0)); // "Help!"
await sleep(700);
const hostChatsAfter = await p1.evaluate(() => window.__blobvale.chatsSeen());

// LATE JOIN: a 4th phone joins AFTER the adventure started; picking a class
// should drop it straight into the world, visible to everyone.
const p4 = await phone(`?join=${code}&class=cleric&name=Remy`);
await p4.waitForFunction(() => window.__blobvale?.scene() === 'world', null, { timeout: 12_000 });
await sleep(900);
const lateJoinerInWorld = await p4.evaluate(() => window.__blobvale.playerCount());
const remotesSeenByP2 = await p2.evaluate(() => window.__blobvale.remoteIds().length);
// COMBAT (M2): host warps to a mob camp and fights until a kill lands.
await p1.evaluate(() => window.__blobvale.revive());
await p1.evaluate(() => window.__blobvale.warp(1248, 980));
await sleep(500);
const mobsOnP2 = await p2.evaluate(() => window.__blobvale.mobCount());
for (let i = 0; i < 16; i++) {
  await p1.evaluate(() => window.__blobvale.cast());
  await sleep(350);
}
await sleep(500);
const killsHost = await p1.evaluate(() => window.__blobvale.kills());
const killsJoiner = await p2.evaluate(() => window.__blobvale.kills());
const statsHost = await p1.evaluate(() => window.__blobvale.myStats());
const combatOk =
  mobsOnP2 > 0 && killsHost >= 1 && killsJoiner >= 1 && (statsHost.xp > 0 || statsHost.lvl > 1);
// BOSS: host warps to the lair; joiner must see the boss lose HP.
await p1.evaluate(() => window.__blobvale.revive());
await p1.evaluate(() => window.__blobvale.warp(770, 290));
await sleep(600);
const bossBefore = await p2.evaluate(() => window.__blobvale.bossHp());
for (let i = 0; i < 10; i++) {
  await p1.evaluate(() => window.__blobvale.cast());
  await sleep(350);
}
await sleep(600);
const bossAfter = await p2.evaluate(() => window.__blobvale.bossHp());
const bossOk = bossBefore !== null && bossAfter !== null && bossAfter < bossBefore;
await p1.screenshot({ path: `${outDir}/bv-6-boss.png` });
// Retreat so slimes/boss stop chasing during rotation checks.
await p1.evaluate(() => window.__blobvale.warp(800, 1400));

// LANDSCAPE: rotate p3 mid-game; UI must reflow and the game keeps running.
const joyBefore = await p3.evaluate(() => window.__blobvale.joystickScreen());
await p3.setViewportSize({ width: 844, height: 390 });
await sleep(800);
const joyAfter = await p3.evaluate(() => window.__blobvale.joystickScreen());
const stillWorld = await p3.evaluate(() => window.__blobvale.scene());
const rotateOk =
  stillWorld === 'world' && Math.abs(joyAfter.y - joyBefore.y) > 40 && joyAfter.x > 0;
await p3.screenshot({ path: `${outDir}/bv-5-landscape.png` });
await p1.screenshot({ path: `${outDir}/bv-2-world-host.png` });
await p2.screenshot({ path: `${outDir}/bv-3-world-joiner.png` });
await p4.screenshot({ path: `${outDir}/bv-4-late-joiner.png` });

await browser.close();
relay.kill();

const ok =
  movedSeen > 30 &&
  snaps > 5 &&
  hostChatsAfter > hostChatsBefore &&
  lateJoinerInWorld === 4 &&
  combatOk &&
  rotateOk &&
  dedupeOk &&
  classFixOk &&
  bossOk &&
  errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      code,
      movedSeenByJoiner: Math.round(movedSeen),
      snapshotsReceived: snaps,
      chatDelivered: hostChatsAfter > hostChatsBefore,
      lateJoinerInWorld,
      remotesSeenByP2,
      mobsOnP2,
      killsHost,
      killsJoiner,
      statsHost,
      rotateOk,
      dedupeOk,
      classFixOk,
      bossOk,
      bossBefore,
      bossAfter,
      namesSeen,
      errors: errors.slice(0, 5),
      hostId,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
