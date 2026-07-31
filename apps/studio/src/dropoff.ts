/**
 * 🔍 Drag-off search — the Blueprints gesture, in the ⛓ Flow map.
 *
 * Drag from a node's ◉ port and let go over empty canvas: a search popup
 * appears at the drop point, and picking something creates it already
 * wired to where you dragged from. Releasing over another node still just
 * links the two, as before.
 *
 * The mutation lives here and is pure-ish (it edits the project and says
 * what it did), so what each entry actually writes is unit-testable
 * without a DOM or a drag.
 */
import { SPAWNABLE_KINDS, cmdMenuLabel, cmdsFor, triggerLabel, triggersFor } from './cmds.js';
import type { Scope } from './cmds.js';
import { defaultEntity, freshId } from './model.js';
import type { EventAction, EventDef, ProjectDef, SceneDef } from './model.js';

export interface DropEntry {
  /** 'act:coins' · 'trig:tap' · 'lvl:new' · 'ent:mob' */
  id: string;
  label: string;
  category: string;
  keywords: string;
}

/** What a drag from this node can create. Levels cannot own 'remove', so
 *  the command list is scope-filtered rather than one flat menu. */
export function dropEntries(scope: Scope): DropEntry[] {
  const out: DropEntry[] = [];
  for (const c of cmdsFor(scope)) {
    out.push({ id: `act:${c.cmd}`, label: cmdMenuLabel(c), category: 'Do something', keywords: c.keywords.join(' ') });
  }
  for (const t of triggersFor(scope)) {
    out.push({
      id: `trig:${t.trigger}`,
      label: triggerLabel(t.trigger, scope),
      category: 'When…',
      keywords: t.keywords.join(' '),
    });
  }
  out.push({ id: 'lvl:new', label: '🚪 New level (with a door to it)', category: 'Create', keywords: 'scene room stage' });
  for (const kind of SPAWNABLE_KINDS) {
    out.push({ id: `ent:${kind}`, label: `➕ New ${kind}`, category: 'Create', keywords: `actor place ${kind}` });
  }
  return out;
}

/** Rank entries against a typed query — literal beats subsequence. */
export function rankDrops(entries: readonly DropEntry[], query: string): DropEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  const score = (e: DropEntry): number => {
    const hay = `${e.label} ${e.keywords}`.toLowerCase();
    const lit = hay.indexOf(q);
    if (lit >= 0) return lit;
    let hi = 0;
    let s = 500;
    for (const ch of q) {
      const at = hay.indexOf(ch, hi);
      if (at === -1) return -1;
      s += at - hi;
      hi = at + 1;
    }
    return s;
  };
  return entries
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.e);
}

export interface DropTarget {
  /** The events array the drag came from (an actor's, or a level's). */
  events: EventDef[];
  scene: SceneDef;
  scope: Scope;
}

/** Resolve a Flow node id to the thing that owns its events. */
export function targetOf(project: ProjectDef, nodeId: string): DropTarget | null {
  for (const scene of project.scenes) {
    if (`lvl:${scene.id}` === nodeId) {
      scene.events ??= [];
      return { events: scene.events, scene, scope: 'level' };
    }
    for (const ent of scene.entities) {
      if (`ent:${ent.id}` === nodeId) return { events: ent.events, scene, scope: 'entity' };
    }
  }
  return null;
}

/** Apply one search result. Returns what changed, or null if it could not
 *  be applied — the caller re-renders on a truthy result. */
export function applyDrop(
  project: ProjectDef,
  nodeId: string,
  entryId: string,
  at: { x: number; y: number },
): { kind: 'action' | 'trigger' | 'level' | 'entity'; name: string } | null {
  const target = targetOf(project, nodeId);
  if (!target) return null;
  // Everything hangs off an event, so a node with none gets one first.
  const ensureEvent = (): EventDef => {
    if (!target.events.length) {
      target.events.push({ trigger: target.scope === 'level' ? 'start' : 'touch', actions: [] });
    }
    return target.events[0]!;
  };

  if (entryId.startsWith('act:')) {
    const cmd = entryId.slice(4) as EventAction['cmd'];
    const action: EventAction = { cmd };
    if (cmd === 'say') action.text = 'Hello!';
    if (cmd === 'coins' || cmd === 'score' || cmd === 'xp' || cmd === 'heal') action.n = 1;
    if (cmd === 'var') {
      action.text = 'count';
      action.n = 1;
    }
    if (cmd === 'music') action.text = 'adventure';
    if (cmd === 'vfx') action.text = 'sparkle';
    if (cmd === 'sfx') action.text = 'pop';
    if (cmd === 'spawn') action.text = 'crate';
    ensureEvent().actions.push(action);
    return { kind: 'action', name: cmd };
  }

  if (entryId.startsWith('trig:')) {
    const trigger = entryId.slice(5) as EventDef['trigger'];
    target.events.push({ trigger, actions: [] });
    return { kind: 'trigger', name: trigger };
  }

  if (entryId === 'lvl:new') {
    const name = freshLevelName(project);
    const scene: SceneDef = {
      id: freshId('s'),
      name,
      background: target.scene.background,
      view: target.scene.view,
      gravity: target.scene.gravity,
      worldW: target.scene.worldW,
      worldH: target.scene.worldH,
      script: '',
      entities: [],
    };
    project.scenes.push(scene);
    ensureEvent().actions.push({ cmd: 'goto', text: name });
    return { kind: 'level', name };
  }

  if (entryId.startsWith('ent:')) {
    const kind = entryId.slice(4) as Parameters<typeof defaultEntity>[0];
    // Drop it inside the world, and below the horizon in a 2.5D level so it
    // lands on the walkable ground rather than in the sky.
    const minY = target.scene.view === 'depth' ? 380 : 40;
    const x = Math.max(40, Math.min(target.scene.worldW - 40, Math.round(at.x)));
    const y = Math.max(minY, Math.min(target.scene.worldH - 40, Math.round(at.y)));
    const def = defaultEntity(kind, x, y);
    def.name = freshEntityName(target.scene, kind);
    target.scene.entities.push(def);
    return { kind: 'entity', name: def.name };
  }
  return null;
}

function freshLevelName(p: ProjectDef): string {
  const used = new Set(p.scenes.map((s) => s.name));
  let n = p.scenes.length + 1;
  while (used.has(`Level ${n}`)) n++;
  return `Level ${n}`;
}

function freshEntityName(s: SceneDef, kind: string): string {
  const used = new Set(s.entities.map((e) => e.name));
  if (!used.has(kind)) return kind;
  let n = 2;
  while (used.has(`${kind} ${n}`)) n++;
  return `${kind} ${n}`;
}

export interface PaletteHandle {
  setQuery: (q: string) => string[];
  visible: () => string[];
  move: (d: number) => string | null;
  highlighted: () => string | null;
  commit: (id?: string) => boolean;
  close: () => void;
}

/** The popup itself — zero dependencies, works with mouse, touch and keys. */
export function openDropPalette(opts: {
  entries: readonly DropEntry[];
  at: { x: number; y: number };
  onPick: (id: string) => void;
  onClose?: () => void;
}): PaletteHandle {
  const box = document.createElement('div');
  box.className = 'drop-palette';
  box.style.cssText = `position:fixed;left:${opts.at.x}px;top:${opts.at.y}px;z-index:60;width:284px;
    background:#211d30;border:1px solid #4a4370;border-radius:10px;box-shadow:0 12px 34px #0009;padding:6px`;
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '🔍 what should happen?';
  input.style.cssText = 'width:100%;background:#16121f;color:inherit;border:1px solid #35304d;border-radius:7px;padding:6px 8px;font:inherit';
  const list = document.createElement('div');
  list.style.cssText = 'max-height:236px;overflow-y:auto;margin-top:5px';
  box.append(input, list);
  document.body.appendChild(box);

  let shown: DropEntry[] = [];
  let hi = 0;

  const render = (): void => {
    shown = rankDrops(opts.entries, input.value);
    hi = Math.min(hi, Math.max(0, shown.length - 1));
    list.textContent = '';
    let cat = '';
    shown.forEach((e, i) => {
      if (e.category !== cat) {
        cat = e.category;
        const h = document.createElement('div');
        h.style.cssText = 'font-size:11px;opacity:.55;padding:5px 6px 2px';
        h.textContent = cat;
        list.appendChild(h);
      }
      const row = document.createElement('div');
      row.dataset.id = e.id;
      row.style.cssText = `padding:5px 7px;border-radius:6px;cursor:pointer;font-size:12px;${i === hi ? 'background:#3a3268' : ''}`;
      // Labels carry author-written names, so never innerHTML them.
      row.textContent = e.label;
      row.onclick = () => commit(e.id);
      list.appendChild(row);
    });
  };

  const close = (): void => {
    box.remove();
    window.removeEventListener('pointerdown', outside, true);
    opts.onClose?.();
  };
  const commit = (id?: string): boolean => {
    const chosen = id ?? shown[hi]?.id;
    if (!chosen) return false;
    opts.onPick(chosen);
    close();
    return true;
  };
  const outside = (e: PointerEvent): void => {
    if (!box.contains(e.target as Node)) close();
  };

  input.oninput = render;
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  render();
  input.focus();
  // Deferred so the pointerup that opened it does not immediately close it.
  setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);

  return {
    setQuery: (q) => {
      input.value = q;
      render();
      return shown.map((e) => e.id);
    },
    visible: () => shown.map((e) => e.id),
    move: (d) => {
      hi = Math.max(0, Math.min(shown.length - 1, hi + d));
      render();
      return shown[hi]?.id ?? null;
    },
    highlighted: () => shown[hi]?.id ?? null,
    commit,
    close,
  };
}
