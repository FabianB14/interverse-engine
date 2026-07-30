/**
 * Local AI bridge — lets the Studio "AI Chat" tab talk to Claude through
 * YOUR Claude Code login. No API key anywhere (spec §8.4: AI is dev-time
 * only; nothing here ships in a game).
 *
 *   pnpm ai            # start the bridge
 *   pnpm dev:studio    # open the Studio — the chat connects automatically
 *
 * Works from the dev server AND the installed PWA / hosted page: browsers
 * treat ws://127.0.0.1 as trustworthy even from https pages.
 *
 * Protocol (browser <-> bridge, JSON over one WebSocket):
 *   -> {type:'hello'}                         <- {type:'ready', mode}
 *   -> {type:'ask', ask, system}              <- {type:'text', text}
 *   <- {type:'tool_use', id, name, input}     -> {type:'tool_result', id, out}
 *   <- {type:'done'} | {type:'error', message}
 *
 * AI_BRIDGE_MOCK=1 answers with a canned agent (used by verify-studio so
 * headless tests exercise the full protocol without a Claude login).
 */
const PORT = Number(process.env.AI_BRIDGE_PORT || 8790);
const MOCK = process.env.AI_BRIDGE_MOCK === '1';

let WebSocketServer;
try {
  ({ WebSocketServer } = await import('ws'));
} catch {
  console.error('[ai-bridge] missing dependencies — run `pnpm install` in the repo first, then `pnpm ai` again.');
  process.exit(1);
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[ai-bridge] port ${PORT} is already in use — is another \`pnpm ai\` running? (That one works fine; you don't need two.)`);
    process.exit(1);
  }
  console.error('[ai-bridge] server error:', err?.message ?? err);
});
wss.on('listening', () => {
  console.log(`[ai-bridge] ready on ws://127.0.0.1:${PORT}${MOCK ? ' (mock mode)' : ' — using your Claude Code login'}`);
  console.log('[ai-bridge] open the Studio (dev server, website, or installed app) on THIS computer — the AI Chat connects by itself.');
});

wss.on('connection', (ws) => {
  console.log('[ai-bridge] studio connected');
  ws.on('close', () => console.log('[ai-bridge] studio disconnected'));
  const send = (m) => {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* socket gone */
    }
  };
  let seq = 0;
  const pending = new Map(); // tool_use id -> resolve(out)

  /** Ask the browser to run a studio tool and await its result. */
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

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'hello') send({ type: 'ready', mode: MOCK ? 'mock' : 'claude' });
    else if (msg.type === 'tool_result') {
      pending.get(msg.id)?.(String(msg.out ?? ''));
      pending.delete(msg.id);
    } else if (msg.type === 'ask') {
      console.log(`[ai-bridge] ask: ${String(msg.ask ?? '').slice(0, 80)}`);
      void handleAsk(String(msg.ask ?? ''), String(msg.system ?? ''));
    }
  });

  async function handleAsk(ask, system) {
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
    try {
      const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
      const { z } = await import('zod');
      const relay = (name) => async (args) => ({
        content: [{ type: 'text', text: await callTool(name, args) }],
      });
      const props = z.record(z.unknown()).optional();
      const studio = createSdkMcpServer({
        name: 'studio',
        version: '1.0.0',
        tools: [
          tool('get_project', 'Read the whole project (scenes, entities, scripts) as JSON.', {}, relay('get_project')),
          tool(
            'add_entity',
            'Add an entity to the current scene. kinds: blob, npc, mob, boss, crate, lantern, plant, text, button, image. Design space is 720x1280 portrait.',
            { kind: z.string(), x: z.number(), y: z.number(), props },
            relay('add_entity'),
          ),
          tool(
            'update_entity',
            'Update properties of an entity in the current scene, found by name.',
            { name: z.string(), props: z.record(z.unknown()) },
            relay('update_entity'),
          ),
          tool('remove_entity', 'Remove an entity from the current scene by name.', { name: z.string() }, relay('remove_entity')),
          tool(
            'set_scene_script',
            "Set the current scene's script (runs on scene start in Play mode). The body receives `api` — entity/player/ability/mobs/levels/net helpers.",
            { code: z.string() },
            relay('set_scene_script'),
          ),
          tool('add_scene', 'Add a new scene (level) and switch to it.', { name: z.string() }, relay('add_scene')),
        ],
      });
      const q = query({
        prompt: ask,
        options: {
          systemPrompt: system || 'You are the Interverse Studio copilot. Use the studio tools to edit the game; keep answers to one or two short sentences.',
          mcpServers: { studio },
          allowedTools: [
            'mcp__studio__get_project',
            'mcp__studio__add_entity',
            'mcp__studio__update_entity',
            'mcp__studio__remove_entity',
            'mcp__studio__set_scene_script',
            'mcp__studio__add_scene',
          ],
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
      send({ type: 'done' });
    } catch (err) {
      send({
        type: 'error',
        message:
          `${err instanceof Error ? err.message : String(err)}\n` +
          'The bridge uses your Claude Code login — run `claude` once in a terminal to sign in, then try again.',
      });
      send({ type: 'done' });
    }
  }
});
