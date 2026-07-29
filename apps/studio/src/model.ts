/**
 * Studio project model — a game is DATA. The editor edits these defs, the
 * runtime (runtime.ts) turns them into live engine scenes, and exported
 * games ship the same JSON + runtime. Keep every field concrete (with a
 * default) so the inspector and the AI copilot can edit anything safely.
 */

export type EntityKind =
  | 'blob' // playable-looking character
  | 'npc' // character with a story (tap to talk)
  | 'crate'
  | 'lantern'
  | 'plant'
  | 'text'
  | 'button'
  | 'image';

export type TapSound = '' | 'pop' | 'blip' | 'chime' | 'buzz';

export interface EntityDef {
  id: string;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: number;
  radius: number;
  seed: number;
  text: string;
  fontSize: number;
  /** Key into project.assets for kind 'image'. */
  assetId: string;
  /** Behaviors / juice. */
  wobble: boolean;
  popIn: boolean;
  tapSound: TapSound;
  /** Story lines (kind 'npc') — said in order when tapped in Play mode. */
  lines: string[];
}

export interface SceneDef {
  id: string;
  name: string;
  background: number;
  /** Scene script (the Code tab) — runs when the scene starts in Play mode. */
  script: string;
  entities: EntityDef[];
}

/** Public Interverse-world wiring — safe to ship (no secrets, spec §8.4). */
export interface PlatformDef {
  /** Base URL of an Interverse (IVX) node. */
  apiUrl: string;
  /** Registered world game id. */
  gameId: string;
  /** Player wallet address to show chain balance for (optional). */
  wallet: string;
}

export interface ProjectDef {
  version: 1;
  name: string;
  /** Wire up the Verium wallet + Interverse hooks in Play/exported games. */
  interverse: boolean;
  /** Optional Interverse-world connection (public fields only). */
  platform?: PlatformDef;
  startScene: string;
  scenes: SceneDef[];
  /** Imported images as data URLs, keyed by asset id. */
  assets: Record<string, string>;
}

let nextId = 1;
export function freshId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function defaultEntity(kind: EntityKind, x: number, y: number): EntityDef {
  const base: EntityDef = {
    id: freshId('e'),
    kind,
    name: kind,
    x: Math.round(x),
    y: Math.round(y),
    scale: 1,
    rotation: 0,
    color: 0xff6f91,
    radius: 34,
    seed: Math.floor(Math.random() * 1000),
    text: '',
    fontSize: 30,
    assetId: '',
    wobble: kind === 'blob' || kind === 'npc',
    popIn: true,
    tapSound: kind === 'button' ? 'blip' : '',
    lines: [],
  };
  switch (kind) {
    case 'npc':
      base.color = 0x8fd0ff;
      base.lines = ['Hello, traveler!'];
      break;
    case 'crate':
      base.color = 0x4a3826;
      break;
    case 'lantern':
      base.color = 0xffd166;
      break;
    case 'plant':
      base.color = 0x2f8d4a;
      break;
    case 'text':
      base.text = 'Your text here';
      base.color = 0xe6e4f0;
      break;
    case 'button':
      base.text = 'TAP ME';
      base.color = 0xffd166;
      break;
    case 'image':
      base.scale = 0.5;
      break;
  }
  return base;
}

export function defaultScene(name: string): SceneDef {
  return { id: freshId('s'), name, background: 0x101018, script: '', entities: [] };
}

export function defaultProject(): ProjectDef {
  const scene = defaultScene('Level 1');
  const blob = defaultEntity('blob', 360, 640);
  blob.name = 'Hero';
  scene.entities.push(blob);
  return {
    version: 1,
    name: 'My Game',
    interverse: false,
    startScene: scene.id,
    scenes: [scene],
    assets: {},
  };
}

/** Parse + minimally repair an imported project. Throws on hopeless input. */
export function parseProject(json: string): ProjectDef {
  const p = JSON.parse(json) as ProjectDef;
  if (!p || !Array.isArray(p.scenes) || p.scenes.length === 0) {
    throw new Error('Not an Interverse Studio project');
  }
  p.version = 1;
  p.name ||= 'My Game';
  p.interverse = !!p.interverse;
  p.assets ||= {};
  for (const s of p.scenes) {
    s.id ||= freshId('s');
    s.name ||= 'Level';
    s.background ??= 0x101018;
    s.script ??= '';
    s.entities ||= [];
    for (const e of s.entities) {
      const d = defaultEntity(e.kind ?? 'blob', e.x ?? 360, e.y ?? 640);
      Object.assign(d, e);
      Object.assign(e, d);
    }
  }
  if (!p.scenes.some((s) => s.id === p.startScene)) p.startScene = p.scenes[0]!.id;
  return p;
}
