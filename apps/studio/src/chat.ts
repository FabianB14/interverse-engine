/**
 * AI copilot — chat with Claude, who edits the project through tools.
 * DEV-TIME ONLY (spec §8.4): the API key is typed by the author, kept in
 * localStorage on this device, and never ships inside an exported game.
 */
import type { StudioEditor } from './editor.js';
import type { EntityDef, EntityKind } from './model.js';

const KEY_STORE = 'interverse.studio.apikey';
const MODEL = 'claude-sonnet-5';

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
      'Add an entity to the current scene. kinds: blob, npc (story character), crate, lantern, plant, text, button, image. Design space is 720x1280 (portrait phone).',
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

export function wireChat(editor: StudioEditor): void {
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
  say(
    'tool',
    'Dev-time copilot: paste your Anthropic API key (kept only on this device) and ask for anything — "add a spooky forest of plants", "make the button switch to Level 2", "write a story for the wizard".',
  );

  const history: { role: 'user' | 'assistant'; content: unknown }[] = [];

  async function turn(): Promise<void> {
    const key = keyInput.value.trim();
    const ask = input.value.trim();
    if (!key || !ask) {
      say('tool', key ? 'Type a request first.' : 'Paste an API key first.');
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
}
