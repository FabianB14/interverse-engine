/**
 * ⚡ Command + trigger metadata — one table, every consumer.
 *
 * The same nineteen event commands were described in three places before
 * this file existed: a bare allow-list in model.ts, labels and parameter
 * kinds in inspector.ts, and short display strings in flow.ts. The ⛓ Flow
 * drag-off palette wanted a fourth copy. They drift the moment anyone adds
 * a command, so they live here instead.
 *
 * model.ts deliberately keeps its own literal allow-lists: the parse layer
 * must not depend on UI metadata. A unit test asserts the two sets match in
 * both directions, which is the real binding.
 */
import type { EntityKind, EventAction, EventTrigger, ProjectDef } from './model.js';

export type CmdParams = 'text' | 'n' | 'sound' | 'music' | 'vfx' | 'item' | 'varn' | 'spawn' | 'none';

/** Where an event lives: on an actor, or on the level itself. */
export type Scope = 'entity' | 'level';

export interface CmdSpec {
  cmd: EventAction['cmd'];
  emoji: string;
  /** Plain label; pair with the emoji via cmdMenuLabel. */
  label: string;
  params: CmdParams;
  /** Extra words the search palette should match on. */
  keywords: readonly string[];
  /** 'remove' means "remove me", so it is meaningless with no owning actor. */
  scopes: readonly Scope[];
  /** Compact label for a Flow node row, e.g. '🪙+3'. */
  short: (a: EventAction) => string;
}

const BOTH: readonly Scope[] = ['entity', 'level'];

export const CMD_SPECS: readonly CmdSpec[] = [
  {
    cmd: 'say', emoji: '💬', label: 'Say message', params: 'text', scopes: BOTH,
    keywords: ['talk', 'dialogue', 'text', 'speak'],
    short: (a) => `💬"${(a.text ?? '').slice(0, 12)}"`,
  },
  {
    cmd: 'coins', emoji: '🪙', label: 'Give coins', params: 'n', scopes: BOTH,
    keywords: ['money', 'gold', 'wallet', 'reward'],
    short: (a) => `🪙+${a.n ?? 1}`,
  },
  {
    cmd: 'score', emoji: '⭐', label: 'Add score', params: 'n', scopes: BOTH,
    keywords: ['points', 'star'],
    short: (a) => `⭐+${a.n ?? 1}`,
  },
  {
    cmd: 'xp', emoji: '✨', label: 'Grant XP', params: 'n', scopes: BOTH,
    keywords: ['experience', 'level up'],
    short: (a) => `✨+${a.n ?? 5}`,
  },
  {
    cmd: 'heal', emoji: '❤', label: 'Heal hearts', params: 'n', scopes: BOTH,
    keywords: ['health', 'hp', 'life', 'restore'],
    short: (a) => `❤+${a.n ?? 1}`,
  },
  {
    cmd: 'sfx', emoji: '🔊', label: 'Play sound', params: 'sound', scopes: BOTH,
    keywords: ['audio', 'noise', 'pop', 'chime'],
    short: (a) => `🔊${a.text ?? 'pop'}`,
  },
  {
    cmd: 'music', emoji: '🎵', label: 'Music', params: 'music', scopes: BOTH,
    keywords: ['song', 'bgm', 'track', 'theme'],
    short: (a) => `🎵${a.text ?? ''}`,
  },
  {
    cmd: 'vfx', emoji: '✨', label: 'Particle burst', params: 'vfx', scopes: BOTH,
    keywords: ['effect', 'confetti', 'sparkle', 'particles'],
    short: (a) => `✨${a.text ?? ''}`,
  },
  {
    cmd: 'item', emoji: '🎁', label: 'Give item', params: 'item', scopes: BOTH,
    keywords: ['inventory', 'loot', 'database'],
    short: (a) => `🎁${a.text ?? ''}`,
  },
  {
    cmd: 'var', emoji: '🔢', label: 'Add to variable', params: 'varn', scopes: BOTH,
    keywords: ['counter', 'count', 'tally', 'quest'],
    short: (a) => `🔢${a.text ?? ''}+${a.n ?? 1}`,
  },
  {
    cmd: 'shop', emoji: '🛒', label: 'Open shop', params: 'none', scopes: BOTH,
    keywords: ['store', 'buy', 'merchant'],
    short: () => '🛒shop',
  },
  {
    cmd: 'inventory', emoji: '🎒', label: 'Open inventory', params: 'none', scopes: BOTH,
    keywords: ['bag', 'items', 'backpack'],
    short: () => '🎒bag',
  },
  {
    cmd: 'spawn', emoji: '🐣', label: 'Spawn a thing', params: 'spawn', scopes: BOTH,
    keywords: ['create', 'make', 'add actor'],
    short: (a) => `🐣${a.text ?? 'crate'}`,
  },
  {
    cmd: 'remove', emoji: '🗑', label: 'Remove this', params: 'none', scopes: ['entity'],
    keywords: ['delete', 'destroy', 'vanish'],
    short: () => '🗑self',
  },
  {
    cmd: 'goto', emoji: '🚪', label: 'Go to level…', params: 'text', scopes: BOTH,
    keywords: ['door', 'travel', 'scene', 'change level'],
    short: (a) => `🚪${a.text ?? ''}`,
  },
  {
    cmd: 'switchOn', emoji: '🔛', label: 'Turn switch ON', params: 'text', scopes: BOTH,
    keywords: ['flag', 'gate', 'unlock'],
    short: (a) => `🔛${a.text ?? ''}`,
  },
  {
    cmd: 'switchOff', emoji: '⏹', label: 'Turn switch OFF', params: 'text', scopes: BOTH,
    keywords: ['flag', 'gate', 'lock'],
    short: (a) => `⏹${a.text ?? ''}`,
  },
  {
    cmd: 'win', emoji: '🏆', label: 'Win the game', params: 'text', scopes: BOTH,
    keywords: ['victory', 'complete', 'finish'],
    short: () => '🏆win',
  },
  {
    cmd: 'lose', emoji: '💀', label: 'Lose the game', params: 'text', scopes: BOTH,
    keywords: ['defeat', 'game over', 'fail'],
    short: () => '💀lose',
  },
];

const BY_CMD = new Map(CMD_SPECS.map((s) => [s.cmd, s]));

export function cmdSpec(cmd: EventAction['cmd']): CmdSpec {
  return BY_CMD.get(cmd) ?? CMD_SPECS[0]!;
}

export const cmdMenuLabel = (s: CmdSpec): string => `${s.emoji} ${s.label}`;

/** Compact label for a ⛓ Flow node row. */
export function actionLabel(a: EventAction): string {
  return BY_CMD.has(a.cmd) ? cmdSpec(a.cmd).short(a) : a.cmd;
}

export function cmdsFor(scope: Scope): readonly CmdSpec[] {
  return CMD_SPECS.filter((s) => s.scopes.includes(scope));
}

export interface TriggerSpec {
  trigger: EventTrigger;
  emoji: string;
  label: string;
  /** Overrides label at level scope, where "it" has no referent. */
  levelLabel?: string;
  keywords: readonly string[];
  scopes: readonly Scope[];
}

export const TRIGGER_SPECS: readonly TriggerSpec[] = [
  {
    trigger: 'tap', emoji: '👆', label: 'When tapped', levelLabel: 'When the screen is tapped',
    keywords: ['click', 'press', 'touch screen'], scopes: BOTH,
  },
  {
    trigger: 'touch', emoji: '🚶', label: 'When the player touches it',
    keywords: ['collide', 'walk into', 'bump'], scopes: ['entity'],
  },
  {
    trigger: 'start', emoji: '🎬', label: 'When the level starts',
    keywords: ['begin', 'open', 'enter', 'load'], scopes: BOTH,
  },
  {
    trigger: 'every', emoji: '⏲', label: 'Every N seconds',
    keywords: ['timer', 'repeat', 'tick', 'interval'], scopes: BOTH,
  },
  {
    trigger: 'cleared', emoji: '🏁', label: 'When every enemy is defeated',
    keywords: ['all mobs dead', 'wave', 'clear', 'room'], scopes: ['level'],
  },
];

const BY_TRIGGER = new Map(TRIGGER_SPECS.map((s) => [s.trigger, s]));

export const TRIG_ICON: Record<EventTrigger, string> = TRIGGER_SPECS.reduce(
  (acc, s) => ({ ...acc, [s.trigger]: s.emoji }),
  {} as Record<EventTrigger, string>,
);

export function triggersFor(scope: Scope): readonly TriggerSpec[] {
  return TRIGGER_SPECS.filter((s) => s.scopes.includes(scope));
}

export function triggerLabel(t: EventTrigger, scope: Scope = 'entity'): string {
  const s = BY_TRIGGER.get(t);
  if (!s) return t;
  return `${s.emoji} ${(scope === 'level' && s.levelLabel) || s.label}`;
}

/** Every switch name the project mentions, for pick-from-a-list editing. */
export function knownSwitches(p: ProjectDef): string[] {
  const out = new Set<string>();
  for (const ev of allEvents(p)) {
    if (ev.ifSwitch) out.add(ev.ifSwitch);
    for (const a of ev.actions) {
      if ((a.cmd === 'switchOn' || a.cmd === 'switchOff') && a.text) out.add(a.text);
    }
  }
  return [...out].sort();
}

/** Every variable name the project mentions. */
export function knownVars(p: ProjectDef): string[] {
  const out = new Set<string>();
  for (const ev of allEvents(p)) {
    if (ev.ifVar) out.add(ev.ifVar);
    for (const a of ev.actions) if (a.cmd === 'var' && a.text) out.add(a.text);
  }
  return [...out].sort();
}

/** An unused link-N style switch name, so auto-wiring never collides. */
export function freshSwitchName(p: ProjectDef, base = 'link'): string {
  const used = new Set(knownSwitches(p));
  let n = 1;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Actor kinds a drag-off palette may create (images need a file first). */
export const SPAWNABLE_KINDS: readonly EntityKind[] = [
  'blob', 'npc', 'mob', 'boss', 'crate', 'lantern', 'plant', 'text', 'button',
];

function allEvents(p: ProjectDef): { ifSwitch?: string; ifVar?: string; actions: EventAction[] }[] {
  const out: { ifSwitch?: string; ifVar?: string; actions: EventAction[] }[] = [];
  for (const s of p.scenes) {
    for (const ev of s.events ?? []) out.push(ev);
    for (const e of s.entities) for (const ev of e.events) out.push(ev);
  }
  return out;
}
