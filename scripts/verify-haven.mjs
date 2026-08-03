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

// 🐾 A pet: buy the dino, set it loose in the yard, and watch it LIVE —
// it must wander away from where it was dropped (and hop doing it).
await hostPage.evaluate(() => {
  window.__haven.grant(300);
  window.__haven.buy('furniture', 'dino');
  window.__haven.placeAt('dino', 600, 800);
});
const sPet = await waitFor(
  () => S(hostPage),
  (s) => s.pets.length >= 1 && Math.hypot(s.pets[0].x - 600, s.pets[0].z - 800) > 30,
  20000,
);
const petOk = sPet.pets.length >= 1 && Math.hypot(sPet.pets[0].x - 600, sPet.pets[0].z - 800) > 30;

// 🦘 The jump: up on the impulse, back on the ground shortly after.
await hostPage.evaluate(() => window.__haven.jump());
const sAir = await waitFor(() => S(hostPage), (s) => s.playerY > 20, 3000);
const sLand = await waitFor(() => S(hostPage), (s) => s.playerY === 0, 3000);
const jumpOk = sAir.playerY > 20 && sLand.playerY === 0;

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
const loftOk = sHouse.room === 'house' && sLoft.room === 'loft' && sLoftBed.decor === 7;
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
  sReload.decor === 7 && sReload.houseSize === 'manor' && sReload.houseTheme === 'dusk' &&
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
  gVisit.visiting === true && gVisit.hostName === 'Hosty' && gVisit.decor === 7 &&
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

// The jump crosses the wire: host hops, the guest's copy of the host
// leaves the ground.
await hostPage.evaluate(() => window.__haven.jump());
const gSeesJump = await waitFor(() => S(guestPage), (s) => (s.othersHere[0]?.y ?? 0) > 15, 4000);
const jumpSyncOk = (gSeesJump.othersHere[0]?.y ?? 0) > 15;

// 🧍 Avatars: the host trades the blob for The Bag; the guest's copy of
// the host rebuilds with the model body.
const bagBought = await hostPage.evaluate(() => {
  window.__haven.grant(500);
  return window.__haven.buy('avatar', 'bag');
});
const hBag = await waitFor(() => S(hostPage), (s) => s.avatar === 'bag');
const gSeesBag = await waitFor(() => S(guestPage), (s) => s.othersHere[0]?.avatar === 'bag', 8000);
const avatarOk = bagBought && hBag.avatar === 'bag' && gSeesBag.othersHere[0]?.avatar === 'bag';
await hostPage.screenshot({ path: `${outDir}/hv-9-bag.png` });

// 🎟 Redeem codes: a giveaway code unlocks the Gothic Girl for FREE (no
// ⬡ moves), a junk code unlocks nothing.
const vBeforeCode = (await S(guestPage)).verium;
const badOk = !(await guestPage.evaluate(() => window.__haven.redeem('NOTACODE')));
const redeemed = await guestPage.evaluate(() => window.__haven.redeem('nightbloom'));
const gGoth = await waitFor(() => S(guestPage), (s) => s.avatar === 'gothic');
const redeemOk =
  badOk && redeemed && gGoth.avatar === 'gothic' && gGoth.verium === vBeforeCode;
// …and the host sees the guest's new body arrive over the wire.
const hSeesGoth = await waitFor(() => S(hostPage), (s) => s.othersHere[0]?.avatar === 'gothic', 8000);
const redeemSyncOk = hSeesGoth.othersHere[0]?.avatar === 'gothic';
await guestPage.screenshot({ path: `${outDir}/hv-10-gothic.png` });
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

// --- Haven 3.0 gates --------------------------------------------------
// 🎟 Every avatar has a code, including The Bag; a redeem in the store
// UI lands you on the AVATARS shelf with the new body equipped.
await hostPage.evaluate(() => document.getElementById('b-store').click());
await sleep(200);
await hostPage.evaluate(() => {
  document.getElementById('s-code').value = 'GIFTBAG';
  document.getElementById('s-redeem').click();
});
await sleep(400);
const bagRows = await hostPage.evaluate(() =>
  [...document.querySelectorAll('#s-list .friend')].map((d) => d.textContent.trim()),
);
const sBagCode = await S(hostPage);
const bagCodeOk =
  sBagCode.avatar === 'bag' && bagRows.some((r) => r.includes('The Bag') && r.includes('Using'));
await hostPage.evaluate(() => document.querySelector('#store .close').click());

// 🚶 The residents: four villagers wander the yard; walking a patch means
// SOMEONE has left their exact home spot within a few seconds; a tap
// (here via the debug hook) gets a spoken line.
const HOMES = { Maple: [260, 700], Pip: [1000, 900], Bruno: [-900, -300], Luna: [-400, 1400] };
const sNpc = await waitFor(
  () => S(hostPage),
  (s) =>
    s.npcs.length === 4 &&
    s.npcs.some((n) => Math.hypot(n.x - HOMES[n.name][0], n.z - HOMES[n.name][1]) > 40),
  20000,
);
const npcsOk =
  sNpc.npcs.length === 4 &&
  sNpc.npcs.some((n) => Math.hypot(n.x - HOMES[n.name][0], n.z - HOMES[n.name][1]) > 40);
const line1 = await hostPage.evaluate(() => window.__haven.npcTalk('Maple'));
const line2 = await hostPage.evaluate(() => window.__haven.npcTalk('Maple'));
const sTalk = await S(hostPage);
const talkOk =
  line1.startsWith('Maple:') && line2.startsWith('Maple:') && line1 !== line2 &&
  sTalk.lastNpcLine === line2;
await hostPage.evaluate((h) => window.__haven.warp(h[0], h[1] + 200), HOMES.Maple);
await sleep(600);
await hostPage.screenshot({ path: `${outDir}/hv-13-npc.png` });

// 🏊 The pond: swim in (low + slow), wade out (back to ground level).
await hostPage.evaluate(() => window.__haven.warp(1500, 1100));
const sSwim = await waitFor(() => S(hostPage), (s) => s.swimming === true && s.playerY < -15);
await hostPage.screenshot({ path: `${outDir}/hv-12-swim.png` });
await hostPage.evaluate(() => window.__haven.warp(600, 300));
const sDry = await waitFor(() => S(hostPage), (s) => s.swimming === false && s.playerY === 0);
const swimOk = sSwim.swimming && sSwim.playerY < -15 && !sDry.swimming && sDry.playerY === 0;

// 🤸 The trampoline: land on it, leave the ground without pressing jump.
await hostPage.evaluate(() => {
  window.__haven.grant(400);
  window.__haven.buy('furniture', 'tramp');
  window.__haven.setDecorMode(true, 'tramp');
  window.__haven.placeAt('tramp', 900, -200);
  window.__haven.setDecorMode(false);
  window.__haven.warp(900, -200);
});
const sBounce = await waitFor(() => S(hostPage), (s) => s.playerY > 60, 5000);
const bounceOk = sBounce.playerY > 60;

// 💰 The Verium vault: the relay mirrors the wallet under the friend
// code; a NEWER mirror (another device) is adopted on pull; a stale one
// is not.
await hostPage.evaluate(() => window.__haven.walletPush());
await sleep(600);
const hostCode2 = (await hostPage.evaluate(() => window.__haven.profile())).friendCode;
const hostWallet = await hostPage.evaluate(() => window.__haven.walletState());
const mirrored = await (await fetch(`http://localhost:8787/wallet/${hostCode2}`)).json();
const mirrorOk = mirrored.balance === hostWallet.balance && mirrored.seq === hostWallet.seq;
// "Another device" pushes a newer state…
await fetch(`http://localhost:8787/wallet/${hostCode2}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ balance: hostWallet.balance + 500, seq: hostWallet.seq + 10 }),
});
const adopted = await hostPage.evaluate(() => window.__haven.walletPull());
const afterPull = await hostPage.evaluate(() => window.__haven.walletState());
// …and a STALE push must be ignored by the vault.
await fetch(`http://localhost:8787/wallet/${hostCode2}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ balance: 1, seq: 1 }),
});
const staleCheck = await (await fetch(`http://localhost:8787/wallet/${hostCode2}`)).json();
const vaultOk =
  mirrorOk && adopted === true && afterPull.balance === hostWallet.balance + 500 &&
  staleCheck.balance === hostWallet.balance + 500;

// 🦴 The chop-rigged Rex: real clips. avatarClip is read straight off the
// AnimationMixer, so 'idle'/'walk' here means the baked clips ARE playing —
// and frame differencing proves the pixels move too.
await hostPage.evaluate(() => window.__haven.redeem('RAWR'));
await waitFor(() => S(hostPage), (s) => s.avatar === 'trex' && s.avatarClip === 'idle', 8000);
await sleep(600);
// Standing still must still be ALIVE: weight-shift + arm sway + tail wag.
const idleA = await hostPage.screenshot();
await sleep(450); // a quarter of the 1.8s idle cycle — max pose contrast
const idleB = await hostPage.screenshot();
await hostPage.screenshot({ path: `${outDir}/hv-14-rexidle.png` });
const rexIdleOk = !idleA.equals(idleB) && (await S(hostPage)).avatarClip === 'idle';
await hostPage.keyboard.down('w');
await sleep(300);
const shotA = await hostPage.screenshot();
await sleep(160);
const shotB = await hostPage.screenshot();
await hostPage.screenshot({ path: `${outDir}/hv-14-rexrun.png` });
const midRunClip = (await S(hostPage)).avatarClip;
await hostPage.keyboard.up('w');
// Mid-stride frames must differ (legs scissor); identical pixels would
// mean the clips are not playing.
const rexRunOk = !shotA.equals(shotB) && midRunClip === 'walk';

// 👗 The dress-rigged Gothic Girl: same contract as Rex — idle clip live
// while standing, walk clip live mid-stride (her skirt sways as ONE piece).
await hostPage.evaluate(() => window.__haven.redeem('NIGHTBLOOM'));
await waitFor(() => S(hostPage), (s) => s.avatar === 'gothic' && s.avatarClip === 'idle', 12000);
await hostPage.keyboard.down('w');
await sleep(300);
const gothicMidRun = (await S(hostPage)).avatarClip;
await hostPage.screenshot({ path: `${outDir}/hv-15-gothicrun.png` });
await hostPage.keyboard.up('w');
await sleep(400);
const gothicOk = gothicMidRun === 'walk' && (await S(hostPage)).avatarClip === 'idle';

// 🔗 Wallet sync codes (the Bloomstead flow): Send mints a code, Receive
// ADDS once on another device, and a replay is refused.
const syncCode = await hostPage.evaluate(() => window.__haven.walletSyncSend());
const gBefore = (await S(guestPage)).verium;
const hostBal = (await S(hostPage)).verium;
const added = await guestPage.evaluate((c) => window.__haven.walletSyncReceive(c), syncCode);
const gAfter = (await S(guestPage)).verium;
const replay = await guestPage.evaluate((c) => window.__haven.walletSyncReceive(c), syncCode);
const syncOk =
  typeof syncCode === 'string' && syncCode.length === 5 &&
  added === hostBal && gAfter === gBefore + hostBal && replay === null;

const gates = {
  bootOk, cameraOk, hatBuyOk, brokeOk, storeOk, modelOk, petOk, jumpOk,
  loftOk, refuseOk, persistOk, dailyOk, codeOk, visitOk, meetOk,
  friendBonusOk, moveOk, hatSyncOk, jumpSyncOk, avatarOk, redeemOk, redeemSyncOk, friendsOk, presenceOk,
  homeOk, leaveOk, bagCodeOk, npcsOk, talkOk, swimOk, bounceOk, vaultOk,
  rexIdleOk, rexRunOk, gothicOk, syncOk,
};
console.log(JSON.stringify({ ...gates, code, verium: sDaily.verium }, null, 2));

await browser.close();
relay.kill();
const pass = Object.values(gates).every(Boolean);
console.log(pass ? 'HAVEN VERIFY: ALL GATES PASS' : 'HAVEN VERIFY: FAILURES ABOVE');
process.exit(pass ? 0 : 1);
