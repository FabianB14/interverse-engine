// Headless playtest for Blobhaven: starts the relay locally, opens TWO
// headless "phones" — one owns a world, decorates it, and opens it; the
// other joins by room code, sees the host's decor, and both see each
// other move and change cosmetics. Also exercises the friends list +
// presence directory end to end. Run the haven dev server first
// (pnpm dev:haven), then:
//
//   node scripts/verify-haven.mjs [url]
//
// Screenshots land in verify-shots/.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5186/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
mkdirSync(outDir, { recursive: true });

function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (read, ok, timeout = 10000) => {
  const until = Date.now() + timeout;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(120);
    v = await read();
  }
  return v;
};

// --- Start the relay (the presence directory needs the NEW build). ---
if (!existsSync('relay/dist/server.js')) {
  console.error('relay/dist missing — run: pnpm --filter @interverse/relay build');
  process.exit(1);
}
const relay = spawn('node', ['relay/dist/server.js'], {
  env: { ...process.env, PORT: '8787' },
  stdio: 'ignore',
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

const executablePath = findChromium();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
});

// Two devices = two isolated storage contexts, like two phones.
const hostCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const guestCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const hostPage = await hostCtx.newPage();
const guestPage = await guestCtx.newPage();
for (const [tag, p] of [['host', hostPage], ['guest', guestPage]]) {
  p.on('pageerror', (e) => console.log(`[${tag}] PAGEERROR`, e.message));
}

const boot = async (page, name, extra = '') => {
  await page.goto(`${url}?fresh=1&name=${name}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__haven, null, { timeout: 30000 });
  await sleep(800);
};

const S = (page) => page.evaluate(() => window.__haven.state());

await boot(hostPage, 'Hosty');
const s0 = await S(hostPage);

// --- Solo world gates -------------------------------------------------
// Starter world: a lived-in corner, third person, standing in the yard.
const bootOk = s0.room === 'yard' && s0.decor === 4 && s0.cam === 'third' && !s0.visiting;

// Camera modes: first person hides the body and drops the lens to the
// eyes; third person shows it from up behind.
await hostPage.evaluate(() => window.__haven.setCam('first'));
await sleep(300);
const sFirst = await S(hostPage);
await hostPage.screenshot({ path: `${outDir}/hv-1-first.png` });
await hostPage.evaluate(() => window.__haven.setCam('third'));
await sleep(300);
const sThird = await S(hostPage);
await hostPage.screenshot({ path: `${outDir}/hv-2-third.png` });
const cameraOk =
  sFirst.cam === 'first' && sFirst.playerVisible === false && sFirst.camY < 130 &&
  sThird.cam === 'third' && sThird.playerVisible === true && sThird.camY > 150;

// The house: walk in through the door trigger (warp to the doorstep and
// push forward via the debug hook's enterHouse — the trigger itself is
// the same rectangle the door art draws).
await hostPage.evaluate(() => window.__haven.enterHouse());
await sleep(300);
const sHouse = await S(hostPage);
// Decorate inside: place a table and a bed.
await hostPage.evaluate(() => {
  window.__haven.setDecorMode(true, 'table');
  window.__haven.placeAt('table', 120, -80);
  window.__haven.placeAt('bed', -260, -180);
});
await sleep(400);
await hostPage.screenshot({ path: `${outDir}/hv-3-house.png` });
const sDecor = await S(hostPage);
const houseOk = sHouse.room === 'house' && sDecor.decor === 6;
// A yard-only item must refuse to land in the house.
const refuseOk = !(await hostPage.evaluate(() => window.__haven.placeAt('fountain', 0, 0)));

// Persistence: reload WITHOUT ?fresh — the table and bed are still there.
await hostPage.goto(`${url}?name=Hosty`, { waitUntil: 'load' });
await hostPage.waitForFunction(() => !!window.__haven, null, { timeout: 30000 });
await sleep(800);
const sReload = await S(hostPage);
const persistOk = sReload.decor === 6;

// --- Social gates -----------------------------------------------------
// Open the world; the code comes back and presence goes up.
const code = await hostPage.evaluate(() => window.__haven.openWorld());
const codeOk = typeof code === 'string' && code.length === 4;
const hostProfile = await hostPage.evaluate(() => window.__haven.profile());

// Guest boots on its own device and knocks with the room code.
await boot(guestPage, 'Visita');
await guestPage.evaluate((c) => window.__haven.visit(c), code);
const gVisit = await waitFor(() => S(guestPage), (s) => s.visiting === true);
// The guest stands in the HOST's world: 6 furnishings, host's name up top.
const visitOk = gVisit.visiting === true && gVisit.hostName === 'Hosty' && gVisit.decor === 6;

// Both sides see a friend arrive.
const hAfterJoin = await waitFor(() => S(hostPage), (s) => s.guests >= 1);
const gAfterJoin = await waitFor(() => S(guestPage), (s) => s.guests >= 1);
const meetOk = hAfterJoin.guests === 1 && gAfterJoin.guests === 1;

// Movement streams: the guest walks; the host watches the blob drift there.
await guestPage.evaluate(() => window.__haven.warp(420, 260));
const hSeesMove = await waitFor(
  () => S(hostPage),
  (s) => s.othersHere.length === 1 && Math.hypot(s.othersHere[0].x - 420, s.othersHere[0].z - 260) < 60,
);
const moveOk =
  hSeesMove.othersHere.length === 1 &&
  Math.hypot(hSeesMove.othersHere[0].x - 420, hSeesMove.othersHere[0].z - 260) < 60;

// Cosmetics stream: the guest crowns itself; the host sees the crown.
await guestPage.evaluate(() => window.__haven.setHat('crown'));
const hSeesHat = await waitFor(() => S(hostPage), (s) => s.othersHere[0]?.hat === 'crown');
const hatOk = hSeesHat.othersHere[0]?.hat === 'crown';
await hostPage.screenshot({ path: `${outDir}/hv-4-guests.png` });
await guestPage.screenshot({ path: `${outDir}/hv-5-visiting.png` });

// Friendships form by visiting — both sides now remember each other.
const hFriends = await hostPage.evaluate(() => window.__haven.friends());
const gFriends = await guestPage.evaluate(() => window.__haven.friends());
const guestProfile = await guestPage.evaluate(() => window.__haven.profile());
const friendsOk =
  hFriends.some((f) => f.code === guestProfile.friendCode) &&
  gFriends.some((f) => f.code === hostProfile.friendCode);

// Presence: the guest's friends list shows the host ONLINE (their world
// is open) with a knockable room code behind it.
await guestPage.evaluate(() => window.__haven.poll());
await sleep(400);
const gFriends2 = await guestPage.evaluate(() => window.__haven.friends());
const presenceOk = gFriends2.some((f) => f.code === hostProfile.friendCode && f.online);

// Going home: the guest returns to its OWN world (4 starter pieces).
await guestPage.evaluate(() => window.__haven.goHome());
const gHome = await waitFor(() => S(guestPage), (s) => s.visiting === false);
const homeOk = gHome.visiting === false && gHome.decor === 4;
const hostAfterLeave = await waitFor(() => S(hostPage), (s) => s.guests === 0);
const leaveOk = hostAfterLeave.guests === 0;

const gates = {
  bootOk, cameraOk, houseOk, refuseOk, persistOk, codeOk, visitOk, meetOk,
  moveOk, hatOk, friendsOk, presenceOk, homeOk, leaveOk,
};
console.log(JSON.stringify({ ...gates, code, s0, sFirst: sFirst.camY, sThird: sThird.camY }, null, 2));

await browser.close();
relay.kill();
const pass = Object.values(gates).every(Boolean);
console.log(pass ? 'HAVEN VERIFY: ALL GATES PASS' : 'HAVEN VERIFY: FAILURES ABOVE');
process.exit(pass ? 0 : 1);
