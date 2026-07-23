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

// Host is the Seeker (Stalker); two Hider joiners.
const p1 = await phone('host=1&seeker=1&class=stalker&name=Warden');
await p1.waitForFunction(() => window.__hushfall?.scene() === 'lobby', null, { timeout: 12_000 });
const code = await p1.evaluate(() => window.__hushfall.code());
const p2 = await phone(`join=${code}&class=scout&name=Scout`);
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
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp);
await sleep(400);
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), lp);
await p3.waitForFunction(() => (window.__hushfall.litCount?.() ?? 0) >= 1, null, { timeout: 18_000 }).catch(() => {});
const litHost = await p1.evaluate(() => window.__hushfall.litCount());
const litJoiner = await p3.evaluate(() => window.__hushfall.litCount());
const objectiveOk = lanternCount >= 5 && litHost >= 1 && litJoiner >= 1;

// ABILITY: the Scout pings the Seeker; other hiders see a reveal marker.
const revealBefore = await p3.evaluate(() => window.__hushfall.revealSeen());
await p2.evaluate(() => window.__hushfall.ability());
await sleep(500);
const revealAfter = await p3.evaluate(() => window.__hushfall.revealSeen());
const usesP2 = await p2.evaluate(() => window.__hushfall.abilityUses());
const abilityOk = revealAfter > revealBefore && usesP2 >= 1;

// DOWN: the Seeker warps onto the Scout and strikes — the Scout goes down.
const p2pos = await p2.evaluate(() => window.__hushfall.myPos());
await p1.evaluate((p) => window.__hushfall.warp(p.x, p.y), p2pos);
await sleep(300);
await p1.evaluate(() => window.__hushfall.attack());
await sleep(500);
const p2Downed = await p2.evaluate(() => window.__hushfall.amDowned());
const downCountHost = await p1.evaluate(() => window.__hushfall.downedCount());
const downOk = p2Downed === true && downCountHost >= 1;
await p1.screenshot({ path: `${outDir}/hf-2-down.png` });

// RESCUE: the Engineer reaches the downed Scout and revives them.
const p2posDown = await p2.evaluate(() => window.__hushfall.myPos());
await p1.evaluate(() => window.__hushfall.warp(200, 200)); // seeker steps away
await p3.evaluate((p) => window.__hushfall.warp(p.x, p.y), p2posDown);
await p2.waitForFunction(() => window.__hushfall.amDowned?.() === false, null, { timeout: 8_000 }).catch(() => {});
await sleep(400);
const p2Revived = await p2.evaluate(() => window.__hushfall.amDowned());
const rescueOk = p2Revived === false;

// ESCAPE: host lights all lanterns, the gate opens, both hiders reach it and
// escape — ending the hunt as a Hider win.
await p1.evaluate(() => window.__hushfall.forceLightAll());
await sleep(400);
const gateOnP2 = await p2.evaluate(() => window.__hushfall.gateOpen());
const gate = await p2.evaluate(() => window.__hushfall.gatePos());
await p2.evaluate((g) => window.__hushfall.warp(g.x, g.y), gate);
await p3.evaluate((g) => window.__hushfall.warp(g.x + 20, g.y), gate);
await p1.waitForFunction(() => window.__hushfall.phase?.() !== 'playing', null, { timeout: 8_000 }).catch(() => {});
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
const botPos0 = await pb.evaluate(() => window.__hushfall.botPos());
await sleep(2800);
const botPos1 = await pb.evaluate(() => window.__hushfall.botPos());
const botMoved =
  !!botPos0 && !!botPos1 && Math.hypot(botPos1.x - botPos0.x, botPos1.y - botPos0.y) > 20;
// Open the gate + move the seeker aside; bots should now head north for it.
await pb.evaluate(() => window.__hushfall.warp(200, 1780));
await pb.evaluate(() => window.__hushfall.forceLightAll());
await sleep(3200);
const botPos2 = await pb.evaluate(() => window.__hushfall.botPos());
const botToGate = !!botPos1 && !!botPos2 && botPos2.y < botPos1.y - 20;
const botOk = botLobbyOk && matchBots === 3 && botMoved && botToGate;
await pb.screenshot({ path: `${outDir}/hf-6-bots-match.png` });

await browser.close();
relay.kill();

const ok =
  rolesOk &&
  startRolesOk &&
  seekerVisibleOk &&
  objectiveOk &&
  abilityOk &&
  downOk &&
  rescueOk &&
  escapeOk &&
  botOk &&
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
      abilityOk,
      revealBefore,
      revealAfter,
      usesP2,
      downOk,
      p2Downed,
      downCountHost,
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
      botToGate,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
