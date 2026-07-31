// Headless playtest for Blob Crashers: picks a class, walks the campaign
// map, fights a stage end to end, checks that progress sticks — and then
// opens two more "phones" that host and join a co-op room, to check the
// host-authority split (snapshots down, hit requests up) and the revive.
//
//   node scripts/verify-crashers.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5181/';
const outDir = process.env.SHOT_DIR ?? 'verify-shots';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

/** The bundled Chromium, wherever this environment put it. */
function findChromium() {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall back to whatever playwright finds */
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait for a condition rather than guessing how long it takes — a loaded
 *  machine runs the game loop slowly, and a fixed sleep tests the machine. */
const waitFor = async (read, ok, timeout = 15_000) => {
  const until = Date.now() + timeout;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await sleep(100);
    v = await read();
  }
  return v;
};

const dev = spawn('pnpm', ['--filter', '@interverse/crashers', 'dev'], {
  stdio: 'ignore',
  detached: true,
});

// The co-op half needs a relay. Games served from localhost pick up
// ws://localhost:8787 on their own, so starting one here is the whole setup.
if (!existsSync('relay/dist/server.js')) {
  console.error('relay/dist missing — run: pnpm --filter @interverse/relay build');
  process.exit(1);
}
const relay = spawn('node', ['relay/dist/server.js'], {
  env: { ...process.env, PORT: '8787' },
  stdio: 'ignore',
});
let relayUp = false;
for (let i = 0; i < 24 && !relayUp; i++) {
  try {
    relayUp = (await fetch('http://localhost:8787/health')).ok;
  } catch {
    await sleep(250);
  }
}
const browser = await chromium.launch({
  ...(findChromium() ? { executablePath: findChromium() } : {}),
});
const errors = [];
let report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  // The dev server may still be coming up.
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 5000 });
      break;
    } catch {
      await sleep(1000);
    }
  }
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  // Start from nothing, so the run is the same every time.
  await page.evaluate(() => window.__crashers.setRun({ cleared: 0, xp: 0, coins: 0, upgrades: { power: 0, speed: 0, hearts: 0 } }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(500);

  // ---------------------------------------------------------------- menu
  const screen0 = await page.evaluate(() => window.__crashers.screen());
  const stageCount = await page.evaluate(() => window.__crashers.stageCount());
  await page.evaluate(() => window.__crashers.pickClass(2)); // the Brute
  const picked = await page.evaluate(() => window.__crashers.pickedClass());
  await page.screenshot({ path: `${outDir}/cr-1-menu.png` });
  await page.evaluate(() => window.__crashers.start());
  await sleep(700);

  // ----------------------------------------------------------------- map
  const screen1 = await waitFor(
    () => page.evaluate(() => window.__crashers.screen()),
    (s) => s === 'map',
  );
  // A fresh run may only start stage 1 — the rest of the campaign is earned.
  const unlocked0 = await page.evaluate(() => window.__crashers.unlocked());
  const classKept = await page.evaluate(() => window.__crashers.run().classId);
  await page.screenshot({ path: `${outDir}/cr-2-map.png` });

  // --------------------------------------------------------------- fight
  await page.evaluate(() => window.__crashers.play(1));
  const fight0 = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f,
  );
  // Walk right into the first gate; it must stop the player.
  await page.evaluate(() => window.__crashers.move(1, 0));
  const atGate = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f && f.foes > 0,
  );
  const gateHeld = await waitFor(
    () => page.evaluate(() => window.__crashers.fight()),
    (f) => !!f && f.heroX >= f.limitX - 12,
  );
  await page.screenshot({ path: `${outDir}/cr-3-fight.png` });
  // A swing has to actually hurt something: clear the wave the hard way for
  // the first one, then shortcut the rest.
  const foesBefore = gateHeld.foes;
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__crashers.fight()))?.foes >= foesBefore; i++) {
    await page.evaluate(() => window.__crashers.swing());
    await sleep(140);
  }
  const afterSwings = await page.evaluate(() => window.__crashers.fight());
  // Then finish the stage: clear each wave as it appears and walk on.
  let cleared = 0;
  for (let i = 0; i < 60; i++) {
    const f = await page.evaluate(() => window.__crashers.fight());
    if (!f) break;
    if (f.foes > 0) {
      await page.evaluate(() => window.__crashers.clearWave());
      cleared++;
    }
    await sleep(160);
  }
  const finished = await waitFor(
    () => page.evaluate(() => window.__crashers.screen()),
    (s) => s === 'result',
    25_000,
  );
  await page.screenshot({ path: `${outDir}/cr-4-result.png` });
  const runAfter = await page.evaluate(() => window.__crashers.run());
  await page.evaluate(() => window.__crashers.next());
  await sleep(700);
  const unlocked1 = await waitFor(
    () => page.evaluate(() => window.__crashers.unlocked()),
    (u) => u.length > 1,
  );
  await page.screenshot({ path: `${outDir}/cr-5-map-after.png` });

  // Progress has to survive a reload, or a 15-stage campaign is pointless.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
  await sleep(500);
  const runReloaded = await page.evaluate(() => window.__crashers.run());

  // --------------------------------------------------------------- co-op
  // Two more phones: one hosts a room, one joins it by code. From here the
  // interesting question is not "does it work" but "who decided" — the host
  // owns the enemies, each player owns their own body.
  const phone = async (query) => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await p.goto(`${url}${query}`, { waitUntil: 'networkidle' });
    await p.waitForFunction(() => window.__crashers?.ready?.() === true, null, { timeout: 30_000 });
    return p;
  };
  const read = (p) => p.evaluate(() => window.__crashers.fight());

  const hostPage = await phone('?host=1');
  const hostLobby = await waitFor(
    () => hostPage.evaluate(() => window.__crashers.screen()),
    (s) => s === 'lobby',
    20_000,
  );
  const code = await hostPage.evaluate(() => window.__crashers.roomCode());
  await hostPage.screenshot({ path: `${outDir}/cr-6-lobby.png` });

  const joinPage = code ? await phone(`?join=${code}`) : null;
  const joinLobby = joinPage
    ? await waitFor(
        () => joinPage.evaluate(() => window.__crashers.screen()),
        (s) => s === 'lobby',
        20_000,
      )
    : '';
  // The host publishes the roster; the joiner never merges its own opinion in.
  const roster = joinPage ? await waitFor(
    () => joinPage.evaluate(() => window.__crashers.lobby()),
    (r) => r.length === 2,
  ) : [];
  await joinPage?.screenshot({ path: `${outDir}/cr-7-join.png` });

  await hostPage.evaluate(() => window.__crashers.lobbyStart());
  const hostFight = await waitFor(() => read(hostPage), (f) => !!f && f.party === 2, 20_000);
  const joinFight = joinPage
    ? await waitFor(() => read(joinPage), (f) => !!f && f.party === 2, 20_000)
    : null;

  // Going down must not end the stage for anyone — and a friend standing on
  // top of you must pick you back up. Done before either walks anywhere,
  // while the two start positions are still within revive range.
  await joinPage?.evaluate(() => window.__crashers.goDown());
  const hostSeesDown = joinPage
    ? await waitFor(
        () => hostPage.evaluate(() => window.__crashers.party()),
        (p) => p.some((m) => m.downed),
        8000,
      )
    : [];
  const revived = joinPage
    ? await waitFor(() => read(joinPage), (f) => !!f && !f.downed, 12_000)
    : null;
  await joinPage?.screenshot({ path: `${outDir}/cr-8-coop-fight.png` });

  // Walk both into the first gate and wait for the joiner to see enemies it
  // never spawned — that is the snapshot arriving.
  await hostPage.evaluate(() => window.__crashers.move(1, 0));
  await joinPage?.evaluate(() => window.__crashers.move(1, 0));
  const hostFoes = await waitFor(() => read(hostPage), (f) => !!f && f.foes > 0, 25_000);
  const joinFoes = joinPage
    ? await waitFor(() => read(joinPage), (f) => !!f && f.foes > 0, 20_000)
    : null;
  await hostPage.evaluate(() => window.__crashers.move(0, 0));
  await joinPage?.evaluate(() => window.__crashers.move(0, 0));

  // The joiner swings; only the host can actually kill anything, so a drop
  // in the HOST's foe count is proof the hit request made the round trip.
  const foesAtHost = hostFoes.foes;
  let joinHitLanded = false;
  for (let i = 0; i < 60 && !joinHitLanded; i++) {
    await joinPage?.evaluate(() => window.__crashers.swing());
    await sleep(150);
    const h = await read(hostPage);
    joinHitLanded = !!h && h.foes < foesAtHost;
  }
  const hostAfterJoinHits = await read(hostPage);
  await hostPage.screenshot({ path: `${outDir}/cr-9-coop-host.png` });

  const lobbyOk =
    hostLobby === 'lobby' && joinLobby === 'lobby' && /^[A-Z0-9]{4}$/.test(code) && roster.length === 2;
  const coopStartOk =
    !!hostFight && !!joinFight && hostFight.host === true && joinFight.host === false &&
    hostFight.party === 2 && joinFight.party === 2;
  const reviveOk = hostSeesDown.some((m) => m.downed) && !!revived && !revived.downed && revived.hearts > 0;
  const snapOk = !!joinFoes && joinFoes.foes > 0 && joinFoes.foes === hostFoes.foes;
  const hitOk = joinHitLanded && !!hostAfterJoinHits && hostAfterJoinHits.foes < foesAtHost;

  const menuOk = screen0 === 'menu' && stageCount === 15 && picked === 'brute' && classKept === 'brute';
  const mapOk = screen1 === 'map' && unlocked0.join() === '1';
  const gateOk =
    !!fight0 && atGate.foes > 0 && gateHeld.heroX >= gateHeld.limitX - 12 && gateHeld.hearts > 0;
  const combatOk = !!afterSwings && afterSwings.foes < foesBefore;
  const clearOk = finished === 'result' && cleared > 0 && runAfter.cleared === 1 && runAfter.xp > 0;
  const persistOk =
    unlocked1.includes(2) && runReloaded.cleared === 1 && runReloaded.xp === runAfter.xp;

  const ok =
    menuOk && mapOk && gateOk && combatOk && clearOk && persistOk &&
    relayUp && lobbyOk && coopStartOk && reviveOk && snapOk && hitOk &&
    errors.length === 0;
  report = {
    ok, menuOk, mapOk, gateOk, combatOk, clearOk, persistOk,
    relayUp, lobbyOk, coopStartOk, reviveOk, snapOk, hitOk,
    screen0, stageCount, picked, classKept, screen1, unlocked0,
    fight0, atGate, gateHeld, foesBefore, afterSwings, cleared, finished,
    runAfter, unlocked1, runReloaded,
    code, roster, hostFight, joinFight, hostSeesDown, revived,
    hostFoes, joinFoes, foesAtHost, hostAfterJoinHits,
    errors,
  };
} finally {
  await browser.close();
  relay.kill();
  try {
    process.kill(-dev.pid);
  } catch {
    /* already gone */
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
