// Headless playtest for Hushfall: relay + THREE phones — a host Seeker
// (Stalker) and two Hider joiners (Scout, Engineer) — through the lobby, role
// assignment, and START into a match. Exercises the core loop: objective
// progress (a lantern lights), an ability reveal, a down + rescue, gate open,
// escape, and the win condition. Run the dev server first (pnpm dev:hushfall):
//
//   node scripts/verify-hushfall.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5178/';
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
  // Anti-throttle flags: without these, Chromium slows the update loop (and so
  // the 10Hz position sends) of every non-foreground page, which stalls the
  // host-authoritative sim for background players.
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
const errors = [];
const q = 'relay=ws://localhost:8787';

async function phone(params) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`${url}?${params}&${q}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30_000 });
  return page;
}

// Host is the Seeker (Warden — Third Eye vision boost); a Lookout (Sense
// reveal) and an Engineer (objectives) join as Hiders.
const p1 = await phone('host=1&seeker=1&class=warden&name=Warden');
await p1.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
const code = await p1.evaluate(() => window.__hushfall.code());
const p2 = await phone(`join=${code}&class=lookout&name=Looky`);
const p3 = await phone(`join=${code}&class=engineer&name=Gears`);
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__hushfall?.playerCount() === 3, null, { timeout: 10_000 });
}
await sleep(400);

// ROLES: exactly one seeker (the host), two hiders.
const roles = await p1.evaluate(() => window.__hushfall.roles());
const seekerId = await p1.evaluate(() => window.__hushfall.seekerId());
const seekers = Object.values(roles).filter((r) => r === 'seeker').length;
const rolesOk =
  seekers === 1 && Object.values(roles).filter((r) => r === 'hider').length === 2 && !!seekerId;
await p1.screenshot({ path: `${outDir}/hf-1-lobby.png` });

// SELECT LOCK: browsing is open, but once Looky SELECTS Lookout it's locked
// for everyone else — and UNSELECT opens it right back up.
await p2.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(600);
await p3.evaluate(() => window.__hushfall.pick('lookout')); // locked → refused
await sleep(600);
const lockedClasses = await p1.evaluate(() => window.__hushfall.classes());
const lockedCounts = Object.values(lockedClasses).reduce(
  (m, c) => ((m[c] = (m[c] ?? 0) + 1), m),
  {},
);
const lockHeld = (lockedCounts['lookout'] ?? 0) === 1;
await p2.evaluate(() => window.__hushfall.setLocked?.(false));
await sleep(600);
await p3.evaluate(() => window.__hushfall.pick('lookout')); // open again → shared browse
await sleep(600);
const openClasses = await p1.evaluate(() => window.__hushfall.classes());
const openCounts = Object.values(openClasses).reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
const lockReleased = (openCounts['lookout'] ?? 0) === 2;
await p3.evaluate(() => window.__hushfall.pick('engineer')); // restore for later gates
await sleep(400);
const lockOk = lockHeld && lockReleased;

// PUBLIC ROOMS: flipping the lobby 🌐 PUBLIC lists it in the relay's room
// browser (with a live player count); flipping back to 🔒 PRIVATE removes
// it. Private is the default — this room was invisible until now.
const listedBefore = await (await fetch('http://localhost:8787/rooms?game=hushfall')).json();
const wasHidden = !(listedBefore.rooms ?? []).some((r) => r.code === code);
await p1.evaluate(() => window.__hushfall.setPublic?.(true));
await sleep(500);
const listedOn = await (await fetch('http://localhost:8787/rooms?game=hushfall')).json();
const listing = (listedOn.rooms ?? []).find((r) => r.code === code);
await p1.evaluate(() => window.__hushfall.setPublic?.(false));
await sleep(500);
const listedOff = await (await fetch('http://localhost:8787/rooms?game=hushfall')).json();
const unlisted = !(listedOff.rooms ?? []).some((r) => r.code === code);
const publicOk = wasHidden && !!listing && listing.players === 3 && unlisted;

// SELECT GATE: the hunt refuses to start while any human hider is still
// just browsing — commit with SELECT first.
await p1.evaluate(() => window.__hushfall.start());
await sleep(1200);
const selectGateOk = (await p1.evaluate(() => window.__hushfall.scene())) === 'lobby';
await p2.evaluate(() => window.__hushfall.setLocked?.(true));
await p3.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(600);

// START -> everyone in the match, opening in the HIDE PHASE (the Seeker
// counts blindfolded while hiders scatter), then the host skips the count
// so the rest of the playtest runs at full speed.
await p1.evaluate(() => window.__hushfall.start());
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
}
await sleep(800);
const phaseAtStart = await p1.evaluate(() => window.__hushfall.phase());
// Walls must block line of sight (checked against the real tile grid).
const losOk = await p1.evaluate(() => window.__hushfall.losSelfTest?.() ?? false);
await p1.evaluate(() => window.__hushfall.skipHide());
await p1.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
const hidePhaseOk = phaseAtStart === 'hiding';

const p1Role = await p1.evaluate(() => window.__hushfall.myRole());
const p2Role = await p2.evaluate(() => window.__hushfall.myRole());
const startRolesOk = p1Role === 'seeker' && p2Role === 'hider';

// A hider can see where the Seeker is (host authoritative position sync).
const seekerPosOnP2 = await p2.evaluate(() => window.__hushfall.seekerPos());
const seekerVisibleOk = seekerPosOnP2 && Number.isFinite(seekerPosOnP2.x);

// OBJECTIVE: the Engineer stands on a lantern; it lights within a few seconds.
const lanternCount = await p1.evaluate(() => window.__hushfall.lanternCount());
const lp = await p3.evaluate(() => window.__hushfall.lanternPos(0));
// Keep the Engineer planted on the lantern (re-warp each second) so a slow
// headless sim can't drift them off before it lights.
let litYet = false;
for (let i = 0; i < 24 && !litYet; i++) {
  await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp);
  await sleep(1000);
  litYet = (await p3.evaluate(() => window.__hushfall.litCount?.() ?? 0)) >= 1;
}
const litHost = await p1.evaluate(() => window.__hushfall.litCount());
const litJoiner = await p3.evaluate(() => window.__hushfall.litCount());
const objectiveOk = lanternCount >= 5 && litHost >= 1 && litJoiner >= 1;

// REACHABILITY: the generated building actually connects spawn -> gate,
// Seeker spawn and every lantern (no walled-off rooms).
const reachOk = await p1.evaluate(() => window.__hushfall.reachOk?.() ?? false);

// HIDING: the Engineer ducks into a hiding spot; the host marks them concealed
// from the Seeker (who would have to search to find them).
const hideCount = await p1.evaluate(() => window.__hushfall.hideCount?.() ?? 0);
const hp = await p3.evaluate(() => window.__hushfall.hidePos?.(0));
// Delta check: warping p3 into the spot must ADD one to the host's hidden
// set. (A random map can spawn a bystander on top of a hide spot, so an
// absolute hiddenBefore === 0 check would flake on layout luck.)
const hiddenBefore = (await p1.evaluate(() => window.__hushfall.hiddenIds?.() ?? [])).length;
await p3.evaluate((h) => window.__hushfall.warp(h.x, h.y), hp);
// p3's 10Hz position stream has to reach the host — retry, don't sample once.
let hiddenAfter = hiddenBefore;
for (let i = 0; i < 8 && hiddenAfter <= hiddenBefore; i++) {
  await sleep(500);
  hiddenAfter = (await p1.evaluate(() => window.__hushfall.hiddenIds?.() ?? [])).length;
}
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp); // back onto the lantern
await sleep(200);
const hideOk = hideCount >= 4 && hiddenAfter > hiddenBefore;

// TAP-TO-HIDE: tapping a hiding spot registers intent only when it's within
// reach. Far away → ignored; nearby → the hider auto-walks in to hide.
const hp0 = await p2.evaluate(() => window.__hushfall.hidePos?.(0));
// Warp + tap + read in one page eval so no update frame can clear the target
// between tapping and reading (the auto-walk clears it once you arrive).
const tapFar = await p2.evaluate((h) => {
  window.__hushfall.warp(h.x + 1000, h.y); // out of reach
  window.__hushfall.tapHide?.(0);
  return window.__hushfall.hideTargetSet?.() ?? false;
}, hp0);
const tapNear = await p2.evaluate((h) => {
  window.__hushfall.warp(h.x + 120, h.y); // within reach
  window.__hushfall.tapHide?.(0);
  return window.__hushfall.hideTargetSet?.() ?? false;
}, hp0);
await p2
  .waitForFunction(() => window.__hushfall.amConcealed?.() === true, null, { timeout: 3_000 })
  .catch(() => {});
const tapConcealed = await p2.evaluate(() => window.__hushfall.amConcealed?.() ?? false);
const tapHideOk = tapFar === false && tapNear === true;

// HIDE-BUST: the Seeker catches the Lookout hiding — the first strike smashes
// the hiding spot (no damage), flushing them out of cover.
// The 10Hz pos stream + 0.9s attack cooldown make a single swing racy under
// load — re-warp and re-swing until the spot busts.
let bustedCount = 0;
for (let i = 0; i < 6 && bustedCount < 1; i++) {
  await p2.evaluate((h) => window.__hushfall.warp(h.x, h.y), hp0); // tucked in
  await p1.evaluate((h) => window.__hushfall.warp(h.x + 60, h.y), hp0); // searching
  await sleep(400);
  await p1.evaluate(() => window.__hushfall.attack());
  await sleep(900);
  bustedCount = await p1.evaluate(() => window.__hushfall.bustedCount?.() ?? 0);
}
const hurtByBust = await p2.evaluate(() => window.__hushfall.amHurt?.() ?? false);
const bustOk = bustedCount >= 1 && hurtByBust === false;

// Back to open ground so the down test isn't muddied by hiding/healing.
await p2.evaluate(() => {
  const s = window.__hushfall.spawnPos?.();
  if (s) window.__hushfall.warp(s.x, s.y);
});
await p1.evaluate(() => window.__hushfall.warp(200, 200));
await sleep(300);

// ABILITY: the Lookout's Sense reveals the map — other hiders see markers.
const revealBefore = await p3.evaluate(() => window.__hushfall.revealSeen());
await p2.evaluate(() => window.__hushfall.ability());
await sleep(500);
const revealAfter = await p3.evaluate(() => window.__hushfall.revealSeen());
const usesP2 = await p2.evaluate(() => window.__hushfall.abilityUses());
const abilityOk = revealAfter > revealBefore && usesP2 >= 1;

// VISION: the Seeker's Third Eye widens their sight for a few seconds.
const visBefore = await p1.evaluate(() => window.__hushfall.visionActive?.() ?? false);
const eyeRevealsBefore = await p1.evaluate(() => window.__hushfall.revealSeen?.() ?? 0);
await p1.evaluate(() => window.__hushfall.ability());
await sleep(300);
const visAfter = await p1.evaluate(() => window.__hushfall.visionActive?.() ?? false);
// Third Eye now also REVEALS every hider — the Warden must see reveal rings.
let eyeRevealsAfter = eyeRevealsBefore;
for (let i = 0; i < 6 && eyeRevealsAfter <= eyeRevealsBefore; i++) {
  await sleep(300);
  eyeRevealsAfter = await p1.evaluate(() => window.__hushfall.revealSeen?.() ?? 0);
}
const visionOk = visBefore === false && visAfter === true && eyeRevealsAfter > eyeRevealsBefore;

// DOWN: one hit no longer downs a hider — the first strike INJURES (they stay
// up), the second DOWNS. First move the target into OPEN ground: room centers
// are always clear of hide spots, so the strike can't bust furniture instead.
await p2.evaluate(() => {
  const s = window.__hushfall.spawnPos();
  window.__hushfall.warp(s.x, s.y);
});
await sleep(400);
const strike = async () => {
  const pp = await p2.evaluate(() => window.__hushfall.myPos());
  await p1.evaluate((p) => window.__hushfall.warp(p.x, p.y), pp);
  await sleep(300);
  await p1.evaluate(() => window.__hushfall.attack());
  await sleep(500);
};
// Swing until the FIRST strike lands (a warp can race the 10Hz position
// stream, whiffing a swing) — that first HIT must injure, not down.
let hurtAfter1 = false;
let downAfter1 = false;
for (let i = 0; i < 5 && !hurtAfter1 && !downAfter1; i++) {
  await strike();
  hurtAfter1 = await p2.evaluate(() => window.__hushfall.amHurt?.() ?? false);
  downAfter1 = await p2.evaluate(() => window.__hushfall.amDowned());
}
const injuredNotDowned = hurtAfter1 === true && downAfter1 === false;
let p2Downed = downAfter1;
for (let i = 0; i < 6 && !p2Downed; i++) {
  await strike();
  p2Downed = await p2.evaluate(() => window.__hushfall.amDowned());
}
const downCountHost = await p1.evaluate(() => window.__hushfall.downedCount());
const downOk = p2Downed === true && downCountHost >= 1 && injuredNotDowned;
// LIVES: that down spent one of the Lookout's three lives.
const p2Lives = await p2.evaluate(() => window.__hushfall.myLives?.() ?? -1);
const livesOk = p2Lives === 2;
await p1.screenshot({ path: `${outDir}/hf-2-down.png` });

// DOWN SIGNAL: a living ally (the Engineer) sees a directional arrow pointing
// at the downed teammate.
await sleep(300);
const downSignalP3 = await p3.evaluate(() => window.__hushfall.downSignalCount?.() ?? 0);
const downSignalOk = downSignalP3 >= 1;

// RESCUE: the Engineer reaches the downed Scout and revives them.
const p2posDown = await p2.evaluate(() => window.__hushfall.myPos());
await p1.evaluate(() => window.__hushfall.warp(200, 200)); // seeker steps away
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), p2posDown);
await p2
  .waitForFunction(() => window.__hushfall.amDowned?.() === false, null, { timeout: 16_000 })
  .catch(() => {});
await sleep(400);
const p2Revived = await p2.evaluate(() => window.__hushfall.amDowned());
const rescueOk = p2Revived === false;

// TELEPORT: a hider stepping on a rune pad rides it to the twin at the far
// end — then the pads share ONE cooldown for everyone: a second hider
// stepping on right after goes nowhere.
const tpCount = await p1.evaluate(() => window.__hushfall.tpCount?.() ?? 0);
const tp0 = await p1.evaluate(() => window.__hushfall.tpPos?.(0));
const tp1 = await p1.evaluate(() => window.__hushfall.tpPos?.(1));
await p2.evaluate((p) => window.__hushfall.warp(p.x, p.y), tp0);
await p2
  .waitForFunction(
    (dest) => {
      const m = window.__hushfall.myPos();
      return Math.hypot(m.x - dest.x, m.y - dest.y) < 300;
    },
    tp1,
    { timeout: 8_000 },
  )
  .catch(() => {});
const p2AfterTp = await p2.evaluate(() => window.__hushfall.myPos());
const rode = Math.hypot(p2AfterTp.x - tp1.x, p2AfterTp.y - tp1.y) < 300;
const tpCdLeft = await p1.evaluate(() => window.__hushfall.tpCd?.() ?? 0);
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), tp0);
await sleep(1600);
const p3AfterTp = await p3.evaluate(() => window.__hushfall.myPos());
const refused = Math.hypot(p3AfterTp.x - tp0.x, p3AfterTp.y - tp0.y) < 200;
const teleportOk = tpCount === 2 && rode && tpCdLeft > 0 && refused;

// LAST-LIFE DOWN: no camp-able corpses — the final down DRAGS the body to a
// random far spot, still downed, still rescuable, NOT eliminated.
await p1.evaluate(() => window.__hushfall.forceDownsTaken?.(2));
const preDrag = await p2.evaluate(() => window.__hushfall.myPos());
let draggedFar = false;
for (let i = 0; i < 6 && !draggedFar; i++) {
  await strike();
  const pos = await p2.evaluate(() => window.__hushfall.myPos());
  const downNow = await p2.evaluate(() => window.__hushfall.amDowned());
  draggedFar = downNow && Math.hypot(pos.x - preDrag.x, pos.y - preDrag.y) > 700;
}
const outAfterDrag = await p1.evaluate(() => window.__hushfall.outCount());
const relocOk = draggedFar && outAfterDrag === 0;
// …and the dragged body can still be saved: the Engineer treks out to them.
const dragPos = await p2.evaluate(() => window.__hushfall.myPos());
await p1.evaluate(() => window.__hushfall.warp(200, 200)); // seeker walks away
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), dragPos);
await p2
  .waitForFunction(() => window.__hushfall.amDowned?.() === false, null, { timeout: 16_000 })
  .catch(() => {});
const dragRescued = await p2.evaluate(() => window.__hushfall.amDowned());
const dragRescueOk = dragRescued === false;

// ESCAPE: host lights all lanterns, the gate opens, both hiders reach it and
// escape — ending the hunt as a Hider win.
await p1.evaluate(() => window.__hushfall.forceLightAll());
await p2
  .waitForFunction(() => window.__hushfall.gateOpen?.() === true, null, { timeout: 6_000 })
  .catch(() => {});
const gateOnP2 = await p2.evaluate(() => window.__hushfall.gateOpen());
const gate = await p2.evaluate(() => window.__hushfall.gatePos());
await p2.evaluate((g) => window.__hushfall.warp(g.x, g.y), gate);
await p3.evaluate((g) => window.__hushfall.warp(g.x + 20, g.y), gate);
await p1
  .waitForFunction(() => window.__hushfall.phase?.() !== 'playing', null, { timeout: 14_000 })
  .catch(() => {});
await sleep(600);
const escapedHost = await p1.evaluate(() => window.__hushfall.escapedCount());
const phaseHost = await p1.evaluate(() => window.__hushfall.phase());
const phaseP2 = await p2.evaluate(() => window.__hushfall.phase());
const escapeOk =
  gateOnP2 === true && escapedHost >= 1 && phaseHost === 'hiders-win' && phaseP2 === 'hiders-win';
// DEEDS: the host tallied who lit lanterns and who landed strikes.
const deedVals = Object.values(await p1.evaluate(() => window.__hushfall.stats?.() ?? {}));
const deedOk = deedVals.some((d) => d.lit >= 1) && deedVals.some((d) => d.down >= 1);
await p2.screenshot({ path: `${outDir}/hf-3-escape.png` });
await p1.screenshot({ path: `${outDir}/hf-4-end.png` });

// ROUND 2 (regression): after BACK TO LOBBY a fresh round must still sync to
// joiners — stale scene handlers once swallowed every message from round 2 on
// (joiners saw no lanterns light, no gate open, frozen players).
await p1.evaluate(() => window.__hushfall.backToLobby?.());
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
}
await sleep(600);
await p2.evaluate(() => window.__hushfall.pick?.('frost')); // Frost: Ice Snap
await sleep(300);
await p2.evaluate(() => window.__hushfall.setLocked?.(true));
await p3.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(600);
await p1.evaluate(() => window.__hushfall.start());
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
}
await sleep(800);
await p1.evaluate(() => window.__hushfall.skipHide());
await p1.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
// FREEZE: Frost snaps the Seeker frozen for a beat.
const rootedBefore = await p1.evaluate(() => window.__hushfall.amRooted?.() ?? false);
await p2.evaluate(() => window.__hushfall.ability());
await sleep(700);
const rootedAfter = await p1.evaluate(() => window.__hushfall.amRooted?.() ?? false);
const freezeOk = rootedBefore === false && rootedAfter === true;
// Round-2 objective sync: the Engineer lights a lantern; the OTHER joiner —
// a pure receiver — must see it happen.
const lp2 = await p3.evaluate(() => window.__hushfall.lanternPos(0));
let lit2 = false;
// 36 tries, not 24: round 2 runs ~8 minutes into the suite, when the slow
// headless container makes the host sim crawl — lighting can take 15s+.
for (let i = 0; i < 36 && !lit2; i++) {
  await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp2);
  await sleep(1000);
  lit2 = (await p2.evaluate(() => window.__hushfall.litCount?.() ?? 0)) >= 1;
}
const round2Ok = lit2;
await p2.screenshot({ path: `${outDir}/hf-8-round2.png` });
// The trio's gates are all measured — close their pages so the solo-host
// sections that follow aren't starved for CPU (13 live game pages under
// software rendering is enough to time out page loads on slow machines).
// Joiners FIRST: closing the host while they're live races into a
// "host disconnected" console error the suite would count as a failure.
await Promise.all([p2.close(), p3.close()]);
await p1.close();

// BOTS: a short-handed host fills the hunt with AI bots. They appear in the
// roster as hiders, enter the match, and their AI steers them (they move).
const pb = await phone('host=1&seeker=1&class=stalker&name=Solo');
await pb.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pb.evaluate(() => window.__hushfall.setBots(3));
await sleep(400);
const botLobbyPlayers = await pb.evaluate(() => window.__hushfall.playerCount());
const botLobbyCount = await pb.evaluate(() => window.__hushfall.botCount());
const rolesB = await pb.evaluate(() => window.__hushfall.roles());
const botHiders = Object.entries(rolesB).filter(
  ([id, r]) => id.startsWith('bot') && r === 'hider',
).length;
const botLobbyOk = botLobbyPlayers === 4 && botLobbyCount === 3 && botHiders === 3;
await pb.screenshot({ path: `${outDir}/hf-5-bots-lobby.png` });
await pb.evaluate(() => window.__hushfall.start());
await pb.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await sleep(600);
await pb.evaluate(() => window.__hushfall.skipHide());
await pb.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
const matchBots = await pb.evaluate(() => window.__hushfall.botCount());
const swarm0 = await pb.evaluate(() => window.__hushfall.botPositions());
await sleep(4600);
const swarm1 = await pb.evaluate(() => window.__hushfall.botPositions());
// At least one bot should be travelling (a bot standing on its assigned
// lantern to light it can be momentarily still, so measure the whole swarm).
const maxMove = Math.max(
  0,
  ...swarm0.map((p, i) => (swarm1[i] ? Math.hypot(swarm1[i].x - p.x, swarm1[i].y - p.y) : 0)),
);
const botMoved = swarm0.length === 3 && maxMove > 20;
// They should follow different directions, not all chase the same objective:
// each bot is assigned its own lantern, so their live goals must differ.
const botGoals = await pb.evaluate(() => window.__hushfall.botGoals());
const distinctGoals = new Set(botGoals.filter(Boolean)).size;
const botSpread = distinctGoals >= 2;
// Open the gate + move the seeker aside; bots should path toward it (they
// route through doorways, so measure distance-to-gate, not a straight line).
const gateB = await pb.evaluate(() => window.__hushfall.gatePos());
await pb.evaluate(() => window.__hushfall.warp(2600, 2280)); // seeker far from the gate
await pb.evaluate(() => window.__hushfall.forceLightAll());
const nearGate = (s) =>
  s.length ? Math.min(...s.map((p) => Math.hypot(p.x - gateB.x, p.y - gateB.y))) : 1e9;
const botDist0 = nearGate(swarm1);
await sleep(5200);
const swarm2 = await pb.evaluate(() => window.__hushfall.botPositions());
const botDist1 = nearGate(swarm2);
// Bots head for the gate: either the nearest closes in, or one already made it
// out (an escaped bot drops off the position list, so count that as success).
const botEscaped = await pb.evaluate(() => window.__hushfall.escapedCount?.() ?? 0);
const botToGate = botDist1 < botDist0 - 40 || botEscaped >= 1;
const botOk = botLobbyOk && matchBots === 3 && botMoved && botSpread && botToGate;
await pb.screenshot({ path: `${outDir}/hf-6-bots-match.png` });
await pb.close();

// LEVELS + ALL-DOWN END: a solo host picks a non-default level (Ashen Asylum,
// 6 lanterns) and fills with bots. The match loads THAT level, and downing
// every hider at once ends the hunt as a Seeker win.
const pe = await phone('host=1&seeker=1&class=stalker&name=Lvl');
await pe.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
const levelCount = await pe.evaluate(() => window.__hushfall.levelCount?.() ?? 0);
await pe.evaluate(() => window.__hushfall.setLevel?.(1));
await pe.evaluate(() => window.__hushfall.setBots?.(2));
const lvlLobby = await pe.evaluate(() => window.__hushfall.levelIndex?.() ?? -1);
await pe.evaluate(() => window.__hushfall.start());
await pe.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pe.evaluate(() => window.__hushfall.skipHide());
await pe.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(500);
const lvlMatch = await pe.evaluate(() => window.__hushfall.levelIndex?.() ?? -1);
const lvlName = await pe.evaluate(() => window.__hushfall.levelName?.() ?? '');
const lvlLanterns = await pe.evaluate(() => window.__hushfall.lanternCount?.() ?? 0);
const levelOk = levelCount >= 3 && lvlLobby === 1 && lvlMatch === 1 && lvlLanterns === 7;
// ANTI-CAMP: the gate needs one lantern FEWER than the map holds, and if the
// hunt drags past dawn it opens on its own.
const lanternsNeeded = await pe.evaluate(() => window.__hushfall.lanternsNeeded?.() ?? -1);
const spareOk = lanternsNeeded === lvlLanterns - 1;
// Dawn no longer frees the MAIN gate — it creaks open the HATCH, a second
// exit far across the manor, so the Seeker can't camp one door.
await pe.evaluate(() => window.__hushfall.forceDawn?.());
await pe
  .waitForFunction(() => window.__hushfall.hatchOpen?.() === true, null, { timeout: 15_000 })
  .catch(() => {});
const dawnOk = await pe.evaluate(() => window.__hushfall.hatchOpen?.() ?? false);
// Down everyone at once → immediate Seeker win.
await pe.evaluate(() => window.__hushfall.forceDownAll?.());
await pe
  .waitForFunction(() => window.__hushfall.phase?.() === 'seeker-wins', null, { timeout: 6_000 })
  .catch(() => {});
const allDownPhase = await pe.evaluate(() => window.__hushfall.phase?.());
const allDownOk = allDownPhase === 'seeker-wins';
await pe.screenshot({ path: `${outDir}/hf-7-level-end.png` });
await pe.close();

// NEW SEEKERS: the Weaver's ranged Web Bolt SLOWS the nearest hider…
const pw = await phone('host=1&seeker=1&class=weaver&name=Web');
await pw.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pw.evaluate(() => window.__hushfall.setBots?.(1));
await pw.evaluate(() => window.__hushfall.start());
await pw.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pw.evaluate(() => window.__hushfall.skipHide());
await pw.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(400);
let weaverOk = false;
for (let attempt = 0; attempt < 2 && !weaverOk; attempt++) {
  const bp = await pw.evaluate(() => window.__hushfall.botPos());
  if (bp) {
    await pw.evaluate((p) => window.__hushfall.warp(p.x + 120, p.y), bp);
    await sleep(250);
    await pw.evaluate(() => window.__hushfall.ability());
    await sleep(700);
    weaverOk = (await pw.evaluate(() => window.__hushfall.slowedCount?.() ?? 0)) >= 1;
  }
  if (!weaverOk) await sleep(9_500); // ride out the ability cooldown, try once more
}
await pw.close();

// …and the Trapper's snare roots whoever steps in.
const pt = await phone('host=1&seeker=1&class=trapper&name=Trap');
await pt.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pt.evaluate(() => window.__hushfall.setBots?.(1));
await pt.evaluate(() => window.__hushfall.start());
await pt.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pt.evaluate(() => window.__hushfall.skipHide());
await pt.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(400);
const bp2 = await pt.evaluate(() => window.__hushfall.botPos());
if (bp2) {
  await pt.evaluate((p) => window.__hushfall.warp(p.x, p.y), bp2);
  await sleep(200);
  await pt.evaluate(() => window.__hushfall.ability()); // trap laid right under the bot
}
const trapLaid = await pt.evaluate(() => window.__hushfall.trapCount?.() ?? 0);
await pt.evaluate(() => window.__hushfall.warp(200, 200));
let rootedSeen = 0;
for (let i = 0; i < 12 && !rootedSeen; i++) {
  await sleep(500);
  rootedSeen = await pt.evaluate(() => window.__hushfall.rootedCount?.() ?? 0);
}
const trapOk = trapLaid >= 1 && rootedSeen >= 1;
await pt.close();

// NEW HIDERS: the Siren bot Dazzles a Seeker who gets too close — the
// Seeker's OWN client whites out (blindsTaken counts overlay hits).
const ps = await phone('host=1&seeker=1&class=warden&name=Bright');
await ps.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await ps.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await ps.evaluate(() => window.__hushfall.setBotClass?.(0, 'siren'));
await ps.evaluate(() => window.__hushfall.start());
await ps.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await ps.evaluate(() => window.__hushfall.skipHide());
await ps.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(400);
let blindOk = false;
for (let i = 0; i < 20 && !blindOk; i++) {
  const bp = await ps.evaluate(() => window.__hushfall.botPos());
  if (bp) await ps.evaluate((p) => window.__hushfall.warp(p.x + 110, p.y), bp);
  await sleep(600);
  blindOk = (await ps.evaluate(() => window.__hushfall.blindsTaken?.() ?? 0)) >= 1;
}
await ps.close();

// …and the Nester (a HIDER host, bot Seeker) conjures a pop-up den right
// underfoot that conceals like real furniture.
const pn = await phone('host=1&class=nester&name=Nest');
await pn.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pn.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pn.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pn.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pn.evaluate(() => window.__hushfall.start());
await pn.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pn.evaluate(() => window.__hushfall.skipHide());
await pn.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(400);
await pn.evaluate(() => window.__hushfall.ability()); // den appears underfoot
let nestCount = 0;
let nestConcealed = false;
for (let i = 0; i < 8 && !(nestCount >= 1 && nestConcealed); i++) {
  await sleep(500);
  nestCount = await pn.evaluate(() => window.__hushfall.nestCount?.() ?? 0);
  nestConcealed = await pn.evaluate(() => window.__hushfall.amConcealed?.() ?? false);
}
const nestOk = nestCount >= 1 && nestConcealed;
await pn.close();

// TWIN: plant a dummy of yourself, then TRADE PLACES with it from afar.
const p2w = await phone('host=1&seeker=1&class=twin&name=Twiny');
await p2w.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await p2w.evaluate(() => window.__hushfall.setBots?.(1));
await p2w.evaluate(() => window.__hushfall.start());
await p2w.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await p2w.evaluate(() => window.__hushfall.skipHide());
await p2w.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(400);
await p2w.evaluate(() => window.__hushfall.ability()); // plant the dummy here
let dummyCount = 0;
for (let i = 0; i < 8 && dummyCount < 1; i++) {
  await sleep(500);
  dummyCount = await p2w.evaluate(() => window.__hushfall.dummyCount?.() ?? 0);
}
await p2w.evaluate(() => {
  const p = window.__hushfall.myPos();
  window.__hushfall.warp(p.x + 700, p.y); // stride away from the double
});
await sleep(8600); // ride out Dummy Swap's cooldown
const posBefore = await p2w.evaluate(() => window.__hushfall.myPos());
await p2w.evaluate(() => window.__hushfall.ability()); // TRADE PLACES
await sleep(700);
const posAfter = await p2w.evaluate(() => window.__hushfall.myPos());
const swapDist = Math.hypot(posAfter.x - posBefore.x, posAfter.y - posBefore.y);
const twinOk = dummyCount === 1 && swapDist > 400;
await p2w.close();

// WRAITH: the opening curse takes a HUMAN hider first (bots are the last
// resort) — their client flips to the seeker side. Cloak still hides the
// Wraith from every hider's sight.
const pv = await phone('host=1&seeker=1&class=wraith&name=Wisp');
await pv.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
const wCode = await pv.evaluate(() => window.__hushfall.code());
const pvh = await phone(`join=${wCode}&class=scout&name=Prey`);
await pvh.waitForFunction(() => window.__hushfall?.playerCount() === 2, null, { timeout: 10_000 });
await pv.evaluate(() => window.__hushfall.setBots?.(2));
await sleep(300);
await pvh.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pv.evaluate(() => window.__hushfall.start());
await pv.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pv.evaluate(() => window.__hushfall.skipHide());
await pv.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
let wraithConverted = 0;
for (let i = 0; i < 10 && wraithConverted < 1; i++) {
  await sleep(500);
  wraithConverted = await pv.evaluate(() => window.__hushfall.convertedCount?.() ?? 0);
}
const wraithSeekers = await pv.evaluate(() => window.__hushfall.seekerCount?.() ?? 0);
// The HUMAN got converted (not a bot) and their own client knows it.
let humanConverted = false;
for (let i = 0; i < 8 && !humanConverted; i++) {
  await sleep(400);
  humanConverted = await pvh.evaluate(() => window.__hushfall.amSeeker?.() ?? false);
}
let cloaked = false;
for (let i = 0; i < 6 && !cloaked; i++) {
  await pv.evaluate(() => window.__hushfall.ability()); // Cloak
  await sleep(800);
  cloaked = await pv.evaluate(() => window.__hushfall.amCloaked?.() ?? false);
}
const wraithOk = wraithConverted >= 1 && wraithSeekers >= 2 && humanConverted && cloaked;
await pvh.close();
await pv.close();

// BUILDER + universal SPRINT: every hider sprints; the Builder raises a
// wall the seeker can't pass.
const pb2 = await phone('host=1&class=builder&name=Bricks');
await pb2.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pb2.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pb2.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pb2.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pb2.evaluate(() => window.__hushfall.start());
await pb2.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pb2.evaluate(() => window.__hushfall.skipHide());
await pb2.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
await pb2.evaluate(() => window.__hushfall.sprint?.());
const sprintOk = await pb2.evaluate(() => window.__hushfall.sprinting?.() ?? false);
await pb2.evaluate(() => window.__hushfall.ability()); // Barricade
let wallCount = 0;
for (let i = 0; i < 8 && wallCount < 1; i++) {
  await sleep(500);
  wallCount = await pb2.evaluate(() => window.__hushfall.wallCount?.() ?? 0);
}
const wallOk = wallCount >= 1;
await pb2.close();

// SPRINTER: Split spawns clone bots that scatter.
const pc = await phone('host=1&class=sprinter&name=Zoom');
await pc.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pc.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pc.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pc.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pc.evaluate(() => window.__hushfall.start());
await pc.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pc.evaluate(() => window.__hushfall.skipHide());
await pc.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
await pc.evaluate(() => window.__hushfall.ability()); // Split
let cloneCount = 0;
for (let i = 0; i < 8 && cloneCount < 2; i++) {
  await sleep(500);
  cloneCount = await pc.evaluate(() => window.__hushfall.cloneCount?.() ?? 0);
}
const cloneOk = cloneCount >= 2;
// PC CONTROLS: holding D must walk the blob right (WASD drives movement
// whenever the touch joystick is idle).
const pcStart = await pc.evaluate(() => window.__hushfall.myPos());
await pc.keyboard.down('d');
await sleep(800);
await pc.keyboard.up('d');
const pcEnd = await pc.evaluate(() => window.__hushfall.myPos());
const pcMoveOk = pcEnd.x - pcStart.x > 40;
await pc.close();

// KAIJU: the Atomic Blast hurls the seeker away.
const pk = await phone('host=1&class=kaiju&name=Rex');
await pk.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pk.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pk.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pk.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pk.evaluate(() => window.__hushfall.start());
await pk.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pk.evaluate(() => window.__hushfall.skipHide());
await pk.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
await pk.evaluate(() => {
  const sp = window.__hushfall.seekerPos();
  if (sp) window.__hushfall.warp(sp.x + 100, sp.y); // stand in blast range
});
await sleep(300);
const seekBefore = await pk.evaluate(() => window.__hushfall.seekerPos());
await pk.evaluate(() => window.__hushfall.ability()); // Atomic Blast
await sleep(700);
const seekAfter = await pk.evaluate(() => window.__hushfall.seekerPos());
const blastDist =
  seekBefore && seekAfter ? Math.hypot(seekAfter.x - seekBefore.x, seekAfter.y - seekBefore.y) : 0;
const blastOk = blastDist > 150;
await pk.close();

// HOWLER rework: Screech starts the glowing hider TRAIL window.
const ph = await phone('host=1&seeker=1&class=howler&name=Howl');
await ph.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await ph.evaluate(() => window.__hushfall.setBots?.(1));
await ph.evaluate(() => window.__hushfall.start());
await ph.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await ph.evaluate(() => window.__hushfall.skipHide());
await ph.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
let trailLeft = 0;
for (let i = 0; i < 8 && trailLeft <= 3; i++) {
  await ph.evaluate(() => window.__hushfall.ability()); // Screech
  await sleep(800);
  trailLeft = await ph.evaluate(() => window.__hushfall.trailLeft?.() ?? 0);
}
const trailOk = trailLeft > 3;
await ph.close();

// ENGINEER Pocket Portal: with the passive, Overcharge also builds a temp
// teleporter pad; riding it warps you across the manor WITHOUT touching the
// manor pads' shared cooldown.
const pengr = await phone('host=1&class=engineer&name=Gears');
await pengr.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, {
  timeout: 12_000,
});
await pengr.evaluate(() => window.__hushfall.grantUp?.('engineer3'));
await pengr.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pengr.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pengr.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pengr.evaluate(() => window.__hushfall.start());
await pengr.waitForFunction(() => window.__hushfall?.scene() === 'match', null, {
  timeout: 12_000,
});
await pengr.evaluate(() => window.__hushfall.skipHide());
await pengr.waitForFunction(() => window.__hushfall.phase() === 'playing', null, {
  timeout: 15_000,
});
await sleep(300);
// The passive adds a dedicated 🌀 button — building a pad no longer rides on
// Overcharge, so the Engineer picks the spot deliberately.
const specialBtnOk = await pengr.evaluate(() => window.__hushfall.hasSpecialBtn?.() ?? false);
await pengr.evaluate(() => window.__hushfall.special()); // 🌀 build a pad
let tpadCount = 0;
for (let i = 0; i < 8 && tpadCount < 1; i++) {
  await sleep(500);
  tpadCount = await pengr.evaluate(() => window.__hushfall.tpadCount?.() ?? 0);
}
// Pressing again inside the cooldown must NOT build a second pad — the
// button counts down client-side and the host referees it too.
await pengr.evaluate(() => window.__hushfall.special());
await sleep(800);
const tpadAfterSpam = await pengr.evaluate(() => window.__hushfall.tpadCount?.() ?? 0);
const padPos = await pengr.evaluate(() => window.__hushfall.tpadPos?.(0));
let tpadRide = 0;
if (padPos) {
  // Step OFF first — a fresh pad only ARMS once everyone is clear (so
  // building one never teleports the Engineer on the spot).
  await pengr.evaluate((p) => window.__hushfall.warp(p.x + 220, p.y), padPos);
  await sleep(800);
  await pengr.evaluate((p) => window.__hushfall.warp(p.x, p.y), padPos);
  for (let i = 0; i < 8 && tpadRide < 300; i++) {
    await sleep(500);
    const mp = await pengr.evaluate(() => window.__hushfall.myPos());
    tpadRide = Math.hypot(mp.x - padPos.x, mp.y - padPos.y);
  }
}
// The manor pair's SHARED cooldown must still be untouched after the ride.
const tpadSharedCd = await pengr.evaluate(() => window.__hushfall.tpCd?.() ?? -1);
const tpadOk =
  specialBtnOk && tpadCount >= 1 && tpadAfterSpam === 1 && tpadRide >= 300 && tpadSharedCd === 0;
await pengr.close();

// MEDIC Second Wind: a lone downed Medic with the passive does NOT hand the
// Seeker the win — the end check waits, and the Medic rises on their own.
const pm = await phone('host=1&class=medic&name=Doc');
await pm.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pm.evaluate(() => window.__hushfall.grantUp?.('medic3'));
await pm.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pm.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pm.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pm.evaluate(() => window.__hushfall.start());
await pm.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pm.evaluate(() => window.__hushfall.skipHide());
await pm.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
await pm.evaluate(() => window.__hushfall.forceDownAll());
let windDowned = false;
for (let i = 0; i < 8 && !windDowned; i++) {
  await sleep(300);
  windDowned = await pm.evaluate(() => window.__hushfall.amDowned?.() ?? false);
}
let windRose = false;
for (let i = 0; i < 16 && !windRose; i++) {
  await sleep(500);
  windRose = !(await pm.evaluate(() => window.__hushfall.amDowned?.() ?? true));
}
const windPhase = await pm.evaluate(() => window.__hushfall.phase());
const secondWindOk = windDowned && windRose && windPhase === 'playing';
await pm.close();

// TRICKSTER Switcheroo: with the passive, a second 🎭 button swaps the
// trickster with their doll — the doll keeps the old spot.
const ptr = await phone('host=1&class=trickster&name=Trix');
await ptr.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await ptr.evaluate(() => window.__hushfall.grantUp?.('trickster3'));
await ptr.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await ptr.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await ptr.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await ptr.evaluate(() => window.__hushfall.start());
await ptr.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await ptr.evaluate(() => window.__hushfall.skipHide());
await ptr.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
const dollAt = await ptr.evaluate(() => window.__hushfall.myPos());
await ptr.evaluate(() => window.__hushfall.ability()); // drop the doll here
let dolls = 0;
for (let i = 0; i < 8 && dolls < 1; i++) {
  await sleep(500);
  dolls = await ptr.evaluate(() => window.__hushfall.decoyCount?.() ?? 0);
}
await ptr.evaluate((p) => window.__hushfall.warp(p.x + 600, p.y), dollAt);
await sleep(400);
await ptr.evaluate(() => window.__hushfall.special()); // 🎭 Switcheroo
let trixDist = 9999;
for (let i = 0; i < 8 && trixDist > 150; i++) {
  await sleep(400);
  const mp = await ptr.evaluate(() => window.__hushfall.myPos());
  trixDist = Math.hypot(mp.x - dollAt.x, mp.y - dollAt.y);
}
const swapOk = dolls >= 1 && trixDist <= 150;
await ptr.close();

// SIREN Lullaby: the second 🎶 button slows every seeker in earshot.
const psi = await phone('host=1&class=siren&name=Song');
await psi.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await psi.evaluate(() => window.__hushfall.grantUp?.('siren3'));
await psi.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await psi.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await psi.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await psi.evaluate(() => window.__hushfall.start());
await psi.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await psi.evaluate(() => window.__hushfall.skipHide());
await psi.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
let lullabyOk = false;
for (let i = 0; i < 6 && !lullabyOk; i++) {
  await psi.evaluate(() => {
    const sp = window.__hushfall.seekerPos();
    if (sp) window.__hushfall.warp(sp.x + 150, sp.y);
  });
  await sleep(300);
  await psi.evaluate(() => window.__hushfall.special()); // 🎶 Lullaby
  await sleep(600);
  lullabyOk = (await psi.evaluate(() => window.__hushfall.slowedCount?.() ?? 0)) >= 1;
}
await psi.close();

// GHOST Death Fade: surviving a strike vanishes the ghost on the spot.
const pgh = await phone('host=1&class=ghost&name=Boo');
await pgh.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pgh.evaluate(() => window.__hushfall.grantUp?.('ghost3'));
await pgh.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(300);
await pgh.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await pgh.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(400);
await pgh.evaluate(() => window.__hushfall.start());
await pgh.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await pgh.evaluate(() => window.__hushfall.skipHide());
await pgh.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
let fadeOk = false;
for (let i = 0; i < 12 && !fadeOk; i++) {
  await pgh.evaluate(() => {
    const sp = window.__hushfall.seekerPos();
    if (sp) window.__hushfall.warp(sp.x + 40, sp.y); // stand in strike range
  });
  await sleep(600);
  fadeOk = await pgh.evaluate(() => window.__hushfall.amCloaked?.() ?? false);
}
await pgh.close();

// SCOUT Sixth Sense + LOOKOUT Town Crier: the scout's arrow flares alone
// when the seeker creeps close; the lookout's Sense hands the arrow to
// EVERY survivor.
const pl = await phone('host=1&class=lookout&name=Cry');
await pl.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pl.evaluate(() => window.__hushfall.grantUp?.('lookout3'));
const plCode = await pl.evaluate(() => window.__hushfall.code());
const pscout = await phone(`join=${plCode}&class=scout&name=Ears`);
await pscout.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, {
  timeout: 12_000,
});
await pscout.evaluate(() => window.__hushfall.grantUp?.('scout3'));
await pl.evaluate(() => window.__hushfall.setBots?.(1));
await sleep(600);
await pl.evaluate(() => window.__hushfall.setSeeker?.('bot0'));
await sleep(300);
await pl.evaluate(() => window.__hushfall.setLocked?.(true));
await pscout.evaluate(() => window.__hushfall.setLocked?.(true));
await sleep(500);
await pl.evaluate(() => window.__hushfall.start());
for (const p of [pl, pscout]) {
  await p.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
}
await pl.evaluate(() => window.__hushfall.skipHide());
await pl.waitForFunction(() => window.__hushfall.phase() === 'playing', null, { timeout: 15_000 });
await sleep(300);
// Sixth Sense: creep the scout up to the bot seeker until the arrow flares.
let sixthOk = false;
for (let i = 0; i < 8 && !sixthOk; i++) {
  await pscout.evaluate(() => {
    const sp = window.__hushfall.seekerPos();
    if (sp) window.__hushfall.warp(sp.x + 150, sp.y);
  });
  await sleep(500);
  sixthOk = await pscout.evaluate(() => window.__hushfall.arrowOn?.() ?? false);
}
// Step away and let the flare die down (warn cd holds 20s, so it stays off).
await pscout.evaluate(() => {
  const sp = window.__hushfall.seekerPos();
  if (sp) window.__hushfall.warp(sp.x + 900, sp.y);
});
let arrowOff = false;
for (let i = 0; i < 10 && !arrowOff; i++) {
  await sleep(500);
  arrowOff = !(await pscout.evaluate(() => window.__hushfall.arrowOn?.() ?? true));
}
// Town Crier: the LOOKOUT casts Sense — the SCOUT should get the arrow.
let crierOk = false;
for (let i = 0; i < 6 && !crierOk; i++) {
  await pl.evaluate(() => window.__hushfall.ability()); // Sense
  await sleep(700);
  crierOk = await pscout.evaluate(() => window.__hushfall.arrowOn?.() ?? false);
}
crierOk = crierOk && arrowOff;
// Joiner leaves FIRST — closing the host under a live joiner logs a
// "host disconnected" console error, which the suite treats as a failure.
await pscout.close();
await pl.close();

await browser.close();
relay.kill();

const ok =
  rolesOk &&
  lockOk &&
  selectGateOk &&
  pcMoveOk &&
  startRolesOk &&
  seekerVisibleOk &&
  objectiveOk &&
  reachOk &&
  hideOk &&
  tapHideOk &&
  bustOk &&
  abilityOk &&
  visionOk &&
  downOk &&
  livesOk &&
  downSignalOk &&
  rescueOk &&
  escapeOk &&
  deedOk &&
  hidePhaseOk &&
  losOk &&
  teleportOk &&
  publicOk &&
  relocOk &&
  dragRescueOk &&
  weaverOk &&
  trapOk &&
  blindOk &&
  nestOk &&
  twinOk &&
  wraithOk &&
  trailOk &&
  tpadOk &&
  secondWindOk &&
  swapOk &&
  lullabyOk &&
  fadeOk &&
  sixthOk &&
  crierOk &&
  sprintOk &&
  wallOk &&
  cloneOk &&
  blastOk &&
  freezeOk &&
  round2Ok &&
  botOk &&
  levelOk &&
  spareOk &&
  dawnOk &&
  allDownOk &&
  errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      code,
      rolesOk,
      seekers,
      lockOk,
      selectGateOk,
      pcMoveOk,
      startRolesOk,
      seekerVisibleOk,
      objectiveOk,
      lanternCount,
      litHost,
      litJoiner,
      reachOk,
      hideOk,
      hideCount,
      hiddenBefore,
      hiddenAfter,
      tapHideOk,
      tapFar,
      tapNear,
      tapConcealed,
      bustOk,
      bustedCount,
      hurtByBust,
      visionOk,
      abilityOk,
      revealBefore,
      revealAfter,
      usesP2,
      downOk,
      p2Downed,
      injuredNotDowned,
      downCountHost,
      livesOk,
      p2Lives,
      downSignalOk,
      downSignalP3,
      rescueOk,
      p2Revived,
      escapeOk,
      deedOk,
      hidePhaseOk,
      losOk,
      teleportOk,
      tpCount,
      rode,
      tpCdLeft,
      refused,
      publicOk,
      relocOk,
      dragRescueOk,
      weaverOk,
      trapOk,
      trapLaid,
      rootedSeen,
      blindOk,
      nestOk,
      nestCount,
      nestConcealed,
      twinOk,
      dummyCount,
      swapDist,
      wraithOk,
      wraithConverted,
      wraithSeekers,
      humanConverted,
      cloaked,
      sprintOk,
      wallOk,
      wallCount,
      cloneOk,
      cloneCount,
      blastOk,
      blastDist,
      trailOk,
      trailLeft,
      tpadOk,
      specialBtnOk,
      tpadCount,
      tpadAfterSpam,
      tpadRide,
      tpadSharedCd,
      secondWindOk,
      windDowned,
      windRose,
      windPhase,
      swapOk,
      trixDist,
      lullabyOk,
      fadeOk,
      sixthOk,
      crierOk,
      gateOnP2,
      escapedHost,
      phaseHost,
      phaseP2,
      freezeOk,
      round2Ok,
      botOk,
      botLobbyOk,
      botLobbyPlayers,
      botLobbyCount,
      botHiders,
      matchBots,
      botMoved,
      botSpread,
      distinctGoals,
      botToGate,
      botEscaped,
      levelOk,
      levelCount,
      lvlLobby,
      lvlMatch,
      lvlName,
      lvlLanterns,
      spareOk,
      lanternsNeeded,
      dawnOk,
      allDownOk,
      allDownPhase,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
