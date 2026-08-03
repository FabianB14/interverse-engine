// Headless playtest for Blobhaven: starts the relay locally, opens TWO
// headless "phones" — one owns a world, shops with ⬡ Verium (hat, manor
// upgrade, theme, model statue), decorates its loft, and opens the world;
// the other joins by room code, sees the host's manor + decor, and both
// see each other move and change cosmetics. Friends + presence ride the
// same run. Run the haven dev server first (pnpm dev:haven), then:
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
// 10× island, starter decor, third person, and the ⬡200 welcome gift.
const bootOk =
  s0.room === 'yard' && s0.decor === 4 && s0.cam === 'third' && !s0.visiting &&
  s0.worldR === 3650 && s0.houseSize === 'cozy' && s0.verium >= 200;

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

// --- Store gates ------------------------------------------------------
// A hat the welcome gift can afford: ⬡40 cap, worn on purchase.
const vBefore = s0.verium;
const capBought = await hostPage.evaluate(() => window.__haven.buy('hat', 'cap'));
const sCap = await S(hostPage);
const hatBuyOk = capBought && sCap.verium === vBefore - 40 && (await hostPage.evaluate(() => window.__haven.profile())).hat === 'cap';
// Broke blobs can't buy manors: 800 > balance right now.
const brokeOk = !(await hostPage.evaluate(() => window.__haven.buy('house', 'manor')));
// Fund the rest of the spree: manor + dusk theme + gnome statue.
await hostPage.evaluate(() => window.__haven.grant(2000));
const manorOk = await hostPage.evaluate(() => window.__haven.buy('house', 'manor'));
const themeOk = await hostPage.evaluate(() => window.__haven.buy('theme', 'dusk'));
const gnomeOk = await hostPage.evaluate(() => window.__haven.buy('furniture', 'gnome'));
await sleep(600);
const sManor = await S(hostPage);
const storeOk = manorOk && themeOk && gnomeOk && sManor.houseSize === 'manor' && sManor.houseTheme === 'dusk';
await hostPage.screenshot({ path: `${outDir}/hv-3-manor.png` });

// Model decor: place the bought gnome statue in the yard; the .glb load
// must land (modelStats counts finished loads).
await hostPage.evaluate(() => {
  window.__haven.setDecorMode(true, 'gnome');
  window.__haven.placeAt('gnome', 300, 500);
});
const sModel = await waitFor(() => S(hostPage), (s) => s.modelsLoaded >= 1, 15000);
const modelOk = sModel.modelsLoaded >= 1 && sModel.decor === 5;

// The manor's loft: upstairs is a real room you can furnish.
await hostPage.evaluate(() => window.__haven.enterHouse());
await sleep(300);
const sHouse = await S(hostPage);
await hostPage.evaluate(() => window.__haven.goUpstairs());
await sleep(300);
const sLoft = await S(hostPage);
await hostPage.evaluate(() => window.__haven.placeAt('bed', 100, 0));
await sleep(400);
const sLoftBed = await S(hostPage);
await hostPage.screenshot({ path: `${outDir}/hv-4-loft.png` });
const loftOk = sHouse.room === 'house' && sLoft.room === 'loft' && sLoftBed.decor === 6;
// A yard-only item must refuse to land indoors.
const refuseOk = !(await hostPage.evaluate(() => window.__haven.placeAt('fountain', 0, 0)));
await hostPage.evaluate(() => window.__haven.goDownstairs());
await hostPage.evaluate(() => window.__haven.exitHouse());

// Persistence: reload WITHOUT ?fresh — manor, theme, gnome, loft bed and
// the wallet all survive (and the welcome gift does NOT pay twice).
const vPreReload = (await S(hostPage)).verium;
await hostPage.goto(`${url}?name=Hosty`, { waitUntil: 'load' });
await hostPage.waitForFunction(() => !!window.__haven, null, { timeout: 30000 });
await sleep(800);
const sReload = await S(hostPage);
const persistOk =
  sReload.decor === 6 && sReload.houseSize === 'manor' && sReload.houseTheme === 'dusk' &&
  sReload.verium === vPreReload;

// The daily gift: one tap pays ⬡60, the second tap is told "tomorrow".
await hostPage.evaluate(() => document.getElementById('b-store').click());
await sleep(200);
await hostPage.evaluate(() => document.getElementById('s-daily').click());
await sleep(200);
const sDaily = await S(hostPage);
const dailyDisabled = await hostPage.evaluate(() => document.getElementById('s-daily').disabled);
const dailyOk = sDaily.verium === sReload.verium + 60 && dailyDisabled === true;
await hostPage.evaluate(() => document.querySelector('#store .close').click());

// --- Social gates -----------------------------------------------------
const code = await hostPage.evaluate(() => window.__haven.openWorld());
const codeOk = typeof code === 'string' && code.length === 4;
const hostProfile = await hostPage.evaluate(() => window.__haven.profile());

// Guest boots on its own device and knocks with the room code.
await boot(guestPage, 'Visita');
await guestPage.evaluate((c) => window.__haven.visit(c), code);
const gVisit = await waitFor(() => S(guestPage), (s) => s.visiting === true);
// The guest stands in the HOST's world: the manor, the theme, 6 pieces.
const visitOk =
  gVisit.visiting === true && gVisit.hostName === 'Hosty' && gVisit.decor === 6 &&
  gVisit.houseSize === 'manor' && gVisit.houseTheme === 'dusk';

// Both sides see a friend arrive — and both got the new-friend ⬡ bonus.
const hAfterJoin = await waitFor(() => S(hostPage), (s) => s.guests >= 1);
const gAfterJoin = await waitFor(() => S(guestPage), (s) => s.guests >= 1);
const meetOk = hAfterJoin.guests === 1 && gAfterJoin.guests === 1;
const friendBonusOk = gAfterJoin.verium >= 200 + 25;

// Movement streams: the guest walks; the host watches the blob drift there.
await guestPage.evaluate(() => window.__haven.warp(420, 260));
const hSeesMove = await waitFor(
  () => S(hostPage),
  (s) => s.othersHere.length === 1 && Math.hypot(s.othersHere[0].x - 420, s.othersHere[0].z - 260) < 60,
);
const moveOk =
  hSeesMove.othersHere.length === 1 &&
  Math.hypot(hSeesMove.othersHere[0].x - 420, hSeesMove.othersHere[0].z - 260) < 60;

// Cosmetics stream: the guest buys + wears a crown; the host sees it.
await guestPage.evaluate(() => {
  window.__haven.grant(500);
  window.__haven.buy('hat', 'crown');
});
const hSeesHat = await waitFor(() => S(hostPage), (s) => s.othersHere[0]?.hat === 'crown');
const hatSyncOk = hSeesHat.othersHere[0]?.hat === 'crown';
await hostPage.screenshot({ path: `${outDir}/hv-5-guests.png` });
await guestPage.screenshot({ path: `${outDir}/hv-6-visiting.png` });

// Friendships form by visiting — both sides now remember each other.
const hFriends = await hostPage.evaluate(() => window.__haven.friends());
const gFriends = await guestPage.evaluate(() => window.__haven.friends());
const guestProfile = await guestPage.evaluate(() => window.__haven.profile());
const friendsOk =
  hFriends.some((f) => f.code === guestProfile.friendCode) &&
  gFriends.some((f) => f.code === hostProfile.friendCode);

// Presence: the guest's friends list shows the host ONLINE with a
// knockable room code behind it.
await guestPage.evaluate(() => window.__haven.poll());
await sleep(400);
const gFriends2 = await guestPage.evaluate(() => window.__haven.friends());
const presenceOk = gFriends2.some((f) => f.code === hostProfile.friendCode && f.online);

// Going home: the guest returns to its OWN world (cozy, 4 starters).
await guestPage.evaluate(() => window.__haven.goHome());
const gHome = await waitFor(() => S(guestPage), (s) => s.visiting === false);
const homeOk = gHome.visiting === false && gHome.decor === 4 && gHome.houseSize === 'cozy';
const hostAfterLeave = await waitFor(() => S(hostPage), (s) => s.guests === 0);
const leaveOk = hostAfterLeave.guests === 0;

const gates = {
  bootOk, cameraOk, hatBuyOk, brokeOk, storeOk, modelOk, loftOk, refuseOk,
  persistOk, dailyOk, codeOk, visitOk, meetOk, friendBonusOk, moveOk,
  hatSyncOk, friendsOk, presenceOk, homeOk, leaveOk,
};
console.log(JSON.stringify({ ...gates, code, verium: sDaily.verium }, null, 2));

await browser.close();
relay.kill();
const pass = Object.values(gates).every(Boolean);
console.log(pass ? 'HAVEN VERIFY: ALL GATES PASS' : 'HAVEN VERIFY: FAILURES ABOVE');
process.exit(pass ? 0 : 1);
