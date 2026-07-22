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
const p2 = await phone(`?join=${code}&class=mage&name=Ana&look=4&acc=3&voice=5`, 3);
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
// CUSTOMIZATION: p2 chose shade 4, accessory 3, voice 5 — the host's roster
// must carry all three (M3 looks + M5 accessories/sounds).
const looksOnHost = await p1.evaluate(() => window.__blobvale.looks());
const lookOk = Object.values(looksOnHost).includes(4);
const accsOnHost = await p1.evaluate(() => window.__blobvale.accs());
const accOk = Object.values(accsOnHost).includes(3);
const voicesOnHost = await p1.evaluate(() => window.__blobvale.voices());
const voiceOk = Object.values(voicesOnHost).includes(5);
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
// M4: the host owns the 'bomb' mod, so every attack also drops a bomb —
// booms seen proves move-changing mods resolve host-side.
await p1.evaluate(() => window.__blobvale.revive());
await p1.evaluate(() => window.__blobvale.giveMod('bomb'));
await p1.evaluate(() => window.__blobvale.warp(1248, 980));
await sleep(500);
const mobsOnP2 = await p2.evaluate(() => window.__blobvale.mobCount());
for (let i = 0; i < 16; i++) {
  await p1.evaluate(() => window.__blobvale.cast());
  await sleep(350);
}
await sleep(1200);
const boomsHost = await p1.evaluate(() => window.__blobvale.booms());
const modsHost = await p1.evaluate(() => window.__blobvale.myStats()?.mods ?? []);
const modOk = boomsHost >= 1 && modsHost.includes('bomb');
const killsHost = await p1.evaluate(() => window.__blobvale.kills());
const killsJoiner = await p2.evaluate(() => window.__blobvale.kills());
const statsHost = await p1.evaluate(() => window.__blobvale.myStats());
const combatOk =
  mobsOnP2 > 0 && killsHost >= 1 && killsJoiner >= 1 && (statsHost.xp > 0 || statsHost.lvl > 1);
// UPGRADE CARDS: leveling opened an offer for the host; picking applies.
const offerOpen = await p1.evaluate(() => window.__blobvale.upgradeOpen());
const statsPre = await p1.evaluate(() => window.__blobvale.myStats());
await p1.evaluate(() => window.__blobvale.pickUpgrade(0));
await sleep(400);
const offerClosed = !(await p1.evaluate(() => window.__blobvale.upgradeOpen()));
const statsPost = await p1.evaluate(() => window.__blobvale.myStats());
const upgradeOk =
  offerOpen &&
  offerClosed &&
  ((statsPost.dmgMul ?? 1) > 1 ||
    statsPost.max > statsPre.max ||
    (statsPost.cdMul ?? 1) < 1 ||
    (statsPost.mods?.length ?? 0) > (statsPre.mods?.length ?? 0));
// CAST ZONE (M4): tapping the right half of the screen casts. p2 first
// closes any level-up offer that the shared camp XP opened.
for (let i = 0; i < 3; i++) {
  const open = await p2.evaluate(() => window.__blobvale.upgradeOpen());
  if (!open) break;
  await p2.evaluate(() => window.__blobvale.pickUpgrade(0));
  await sleep(300);
}
const castsBefore = await p2.evaluate(() => window.__blobvale.casts());
await p2.mouse.click(330, 500);
await sleep(300);
const castsAfter = await p2.evaluate(() => window.__blobvale.casts());
const castZoneOk = castsAfter > castsBefore;
// BOSS: host warps to the lair; joiner must see the boss lose HP. Kept to
// 5 casts so the (now beefier) boss survives for the cleric check below.
await p1.evaluate(() => window.__blobvale.revive());
await p1.evaluate(() => window.__blobvale.warp(770, 290));
await sleep(600);
const bossBefore = await p2.evaluate(() => window.__blobvale.bossHp());
for (let i = 0; i < 5; i++) {
  await p1.evaluate(() => window.__blobvale.cast());
  await sleep(350);
}
await sleep(600);
const bossAfter = await p2.evaluate(() => window.__blobvale.bossHp());
const bossOk = bossBefore !== null && bossAfter !== null && bossAfter < bossBefore;
await p1.screenshot({ path: `${outDir}/bv-6-boss.png` });
// CLERIC (M4): heal is an attack too — p4's smite must hurt the boss.
await p1.evaluate(() => window.__blobvale.revive());
await p1.evaluate(() => window.__blobvale.warp(800, 1400));
await p4.evaluate(() => window.__blobvale.warp(770, 340));
await sleep(600);
const bossBeforeCleric = await p2.evaluate(() => window.__blobvale.bossHp());
for (let i = 0; i < 10; i++) {
  await p4.evaluate(() => window.__blobvale.cast());
  await sleep(350);
}
await sleep(600);
const bossAfterCleric = await p2.evaluate(() => window.__blobvale.bossHp());
const clericOk =
  bossBeforeCleric !== null && (bossAfterCleric === null || bossAfterCleric < bossBeforeCleric);
// Retreat so slimes/boss stop chasing during rotation checks.
await p4.evaluate(() => window.__blobvale.warp(900, 1400));

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
  lookOk &&
  accOk &&
  voiceOk &&
  upgradeOk &&
  modOk &&
  castZoneOk &&
  clericOk &&
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
      lookOk,
      accOk,
      voiceOk,
      upgradeOk,
      modOk,
      boomsHost,
      castZoneOk,
      clericOk,
      bossBefore,
      bossAfter,
      bossBeforeCleric,
      bossAfterCleric,
      namesSeen,
      errors: errors.slice(0, 5),
      hostId,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
