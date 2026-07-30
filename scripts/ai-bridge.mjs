/**
 * Local AI bridge — lets the Studio "AI Chat" tab talk to Claude through
 * YOUR Claude Code login. No API key anywhere (spec §8.4: AI is dev-time
 * only; nothing here ships in a game).
 *
 * ZERO DEPENDENCIES: runs on plain Node — `pnpm install` is NOT required.
 * Start it with `pnpm ai`, `node scripts/ai-bridge.mjs`, or by
 * double-clicking start-ai.cmd (Windows) / start-ai.sh at the repo root.
 *
 * How it reaches Claude, best available first:
 *   1. The Claude Agent SDK (when the repo's node_modules exists).
 *   2. The `claude` CLI directly (works with only Node + Claude Code
 *      installed): spawned in stream-json mode with an MCP config that
 *      points back at THIS file (--mcp companion mode), which relays
 *      studio tool calls over a local TCP socket to the bridge, which
 *      forwards them over the WebSocket into the live editor tab.
 *
 * Protocol (browser <-> bridge, JSON over one WebSocket):
 *   -> {type:'hello'}                         <- {type:'ready', mode}
 *   -> {type:'ask', ask, system}              <- {type:'text', text}
 *   <- {type:'tool_use', id, name, input}     -> {type:'tool_result', id, out}
 *   <- {type:'done'} | {type:'error', message}
 *
 * AI_BRIDGE_MOCK=1 answers with a canned agent (used by verify-studio).
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection, createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { delimiter as pathDelimiter, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const PORT = Number(process.env.AI_BRIDGE_PORT || 8790);
const MOCK = process.env.AI_BRIDGE_MOCK === '1';

const TOOLS = [
  {
    name: 'get_project',
    description: 'Read the whole project (scenes, entities, scripts) as JSON.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_entity',
    description:
      'Add an entity to the current scene. kinds: blob, npc (story character), mob (enemy), boss, crate, lantern, plant, text, button, image. Design space is 720x1280 portrait.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        props: { type: 'object', description: 'Optional EntityDef overrides (name, color, hp, behavior, ...)' },
      },
      required: ['kind', 'x', 'y'],
    },
  },
  {
    name: 'update_entity',
    description: 'Update properties of an entity in the current scene, found by name.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, props: { type: 'object' } },
      required: ['name', 'props'],
    },
  },
  {
    name: 'remove_entity',
    description: 'Remove an entity from the current scene by name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'set_scene_script',
    description:
      "Set the current scene's script (runs on scene start in Play mode). The body receives `api` — entity/player/ability/mobs/levels/save/coins/net helpers.",
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'add_scene',
    description: 'Add a new scene (level) and switch to it.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];
const TOOL_NAMES = TOOLS.map((t) => `mcp__studio__${t.name}`);

// --------------------------------------------------------------------------
// Companion mode: `node ai-bridge.mjs --mcp` — a minimal MCP stdio server
// the `claude` CLI spawns; tools/call is relayed to the bridge over TCP.
// --------------------------------------------------------------------------
if (process.argv.includes('--mcp')) {
  const relayPort = Number(process.env.AI_BRIDGE_RELAY || 0);
  const sock = createConnection({ host: '127.0.0.1', port: relayPort });
  let relaySeq = 0;
  const relayPending = new Map();
  const relayLines = createInterface({ input: sock });
  relayLines.on('line', (line) => {
    try {
      const m = JSON.parse(line);
      relayPending.get(m.id)?.(String(m.out ?? ''));
      relayPending.delete(m.id);
    } catch {
      /* ignore */
    }
  });
  const relayCall = (name, input) =>
    new Promise((resolve) => {
      const id = `r${++relaySeq}`;
      relayPending.set(id, resolve);
      sock.write(`${JSON.stringify({ id, name, input })}\n`);
      setTimeout(() => {
        if (relayPending.has(id)) {
          relayPending.delete(id);
          resolve('(no reply from the studio tab)');
        }
      }, 15_000);
    });

  const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    void (async () => {
      if (req.method === 'initialize') {
        out({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            protocolVersion: req.params?.protocolVersion ?? '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'studio-bridge', version: '1.0.0' },
          },
        });
      } else if (req.method === 'tools/list') {
        out({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
      } else if (req.method === 'tools/call') {
        const text = await relayCall(req.params?.name ?? '', req.params?.arguments ?? {});
        out({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
      } else if (req.id !== undefined) {
        out({ jsonrpc: '2.0', id: req.id, result: {} });
      }
    })();
  });
  // keep running until the CLI closes us
} else {
  main();
}

function main() {
  // ---------------------------------------------------------------- HTTP
  const httpServer = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<body style="font-family:system-ui;background:#131120;color:#e6e4f0;padding:40px">
         <h1>✅ Interverse AI bridge is running${MOCK ? ' (mock mode)' : ''}</h1>
         <p>If you can read this, the Studio in <b>this browser</b> can reach the bridge.
         Open the Studio's <b>AI Chat</b> tab — it should say “✦ Connected” within a few seconds.</p>
         <p>If the chat still says it's looking: that Studio tab is probably running old cached
         code — close every Studio tab/window (installed app too), reopen it twice, and check again.</p>
         <p>The bridge signs in with your <b>Claude Code login</b> (run <code>claude</code> once in a
         terminal to log in).</p>
       </body>`,
    );
  });
  httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `[ai-bridge] port ${PORT} is already in use — is another bridge running? (That one works fine; you don't need two.)`,
      );
      process.exit(1);
    }
    console.error('[ai-bridge] server error:', err?.message ?? err);
  });

  // ------------------------------------------------- WebSocket (no deps)
  const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    wireClient(socket);
  });

  /** Send one unmasked text frame (server->client). */
  const wsSend = (socket, text) => {
    const payload = Buffer.from(text, 'utf8');
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    try {
      socket.write(Buffer.concat([header, payload]));
    } catch {
      /* socket gone */
    }
  };

  function wireClient(socket) {
    console.log('[ai-bridge] studio connected');
    let buf = Buffer.alloc(0);
    let fragments = [];
    const send = (m) => wsSend(socket, JSON.stringify(m));

    let seq = 0;
    const pending = new Map(); // tool_use id -> resolve(out)
    const callTool = (name, input) =>
      new Promise((resolve) => {
        const id = `t${++seq}`;
        pending.set(id, resolve);
        send({ type: 'tool_use', id, name, input });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            resolve('(the studio did not reply — is the tab still open?)');
          }
        }, 15_000);
      });

    const onMessage = (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'hello') send({ type: 'ready', mode: MOCK ? 'mock' : 'claude' });
      else if (msg.type === 'tool_result') {
        pending.get(msg.id)?.(String(msg.out ?? ''));
        pending.delete(msg.id);
      } else if (msg.type === 'ask') {
        console.log(`[ai-bridge] ask: ${String(msg.ask ?? '').slice(0, 80)}`);
        void handleAsk(send, callTool, String(msg.ask ?? ''), String(msg.system ?? ''));
      }
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // Parse complete frames (client frames are masked; may be fragmented).
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buf = buf.subarray(off + maskLen + len);
        if (opcode === 0x8) {
          try {
            socket.end(Buffer.from([0x88, 0x00]));
          } catch {
            /* already closed */
          }
          return;
        } else if (opcode === 0x9) {
          // ping -> pong with the same payload
          const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
          if (payload.length < 126) socket.write(pong);
        } else if (opcode === 0x1 || opcode === 0x0) {
          fragments.push(payload);
          if (fin) {
            const text = Buffer.concat(fragments).toString('utf8');
            fragments = [];
            onMessage(text);
          }
        }
      }
    });
    socket.on('close', () => console.log('[ai-bridge] studio disconnected'));
    socket.on('error', () => socket.destroy());
  }

  // ------------------------------------------------------------ answering

  async function handleAsk(send, callTool, ask, system) {
    if (!ask) {
      send({ type: 'done' });
      return;
    }
    if (MOCK) {
      send({ type: 'text', text: '(mock bridge) placing a lantern…' });
      const out = await callTool('add_entity', { kind: 'lantern', x: 300, y: 820 });
      send({ type: 'text', text: `Done — ${out}` });
      send({ type: 'done' });
      return;
    }
    // Best path: the Agent SDK (available when the repo's deps are installed).
    try {
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      const { z } = await import('zod');
      await askViaSdk(sdk, z, send, callTool, ask, system);
      send({ type: 'done' });
      return;
    } catch (err) {
      if (!isModuleNotFound(err)) {
        send({ type: 'error', message: describeClaudeError(err) });
        send({ type: 'done' });
        return;
      }
    }
    // Fallback: the claude CLI directly — needs no npm install at all.
    try {
      await askViaCli(send, callTool, ask, system);
    } catch (err) {
      send({ type: 'error', message: describeClaudeError(err) });
    }
    send({ type: 'done' });
  }

  async function askViaSdk(sdk, z, send, callTool, ask, system) {
    const relay = (name) => async (args) => ({ content: [{ type: 'text', text: await callTool(name, args) }] });
    const props = z.record(z.unknown()).optional();
    const studio = sdk.createSdkMcpServer({
      name: 'studio',
      version: '1.0.0',
      tools: [
        sdk.tool('get_project', TOOLS[0].description, {}, relay('get_project')),
        sdk.tool(
          'add_entity',
          TOOLS[1].description,
          { kind: z.string(), x: z.number(), y: z.number(), props },
          relay('add_entity'),
        ),
        sdk.tool(
          'update_entity',
          TOOLS[2].description,
          { name: z.string(), props: z.record(z.unknown()) },
          relay('update_entity'),
        ),
        sdk.tool('remove_entity', TOOLS[3].description, { name: z.string() }, relay('remove_entity')),
        sdk.tool('set_scene_script', TOOLS[4].description, { code: z.string() }, relay('set_scene_script')),
        sdk.tool('add_scene', TOOLS[5].description, { name: z.string() }, relay('add_scene')),
      ],
    });
    const q = sdk.query({
      prompt: ask,
      options: {
        systemPrompt: system || undefined,
        mcpServers: { studio },
        allowedTools: TOOL_NAMES,
        permissionMode: 'dontAsk',
        maxTurns: 8,
      },
    });
    for await (const m of q) {
      if (m.type === 'assistant') {
        for (const b of m.message?.content ?? []) {
          if (b.type === 'text' && b.text) send({ type: 'text', text: b.text });
        }
      } else if (m.type === 'result' && m.subtype && m.subtype !== 'success') {
        send({ type: 'error', message: `Claude run ended: ${m.subtype}` });
      }
    }
  }

  function askViaCli(send, callTool, ask, system) {
    const claude = findClaude();
    if (!claude) {
      throw new Error(
        'Claude Code is not installed (the `claude` command was not found). Install it from https://claude.com/claude-code, run `claude` once to sign in, then restart the bridge.',
      );
    }
    // TCP relay the MCP companion (spawned by the CLI) calls back into.
    return new Promise((resolve, reject) => {
      const relayServer = createTcpServer((sock) => {
        const lines = createInterface({ input: sock });
        lines.on('line', (line) => {
          void (async () => {
            try {
              const m = JSON.parse(line);
              const out = await callTool(m.name, m.input ?? {});
              sock.write(`${JSON.stringify({ id: m.id, out })}\n`);
            } catch {
              /* ignore bad lines */
            }
          })();
        });
      });
      relayServer.listen(0, '127.0.0.1', () => {
        const relayPort = relayServer.address().port;
        const dir = mkdtempSync(join(tmpdir(), 'interverse-ai-'));
        const cfgPath = join(dir, 'mcp.json');
        writeFileSync(
          cfgPath,
          JSON.stringify({
            mcpServers: {
              studio: {
                command: process.execPath,
                args: [THIS_FILE, '--mcp'],
                env: { AI_BRIDGE_RELAY: String(relayPort) },
              },
            },
          }),
        );
        const args = [
          '-p',
          '--output-format',
          'stream-json',
          '--verbose',
          '--max-turns',
          '8',
          '--mcp-config',
          cfgPath,
          '--allowedTools',
          TOOL_NAMES.join(','),
        ];
        const child = spawnClaude(claude, args);
        // The ask goes in via stdin — no shell-quoting pitfalls, ever.
        child.stdin.end(`${system ? `${system}\n\n` : ''}${ask}`);
        let sawResult = false;
        const outLines = createInterface({ input: child.stdout });
        outLines.on('line', (line) => {
          let m;
          try {
            m = JSON.parse(line);
          } catch {
            return;
          }
          if (m.type === 'assistant') {
            for (const b of m.message?.content ?? []) {
              if (b.type === 'text' && b.text) send({ type: 'text', text: b.text });
            }
          } else if (m.type === 'result') {
            sawResult = true;
            if (m.subtype && m.subtype !== 'success') {
              send({ type: 'error', message: `Claude run ended: ${m.subtype}` });
            }
          }
        });
        let stderrTail = '';
        child.stderr.on('data', (d) => {
          stderrTail = `${stderrTail}${d}`.slice(-400);
        });
        child.on('close', (code) => {
          relayServer.close();
          if (!sawResult && code !== 0) {
            reject(new Error(stderrTail.trim() || `claude exited with code ${code}`));
          } else {
            resolve();
          }
        });
        child.on('error', (err) => {
          relayServer.close();
          reject(err);
        });
      });
    });
  }

  function findClaude() {
    const names =
      process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
    for (const dir of (process.env.PATH ?? '').split(pathDelimiter)) {
      if (!dir) continue;
      for (const n of names) {
        const p = join(dir, n);
        if (existsSync(p)) return p;
      }
    }
    return null;
  }

  function spawnClaude(claudePath, args) {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath)) {
      // .cmd shims need cmd.exe; quote anything with spaces.
      const quoted = [claudePath, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
      return spawn('cmd.exe', ['/d', '/s', '/c', quoted.join(' ')], {
        windowsVerbatimArguments: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    return spawn(claudePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  }

  function isModuleNotFound(err) {
    return (
      err instanceof Error &&
      (err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find (module|package)/.test(err.message))
    );
  }

  function describeClaudeError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      `${msg}\n` +
      'The bridge uses your Claude Code login — run `claude` once in a terminal to sign in, then try again.'
    );
  }

  // ---------------------------------------------------------------- start
  const hasSavedLogin =
    existsSync(join(homedir(), '.claude', '.credentials.json')) ||
    !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    !!process.env.ANTHROPIC_API_KEY;

  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(
      `[ai-bridge] ready on ws://127.0.0.1:${PORT}${MOCK ? ' (mock mode)' : ' — using your Claude Code login'}`,
    );
    console.log(`[ai-bridge] self-test: open http://127.0.0.1:${PORT} in the same browser as the Studio`);
    console.log(
      MOCK
        ? '[ai-bridge] mock mode: canned answers, no Claude needed'
        : findClaude() || existsSync(join(process.cwd(), 'node_modules'))
          ? hasSavedLogin
            ? '[ai-bridge] Claude login: found saved credentials ✓'
            : '[ai-bridge] Claude login: no saved credentials seen — if asks fail, run `claude` in a terminal and sign in, then restart the bridge'
          : '[ai-bridge] WARNING: Claude Code not found — install it from https://claude.com/claude-code and run `claude` once to sign in',
    );
    console.log('[ai-bridge] open the Studio (dev server, website, or installed app) on THIS computer — the AI Chat connects by itself.');
  });
}
