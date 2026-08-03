// The <3MB joiner budget (spec 8.5), as a gate instead of a memory.
//
// "Browser joiners are sacred" only stays true while joining stays light,
// and payload budgets do not fail loudly — they erode, one dependency at a
// time, each too small to notice. A budget nobody measures is a wish. This
// measures: gzipped bytes of every file a game's dist ships, per game,
// against the spec ceiling — run it after `pnpm build`.
//
//   node scripts/check-budget.mjs          # all built games
//   node scripts/check-budget.mjs rush     # one game
//
// Exits 1 if any game is over. Prints every game either way, because the
// trend line matters before the ceiling does.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 3 * 1024 * 1024; // spec 8.5: <3MB initial load for joiners

// Per-game overrides, each one a deliberate decision with a reason —
// never a silent bump because a build went red.
const OVERRIDES = {
  // Blobhaven is the model showcase: its .glb catalogue (avatars, pets,
  // statues) ships with the game but loads LAZILY on placement/equip, so
  // the app shell a joiner must download stays ~250KB. Owner-approved 5MB
  // ceiling for the whole dist.
  haven: 5 * 1024 * 1024,
};

const only = process.argv[2];
const gamesDir = 'games';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function gzBytes(dir) {
  let total = 0;
  const heaviest = [];
  for (const f of walk(dir)) {
    const gz = gzipSync(readFileSync(f)).length;
    total += gz;
    heaviest.push({ f: f.slice(dir.length + 1), gz });
  }
  heaviest.sort((a, b) => b.gz - a.gz);
  return { total, heaviest: heaviest.slice(0, 3) };
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

let failed = false;
const rows = [];
for (const game of readdirSync(gamesDir)) {
  if (game.startsWith('_')) continue;
  if (only && game !== only) continue;
  const dist = join(gamesDir, game, 'dist');
  let info;
  try {
    info = gzBytes(dist);
  } catch {
    continue; // not built — nothing to measure
  }
  const budget = OVERRIDES[game] ?? BUDGET;
  const over = info.total > budget;
  if (over) failed = true;
  rows.push({ game, ...info, over, budget });
}

if (rows.length === 0) {
  console.error('no built games found — run `pnpm build` first');
  process.exit(1);
}

rows.sort((a, b) => b.total - a.total);
for (const r of rows) {
  const pct = ((r.total / r.budget) * 100).toFixed(0);
  const tag = r.budget !== BUDGET ? ` of ${kb(r.budget)} budget` : '% of budget';
  console.log(
    `${r.over ? '✗' : '✓'} ${r.game.padEnd(10)} ${kb(r.total).padStart(7)} gz  (${pct}${r.budget !== BUDGET ? `%${tag}` : tag})` +
      (r.over ? `  OVER — heaviest: ${r.heaviest.map((h) => `${h.f} ${kb(h.gz)}`).join(', ')}` : ''),
  );
}
process.exit(failed ? 1 : 0);
