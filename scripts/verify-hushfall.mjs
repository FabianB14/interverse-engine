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
const rolesOk = seekers === 1 && Object.values(roles).filter((r) => r === 'hider').length === 2 && !!seekerId;
await p1.screenshot({ path: `${outDir}/hf-1-lobby.png` });

// START -> everyone in the match.
await p1.evaluate(() => window.__hushfall.start());
for (const p of [p1, p2, p3]) {
  await p.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
}
await sleep(800);

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
const hiddenBefore = (await p1.evaluate(() => window.__hushfall.hiddenIds?.() ?? [])).length;
await p3.evaluate((h) => window.__hushfall.warp(h.x, h.y), hp);
await sleep(500);
const hiddenAfter = (await p1.evaluate(() => window.__hushfall.hiddenIds?.() ?? [])).length;
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp); // back onto the lantern
await sleep(200);
const hideOk = hideCount >= 4 && hiddenBefore === 0 && hiddenAfter >= 1;

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
await p2.waitForFunction(() => window.__hushfall.amConcealed?.() === true, null, { timeout: 3_000 }).catch(() => {});
const tapConcealed = await p2.evaluate(() => window.__hushfall.amConcealed?.() ?? false);
const tapHideOk = tapFar === false && tapNear === true;
// Back to open ground so the down test isn't muddied by hiding/healing.
await p2.evaluate(() => {
  const s = window.__hushfall.spawnPos?.();
  if (s) window.__hushfall.warp(s.x, s.y);
});
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
await p1.evaluate(() => window.__hushfall.ability());
await sleep(300);
const visAfter = await p1.evaluate(() => window.__hushfall.visionActive?.() ?? false);
const visionOk = visBefore === false && visAfter === true;

// DOWN: one hit no longer downs a hider — the first strike INJURES (they stay
// up), the second DOWNS. Re-warp + swing to ride out transient position lag.
const strike = async () => {
  const pp = await p2.evaluate(() => window.__hushfall.myPos());
  await p1.evaluate((p) => window.__hushfall.warp(p.x, p.y), pp);
  await sleep(300);
  await p1.evaluate(() => window.__hushfall.attack());
  await sleep(500);
};
await strike();
const hurtAfter1 = await p2.evaluate(() => window.__hushfall.amHurt?.() ?? false);
const downAfter1 = await p2.evaluate(() => window.__hushfall.amDowned());
const injuredNotDowned = hurtAfter1 === true && downAfter1 === false;
let p2Downed = downAfter1;
for (let i = 0; i < 6 && !p2Downed; i++) {
  await strike();
  p2Downed = await p2.evaluate(() => window.__hushfall.amDowned());
}
const downCountHost = await p1.evaluate(() => window.__hushfall.downedCount());
const downOk = p2Downed === true && downCountHost >= 1 && injuredNotDowned;
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
await p2.waitForFunction(() => window.__hushfall.amDowned?.() === false, null, { timeout: 16_000 }).catch(() => {});
await sleep(400);
const p2Revived = await p2.evaluate(() => window.__hushfall.amDowned());
const rescueOk = p2Revived === false;

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
await p1.waitForFunction(() => window.__hushfall.phase?.() !== 'playing', null, { timeout: 14_000 }).catch(() => {});
await sleep(600);
const escapedHost = await p1.evaluate(() => window.__hushfall.escapedCount());
const phaseHost = await p1.evaluate(() => window.__hushfall.phase());
const phaseP2 = await p2.evaluate(() => window.__hushfall.phase());
const escapeOk = gateOnP2 === true && escapedHost >= 1 && phaseHost === 'hiders-win' && phaseP2 === 'hiders-win';
await p2.screenshot({ path: `${outDir}/hf-3-escape.png` });
await p1.screenshot({ path: `${outDir}/hf-4-end.png` });

// BOTS: a short-handed host fills the hunt with AI bots. They appear in the
// roster as hiders, enter the match, and their AI steers them (they move).
const pb = await phone('host=1&seeker=1&class=stalker&name=Solo');
await pb.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
await pb.evaluate(() => window.__hushfall.setBots(3));
await sleep(400);
const botLobbyPlayers = await pb.evaluate(() => window.__hushfall.playerCount());
const botLobbyCount = await pb.evaluate(() => window.__hushfall.botCount());
const rolesB = await pb.evaluate(() => window.__hushfall.roles());
const botHiders = Object.entries(rolesB).filter(([id, r]) => id.startsWith('bot') && r === 'hider').length;
const botLobbyOk = botLobbyPlayers === 4 && botLobbyCount === 3 && botHiders === 3;
await pb.screenshot({ path: `${outDir}/hf-5-bots-lobby.png` });
await pb.evaluate(() => window.__hushfall.start());
await pb.waitForFunction(() => window.__hushfall?.scene() === 'match', null, { timeout: 12_000 });
await sleep(600);
const matchBots = await pb.evaluate(() => window.__hushfall.botCount());
const swarm0 = await pb.evaluate(() => window.__hushfall.botPositions());
await sleep(4600);
const swarm1 = await pb.evaluate(() => window.__hushfall.botPositions());
// At least one bot should be travelling (a bot standing on its assigned
// lantern to light it can be momentarily still, so measure the whole swarm).
const maxMove = Math.max(
  0,
  ...swarm0.map((p, i) =>
    swarm1[i] ? Math.hypot(swarm1[i].x - p.x, swarm1[i].y - p.y) : 0,
  ),
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
await sleep(500);
const lvlMatch = await pe.evaluate(() => window.__hushfall.levelIndex?.() ?? -1);
const lvlName = await pe.evaluate(() => window.__hushfall.levelName?.() ?? '');
const lvlLanterns = await pe.evaluate(() => window.__hushfall.lanternCount?.() ?? 0);
const levelOk = levelCount >= 3 && lvlLobby === 1 && lvlMatch === 1 && lvlLanterns === 6;
// Down everyone at once → immediate Seeker win.
await pe.evaluate(() => window.__hushfall.forceDownAll?.());
await pe
  .waitForFunction(() => window.__hushfall.phase?.() === 'seeker-wins', null, { timeout: 6_000 })
  .catch(() => {});
const allDownPhase = await pe.evaluate(() => window.__hushfall.phase?.());
const allDownOk = allDownPhase === 'seeker-wins';
await pe.screenshot({ path: `${outDir}/hf-7-level-end.png` });

await browser.close();
relay.kill();

const ok =
  rolesOk &&
  startRolesOk &&
  seekerVisibleOk &&
  objectiveOk &&
  reachOk &&
  hideOk &&
  tapHideOk &&
  abilityOk &&
  visionOk &&
  downOk &&
  downSignalOk &&
  rescueOk &&
  escapeOk &&
  botOk &&
  levelOk &&
  allDownOk &&
  errors.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      code,
      rolesOk,
      seekers,
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
      visionOk,
      abilityOk,
      revealBefore,
      revealAfter,
      usesP2,
      downOk,
      p2Downed,
      injuredNotDowned,
      downCountHost,
      downSignalOk,
      downSignalP3,
      rescueOk,
      p2Revived,
      escapeOk,
      gateOnP2,
      escapedHost,
      phaseHost,
      phaseP2,
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
      allDownOk,
      allDownPhase,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
