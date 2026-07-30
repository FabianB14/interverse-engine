/**
 * AI copilot — chat with Claude, who edits the project through tools.
 * DEV-TIME ONLY (spec §8.4). Three ways in, best first:
 *   1. The local AI BRIDGE (`pnpm ai`): uses your Claude Code login over
 *      ws://127.0.0.1:8790 — no API key. The chat auto-connects, even from
 *      the installed PWA (browsers trust localhost from https).
 *   2. Claude Code driving the studio directly via the `interverse` MCP
 *      server's studio_* tools.
 *   3. Fallback only: an Anthropic API key typed here — kept in
 *      localStorage on this device, never shipped in an exported game.
 */
import type { StudioEditor } from './editor.js';
import type { EntityDef, EntityKind } from './model.js';

const KEY_STORE = 'interverse.studio.apikey';
const MODEL = 'claude-sonnet-5';
// ?bridge=ws://host:port overrides the default local bridge address.
const BRIDGE_URL =
  new URLSearchParams(window.location.search).get('bridge') ?? 'ws://127.0.0.1:8790';

interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const TOOLS: ToolSpec[] = [
  {
    name: 'get_project',
    description: 'Read the whole project (scenes, entities, scripts) as JSON.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_entity',
    description:
      'Add an entity to the current scene. kinds: blob, npc (story character), mob (enemy), boss, crate, lantern, plant, text, button, image. Design space is 720x1280 (portrait phone).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        props: { type: 'object', description: 'Optional EntityDef overrides (name, color, text, lines, ...)' },
      },
      required: ['kind', 'x', 'y'],
    },
  },
  {
    name: 'update_entity',
    description: 'Update properties of an entity in the current scene, found by name.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, props: { type: 'object' } },
      required: ['name', 'props'],
    },
  },
  {
    name: 'remove_entity',
    description: 'Remove an entity from the current scene by name.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'set_scene_script',
    description:
      "Set the current scene's script (runs on scene start in Play mode). The script body receives `api`: api.entity(name), api.onUpdate(fn), api.sfx.pop/blip/chime/buzz(), api.goto(sceneName), api.spawn(kind,x,y), api.say(speaker, ...lines), api.verium.",
    input_schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'add_scene',
    description: 'Add a new scene (level) and switch to it.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

function runTool(editor: StudioEditor, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'get_project':
      return editor.exportJson();
    case 'add_entity': {
      const def = editor.addEntity(String(input.kind) as EntityKind, Number(input.x), Number(input.y));
      if (input.props && typeof input.props === 'object') {
        Object.assign(def, input.props as Partial<EntityDef>);
        editor.updateEntity(def);
      }
      return `added "${def.name}"`;
    }
    case 'update_entity': {
      const def = editor.entityByName(String(input.name));
      if (!def) return `no entity named "${String(input.name)}" in this scene`;
      Object.assign(def, (input.props ?? {}) as Partial<EntityDef>);
      editor.updateEntity(def);
      return `updated "${def.name}"`;
    }
    case 'remove_entity': {
      const def = editor.entityByName(String(input.name));
      if (!def) return `no entity named "${String(input.name)}"`;
      editor.removeEntity(def.id);
      return 'removed';
    }
    case 'set_scene_script':
      editor.scene.script = String(input.code ?? '');
      editor.touch();
      return 'script set';
    case 'add_scene':
      return `added scene "${editor.addScene(String(input.name)).name}"`;
    default:
      return `unknown tool ${name}`;
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export function wireChat(editor: StudioEditor): { bridged: () => boolean } {
  const log = document.getElementById('chat-log')!;
  const keyInput = document.getElementById('chat-key') as HTMLInputElement;
  const input = document.getElementById('chat-input') as HTMLInputElement;
  const send = document.getElementById('btn-chat-send') as HTMLButtonElement;
  keyInput.value = localStorage.getItem(KEY_STORE) ?? '';
  keyInput.onchange = () => localStorage.setItem(KEY_STORE, keyInput.value.trim());

  const say = (cls: string, text: string): void => {
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  // ---- the local Claude bridge (no API key) -------------------------------
  let bridge: WebSocket | null = null;
  let bridgeReady = false;
  let bridgeDone: (() => void) | null = null;
  let connecting = false;

  // One live status line the retry loop updates in place (no log spam).
  const statusDiv = document.createElement('div');
  statusDiv.className = 'msg tool';
  const setStatus = (text: string): void => {
    statusDiv.textContent = text;
    if (!statusDiv.parentElement) log.appendChild(statusDiv);
    log.scrollTop = log.scrollHeight;
  };

  const systemContext = (): string =>
    `You are the Interverse Studio copilot, editing a 2D mobile game project live. ` +
    `Design space is 720x1280 portrait. Current scene: "${editor.scene.name}" with entities: ` +
    editor.scene.entities.map((e) => `${e.name} (${e.kind})`).join(', ') +
    `. Use the studio tools to make changes; keep answers to one or two short sentences.`;

  const connectBridge = (): void => {
    if (connecting || bridgeReady) return;
    connecting = true;
    try {
      const ws = new WebSocket(BRIDGE_URL);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello' }));
      ws.onmessage = (ev) => {
        let msg: { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; message?: string; mode?: string };
        try {
          msg = JSON.parse(String(ev.data)) as typeof msg;
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          bridge = ws;
          bridgeReady = true;
          connecting = false;
          keyInput.style.display = 'none';
          setStatus(`✦ Connected to Claude through your local bridge${msg.mode === 'mock' ? ' (mock)' : ''} — no API key needed. Ask away!`);
        } else if (msg.type === 'text' && msg.text) {
          say('bot', `Claude: ${msg.text}`);
        } else if (msg.type === 'tool_use') {
          const out = runTool(editor, msg.name ?? '', msg.input ?? {});
          say('tool', `⚙ ${msg.name}: ${out.length > 120 ? `${out.slice(0, 120)}…` : out}`);
          ws.send(JSON.stringify({ type: 'tool_result', id: msg.id, out }));
        } else if (msg.type === 'error' && msg.message) {
          say('tool', `Bridge: ${msg.message}`);
        } else if (msg.type === 'done') {
          bridgeDone?.();
          bridgeDone = null;
        }
      };
      ws.onclose = () => {
        const wasReady = bridgeReady;
        bridge = null;
        bridgeReady = false;
        connecting = false;
        keyInput.style.display = '';
        bridgeDone?.();
        bridgeDone = null;
        if (wasReady) setStatus('Bridge disconnected — restart it with `pnpm ai`; this chat reconnects automatically.');
      };
      ws.onerror = () => ws.close();
    } catch {
      connecting = false;
    }
  };
  // Keep looking for the bridge — starting `pnpm ai` AFTER opening the
  // Studio must "just work" without a reload or a manual Send.
  connectBridge();
  window.setInterval(connectBridge, 3000);

  say(
    'tool',
    '✦ Chat with Claude, no API key. On THIS computer (one-time): install Node.js (nodejs.org) and Claude Code (claude.com/claude-code, run `claude` once to sign in), and get the interverse-engine repo (Download ZIP works). Then just double-click start-ai.cmd (Windows) / start-ai.sh — or run `pnpm ai` — and leave it running. No install step needed; this chat connects by itself within a few seconds, from the website and the installed app too.\n\nNo Claude Code? Paste an Anthropic API key below as a fallback (kept only on this device) and ask — "add a spooky forest", "make the button switch to Level 2".',
  );
  setStatus(
    `⏳ Looking for the local bridge (\`pnpm ai\`) at ${BRIDGE_URL} — retrying every few seconds… ` +
      `Self-test: open http://127.0.0.1:8790 in a new tab; a green "bridge is running" page means it's reachable.`,
  );

  const history: { role: 'user' | 'assistant'; content: unknown }[] = [];

  async function turn(): Promise<void> {
    const ask = input.value.trim();
    if (!ask) {
      say('tool', 'Type a request first.');
      return;
    }
    // Bridge first: your Claude Code login, no API key.
    if (bridgeReady && bridge?.readyState === WebSocket.OPEN) {
      input.value = '';
      say('user', `You: ${ask}`);
      send.disabled = true;
      const finished = new Promise<void>((resolve) => {
        bridgeDone = resolve;
      });
      bridge.send(JSON.stringify({ type: 'ask', ask, system: systemContext() }));
      await finished;
      send.disabled = false;
      return;
    }
    connectBridge(); // one extra immediate attempt beyond the retry loop
    const key = keyInput.value.trim();
    if (!key) {
      say(
        'tool',
        'Not connected to the bridge yet. On THIS computer: `pnpm install` once, then `pnpm ai` in the repo and leave it running — the chat connects by itself. (Check the terminal running `pnpm ai` for errors.) Or paste an Anthropic API key as a fallback.',
      );
      return;
    }
    input.value = '';
    say('user', `You: ${ask}`);
    send.disabled = true;
    history.push({ role: 'user', content: ask });
    try {
      for (let hop = 0; hop < 8; hop++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2000,
            system:
              `You are the Interverse Studio copilot, editing a 2D mobile game project live. ` +
              `Design space is 720x1280 portrait. Current scene: "${editor.scene.name}" with entities: ` +
              editor.scene.entities.map((e) => `${e.name} (${e.kind})`).join(', ') +
              `. Use tools to make changes; keep answers to one or two short sentences.`,
            tools: TOOLS,
            messages: history,
          }),
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = (await res.json()) as { content: ContentBlock[]; stop_reason: string };
        history.push({ role: 'assistant', content: data.content });
        for (const block of data.content) {
          if (block.type === 'text' && block.text) say('bot', `Claude: ${block.text}`);
        }
        if (data.stop_reason !== 'tool_use') break;
        const results = data.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => {
            const out = runTool(editor, b.name ?? '', b.input ?? {});
            say('tool', `⚙ ${b.name}: ${out.length > 120 ? `${out.slice(0, 120)}…` : out}`);
            return { type: 'tool_result', tool_use_id: b.id, content: out };
          });
        history.push({ role: 'user', content: results });
      }
    } catch (err) {
      say('tool', `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      send.disabled = false;
    }
  }

  send.onclick = () => void turn();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void turn();
  };
  return { bridged: () => bridgeReady };
}
