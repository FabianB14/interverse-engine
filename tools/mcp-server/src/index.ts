/**
 * interverse — MCP server (spec §6.3).
 *
 * Gives Claude Code eyes and hands on the engine: list games/scenes, read
 * engine docs, run dev servers, SCREENSHOT the running game (so Claude can
 * see its work and iterate on visuals), spin up fake multiplayer players
 * against the relay, and validate dialogue files.
 *
 * Registered in the repo's .mcp.json; built to dist/ on pnpm install.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocket } from 'ws';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GAMES_DIR = join(REPO_ROOT, 'games');
const DOCS_DIR = join(REPO_ROOT, 'docs');
const SHOT_DIR = join(REPO_ROOT, 'verify-shots');

const server = new McpServer({ name: 'interverse', version: '0.1.0' });

// ---------------------------------------------------------------- helpers

interface GameInfo {
  dir: string;
  packageName: string;
  port: number | null;
}

function listGames(): GameInfo[] {
  const games: GameInfo[] = [];
  for (const dir of readdirSync(GAMES_DIR)) {
    const pkgPath = join(GAMES_DIR, dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
    let port: number | null = null;
    const vitePath = join(GAMES_DIR, dir, 'vite.config.ts');
    if (existsSync(vitePath)) {
      const m = /port:\s*(\d+)/.exec(readFileSync(vitePath, 'utf8'));
      if (m?.[1]) port = Number(m[1]);
    }
    games.push({ dir, packageName: pkg.name ?? dir, port });
  }
  return games;
}

function findGame(name: string): GameInfo | undefined {
  return listGames().find(
    (g) => g.dir === name || g.packageName === name || g.packageName === `@interverse/${name}`,
  );
}

function text(value: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_BIN) return process.env.CHROMIUM_BIN;
  try {
    for (const dir of readdirSync('/opt/pw-browsers')) {
      if (dir.startsWith('chromium-')) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
    }
  } catch {
    /* fall through to Playwright's own resolution */
  }
  return undefined;
}

// ------------------------------------------------------------- inspection

server.tool(
  'list_games',
  'List the games in this repo with their package names and dev ports.',
  {},
  () => text(listGames()),
);

server.tool(
  'list_scenes',
  'List the scene files of a game.',
  { game: z.string().describe('game dir or package name, e.g. "taps"') },
  ({ game }) => {
    const g = findGame(game);
    if (!g) return text(`unknown game "${game}" — try list_games`);
    const scenesDir = join(GAMES_DIR, g.dir, 'src', 'scenes');
    if (!existsSync(scenesDir)) return text([]);
    return text(readdirSync(scenesDir).filter((f) => f.endsWith('.ts')));
  },
);

server.tool(
  'get_engine_docs',
  'Read engine documentation for a topic: scenes, entities, art, tilemap, dialogue, net, audio-save-input.',
  { topic: z.string().describe('doc topic name') },
  ({ topic }) => {
    const file = join(DOCS_DIR, `${topic.replace(/[^a-z-]/g, '')}.md`);
    if (!existsSync(file)) {
      const topics = readdirSync(DOCS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
      return text(`unknown topic "${topic}". Available: ${topics.join(', ')}`);
    }
    return text(readFileSync(file, 'utf8'));
  },
);

// ------------------------------------------------------------- dev server

let devProc: ChildProcess | null = null;
let devGame: string | null = null;
let devUrl: string | null = null;

server.tool(
  'run_dev',
  'Start a game dev server (stops any previous one). Returns the local URL once vite is ready.',
  { game: z.string().describe('game dir or package name') },
  async ({ game }) => {
    const g = findGame(game);
    if (!g) return text(`unknown game "${game}" — try list_games`);
    if (devProc) {
      devProc.kill();
      devProc = null;
    }
    const proc = spawn('pnpm', ['--filter', g.packageName, 'dev'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devProc = proc;
    devGame = g.dir;
    devUrl = null;

    const url = await new Promise<string | null>((resolvePromise) => {
      const timeout = setTimeout(() => resolvePromise(null), 20_000);
      const onData = (chunk: Buffer): void => {
        const m = /Local:\s+(http:\/\/localhost:\d+\/)/.exec(chunk.toString());
        if (m?.[1]) {
          clearTimeout(timeout);
          resolvePromise(m[1]);
        }
      };
      proc.stdout?.on('data', onData);
      proc.on('exit', () => {
        clearTimeout(timeout);
        resolvePromise(null);
      });
    });
    if (!url) {
      proc.kill();
      devProc = null;
      return text(`dev server for ${g.dir} did not report a URL within 20s`);
    }
    devUrl = url;
    return text({ game: g.dir, url, note: 'use screenshot to look at it; stop_dev when done' });
  },
);

server.tool('stop_dev', 'Stop the running dev server.', {}, () => {
  if (!devProc) return text('no dev server running');
  devProc.kill();
  const was = devGame;
  devProc = null;
  devGame = null;
  devUrl = null;
  return text(`stopped dev server for ${was}`);
});

server.tool(
  'screenshot',
  'Screenshot a running game in a headless phone-sized browser so you can SEE it. Uses the run_dev URL by default; query can add debug params like "?round=6" or "?host=1".',
  {
    url: z.string().optional().describe('full URL; defaults to the run_dev server'),
    query: z.string().optional().describe('query string appended to the URL, e.g. "?host=1"'),
    waitMs: z.number().optional().describe('extra settle time in ms (default 1200)'),
    clickX: z.number().optional().describe('optional CSS-px click before the shot'),
    clickY: z.number().optional(),
  },
  async ({ url, query, waitMs, clickX, clickY }) => {
    const target = (url ?? devUrl) && `${url ?? devUrl}${query ?? ''}`;
    if (!target) return text('no URL — run_dev a game first or pass url');
    const { chromium } = await import('playwright-core');
    const executablePath = findChromium();
    const browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-webgl'],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
      });
      await page.goto(target, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForSelector('canvas', { timeout: 10_000 });
      if (clickX !== undefined && clickY !== undefined) {
        await page.mouse.click(clickX, clickY);
      }
      await page.waitForTimeout(waitMs ?? 1200);
      const png = await page.screenshot();
      await mkdir(SHOT_DIR, { recursive: true });
      const file = join(SHOT_DIR, `mcp-${Date.now()}.png`);
      await writeFile(file, png);
      return {
        content: [
          { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
          { type: 'text' as const, text: `saved to ${file}` },
        ],
      };
    } finally {
      await browser.close();
    }
  },
);

// ------------------------------------------------------- multiplayer bots

interface Bot {
  ws: WebSocket;
  id: string;
  name: string;
}

let hostBot: { ws: WebSocket; code: string } | null = null;
const bots: Bot[] = [];

function wsRequest(
  url: string,
  hello: Record<string, unknown>,
  expect: string,
): Promise<{ ws: WebSocket; msg: Record<string, unknown> }> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('relay connection timed out'));
    }, 10_000);
    ws.on('open', () => ws.send(JSON.stringify(hello)));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.t === expect) {
        clearTimeout(timeout);
        resolvePromise({ ws, msg });
      } else if (msg.t === 'error') {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(String(msg.message ?? 'relay error')));
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

server.tool(
  'create_room',
  'Host a room on the relay as a bot; returns the 4-letter code. Use join_room_bot to add players, or join from a real game UI.',
  {
    relay: z.string().optional().describe('relay URL (default ws://localhost:8787)'),
    game: z.string().optional().describe('game tag, e.g. "tap-party"'),
  },
  async ({ relay, game }) => {
    const url = relay ?? 'ws://localhost:8787';
    if (hostBot) {
      hostBot.ws.close();
      hostBot = null;
    }
    const { ws, msg } = await wsRequest(url, { t: 'host', name: 'BotHost', game }, 'hosted');
    hostBot = { ws, code: String(msg.code) };
    return text({ code: msg.code, note: 'bot-hosted room; disconnect_bots to clean up' });
  },
);

server.tool(
  'join_room_bot',
  'Join N fake players into a room by code. Each bot can send a test tap message after joining.',
  {
    code: z.string().describe('4-letter room code'),
    count: z.number().min(1).max(6).default(1),
    relay: z.string().optional().describe('relay URL (default ws://localhost:8787)'),
    game: z.string().optional().describe('game tag, e.g. "tap-party"'),
    sendTap: z.boolean().default(false).describe('each bot sends one tap message after joining'),
  },
  async ({ code, count, relay, game, sendTap }) => {
    const url = relay ?? 'ws://localhost:8787';
    const joined: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = `Bot${bots.length + 1}`;
      const { ws, msg } = await wsRequest(url, { t: 'join', code, name, game }, 'joined');
      bots.push({ ws, id: String(msg.id), name });
      joined.push(name);
      if (sendTap) {
        ws.send(
          JSON.stringify({
            t: 'msg',
            data: { type: 'tap', x: 200 + Math.random() * 320, y: 500 + Math.random() * 500 },
          }),
        );
      }
    }
    return text({ joined, totalBots: bots.length });
  },
);

server.tool('disconnect_bots', 'Disconnect all fake players and any bot-hosted room.', {}, () => {
  for (const b of bots) b.ws.close();
  const n = bots.length;
  bots.length = 0;
  if (hostBot) {
    hostBot.ws.close();
    hostBot = null;
  }
  return text(`disconnected ${n} bots${hostBot === null ? ' (and host bot)' : ''}`);
});

// -------------------------------------------------------------- validation

server.tool(
  'validate_dialogue',
  'Validate a dialogue JSON file: structure, node references, reachability.',
  { file: z.string().describe('path relative to the repo root') },
  ({ file }) => {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) return text(`no such file: ${file}`);
    const problems: string[] = [];
    let data: { start?: unknown; nodes?: Record<string, Record<string, unknown>> };
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as typeof data;
    } catch (err) {
      return text(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const nodes = data.nodes ?? {};
    const ids = Object.keys(nodes);
    if (typeof data.start !== 'string') problems.push('missing "start"');
    else if (!nodes[data.start]) problems.push(`start node "${data.start}" does not exist`);

    const referenced = new Set<string>();
    for (const [id, node] of Object.entries(nodes)) {
      if (typeof node.text !== 'string') problems.push(`node "${id}" has no text`);
      const next = node.next;
      if (next !== undefined) {
        if (typeof next !== 'string' || !nodes[next]) {
          problems.push(`node "${id}" -> next "${String(next)}" does not exist`);
        } else referenced.add(next);
      }
      const choices = node.choices;
      if (Array.isArray(choices)) {
        choices.forEach((c: Record<string, unknown>, i: number) => {
          if (typeof c.text !== 'string') problems.push(`node "${id}" choice ${i} has no text`);
          if (c.next !== undefined) {
            if (typeof c.next !== 'string' || !nodes[c.next]) {
              problems.push(`node "${id}" choice ${i} -> "${String(c.next)}" does not exist`);
            } else referenced.add(c.next);
          }
        });
      }
    }
    // Reachability note (entry-point nodes other than start are fine — games
    // may start conversations at alternate nodes — so report, don't fail).
    const unreachable = ids.filter((id) => id !== data.start && !referenced.has(id));
    return text({
      ok: problems.length === 0,
      nodes: ids.length,
      problems,
      alternateEntryPoints: unreachable,
    });
  },
);

// ------------------------------------------------------------------ start

await server.connect(new StdioServerTransport());
