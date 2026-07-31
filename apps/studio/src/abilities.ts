/**
 * ⚡ The ability editor — make an ability without writing code.
 *
 * Abilities used to exist only as an api.ability() call inside a scene
 * script, which meant a non-programmer could not make one at all, and no
 * actor "owned" anything. They are now database entries that actors are
 * GIVEN, and this is where they are created: pick what it does from a list,
 * set how hard and how often, choose an icon, done.
 */
import { ABILITY_EFFECTS, defaultAbility } from './model.js';
import type { AbilityDef, AbilityEffect, ProjectDef, TapSound } from './model.js';
import { ICON_IDS } from './icons.js';

/** Plain-language description of each effect, shown live in the editor so
 *  an author can tell what they are choosing without testing it. */
export const EFFECT_HELP: Record<AbilityEffect, (a: AbilityDef) => string> = {
  melee: (a) => `Hits every enemy within ${a.radius} of you for ${a.power} damage.`,
  ranged: (a) => `Fires a shot at the nearest enemy for ${a.power} damage (speed ${a.radius}).`,
  heal: (a) => `Restores ${a.power} heart${a.power === 1 ? '' : 's'}.`,
  dash: (a) => `Leaps ${a.power} forward, the way you are facing.`,
  spawn: (a) => `Drops a ${a.spawn} next to you.`,
  custom: () => 'Runs the code you write below — for anything the list does not cover.',
};

export const EFFECT_LABEL: Record<AbilityEffect, string> = {
  melee: '🗡 Attack nearby enemies',
  ranged: '🏹 Shoot the nearest enemy',
  heal: '❤ Heal yourself',
  dash: '👟 Dash forward',
  spawn: '🐣 Drop something',
  custom: '📝 Custom code',
};

/** Sensible starting numbers per effect, so switching the dropdown gives a
 *  usable ability instead of nonsense carried over from the last one. */
export function presetFor(effect: AbilityEffect, a: AbilityDef): AbilityDef {
  const base = { ...a, effect };
  if (effect === 'melee') return { ...base, power: 1, radius: 130, cooldown: 0.6, icon: 'sword' };
  if (effect === 'ranged') return { ...base, power: 1, radius: 420, cooldown: 0.8, icon: 'bolt' };
  if (effect === 'heal') return { ...base, power: 1, radius: 0, cooldown: 8, icon: 'heart' };
  if (effect === 'dash') return { ...base, power: 220, radius: 0, cooldown: 2, icon: 'boot' };
  if (effect === 'spawn') return { ...base, power: 0, radius: 0, cooldown: 3, icon: 'star' };
  return { ...base, cooldown: 1, icon: 'fire' };
}

/** Which numeric fields an effect actually uses — hiding the rest is what
 *  keeps the form short enough that someone finishes it. */
export function fieldsFor(effect: AbilityEffect): { power: string | null; radius: string | null } {
  switch (effect) {
    case 'melee':
      return { power: 'Damage', radius: 'Reach' };
    case 'ranged':
      return { power: 'Damage', radius: 'Shot speed' };
    case 'heal':
      return { power: 'Hearts', radius: null };
    case 'dash':
      return { power: 'Distance', radius: null };
    default:
      return { power: null, radius: null };
  }
}

export function abilityList(p: ProjectDef): AbilityDef[] {
  return p.db?.abilities ?? [];
}

export function ensureDb(p: ProjectDef): NonNullable<ProjectDef['db']> {
  p.db ??= { items: [] };
  p.db.abilities ??= [];
  return p.db;
}

/** Add a new ability with a name that is not taken. */
export function createAbility(p: ProjectDef, name = 'New ability'): AbilityDef {
  const db = ensureDb(p);
  const used = new Set(db.abilities!.map((a) => a.id));
  let id = slug(name);
  let n = 2;
  while (used.has(id)) id = `${slug(name)}-${n++}`;
  const a = defaultAbility(id, name);
  db.abilities!.push(a);
  return a;
}

export function deleteAbility(p: ProjectDef, id: string): number {
  const db = ensureDb(p);
  const i = db.abilities!.findIndex((a) => a.id === id);
  if (i < 0) return 0;
  db.abilities!.splice(i, 1);
  // Take it off every actor too, so nobody keeps a button that does nothing.
  let removed = 0;
  for (const s of p.scenes) {
    for (const e of s.entities) {
      const at = e.abilities.indexOf(id);
      if (at >= 0) {
        e.abilities.splice(at, 1);
        removed++;
      }
    }
  }
  return removed;
}

/** Give / take an ability from an actor. */
export function grantTo(p: ProjectDef, entityName: string, abilityId: string, on: boolean): boolean {
  for (const s of p.scenes) {
    for (const e of s.entities) {
      if (e.name !== entityName) continue;
      const at = e.abilities.indexOf(abilityId);
      if (on && at < 0) e.abilities.push(abilityId);
      if (!on && at >= 0) e.abilities.splice(at, 1);
      return true;
    }
  }
  return false;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ability';
}

export interface AbilityEditorHost {
  project: ProjectDef;
  touch: () => void;
  openModal: (build: (root: HTMLElement) => void) => void;
}

/** The ⚡ Abilities screen: the list, and a form for the selected one. */
export function openAbilityEditor(host: AbilityEditorHost, focusId?: string): void {
  host.openModal((root) => {
    const p = host.project;
    ensureDb(p);
    let current = focusId ?? abilityList(p)[0]?.id ?? '';

    const render = (): void => {
      const abilities = abilityList(p);
      root.innerHTML = `<h2>⚡ Abilities</h2>
        <p class="muted" style="font-size:12px">
          An ability is a button your player taps. Give it to an actor in that actor's inspector,
          or hand it out from a 🌳 skill tree.
        </p>
        <div class="row" style="margin-bottom:10px;flex-wrap:wrap" id="ab-list"></div>
        <div class="row" style="margin-bottom:10px">
          <button class="btn primary" id="ab-new">✚ Create an ability</button>
        </div>
        <div id="ab-form"></div>`;
      const list = root.querySelector<HTMLElement>('#ab-list')!;
      if (!abilities.length) {
        list.innerHTML = '<span class="muted" style="font-size:12px">No abilities yet — create one.</span>';
      }
      for (const a of abilities) {
        const b = document.createElement('button');
        b.className = a.id === current ? 'btn primary' : 'btn';
        b.textContent = `${a.name}`;
        b.onclick = () => {
          current = a.id;
          render();
        };
        list.appendChild(b);
      }
      root.querySelector<HTMLButtonElement>('#ab-new')!.onclick = () => {
        current = createAbility(p).id;
        host.touch();
        render();
      };

      const a = abilities.find((x) => x.id === current);
      const form = root.querySelector<HTMLElement>('#ab-form')!;
      if (!a) return;

      const f = fieldsFor(a.effect);
      form.innerHTML = `
        <div class="row"><label class="muted" style="width:90px">Name</label>
          <input id="ab-name" type="text" style="flex:1" /></div>
        <div class="row" style="margin-top:6px"><label class="muted" style="width:90px">Does what</label>
          <select id="ab-effect" style="flex:1"></select></div>
        <p class="muted" id="ab-help" style="font-size:12px;margin:6px 0"></p>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${f.power ? `<label class="muted">${f.power} <input id="ab-power" type="number" style="width:76px" /></label>` : ''}
          ${f.radius ? `<label class="muted">${f.radius} <input id="ab-radius" type="number" style="width:82px" /></label>` : ''}
          <label class="muted">Cooldown <input id="ab-cd" type="number" step="0.1" style="width:70px" />s</label>
          <label class="muted">Key <input id="ab-key" type="text" maxlength="12" style="width:60px" /></label>
        </div>
        ${a.effect === 'spawn' ? '<div class="row" style="margin-top:6px"><label class="muted" style="width:90px">Drops</label><select id="ab-spawn"></select></div>' : ''}
        <div class="row" style="margin-top:6px"><label class="muted" style="width:90px">Icon</label>
          <select id="ab-icon"></select>
          <label class="muted">Effect <select id="ab-vfx"></select></label>
          <label class="muted">Sound <select id="ab-sfx"></select></label>
        </div>
        ${a.effect === 'custom' ? '<textarea id="ab-script" spellcheck="false" style="width:100%;height:90px;margin-top:6px" placeholder="api.meleeAttack(200, 3);"></textarea>' : ''}
        <div class="row" style="margin-top:10px">
          <button class="btn" id="ab-del">🗑 Delete</button>
        </div>`;

      const set = <T extends HTMLElement>(id: string): T | null => form.querySelector<T>(id);
      const name = set<HTMLInputElement>('#ab-name')!;
      name.value = a.name;
      name.oninput = () => {
        a.name = name.value;
        host.touch();
      };

      const eff = set<HTMLSelectElement>('#ab-effect')!;
      for (const e of ABILITY_EFFECTS) {
        const o = document.createElement('option');
        o.value = e;
        o.textContent = EFFECT_LABEL[e];
        if (e === a.effect) o.selected = true;
        eff.appendChild(o);
      }
      eff.onchange = () => {
        // Switching what it does resets the numbers to something usable.
        Object.assign(a, presetFor(eff.value as AbilityEffect, a));
        host.touch();
        render();
      };
      set<HTMLElement>('#ab-help')!.textContent = EFFECT_HELP[a.effect](a);

      const num = (sel: string, key: 'power' | 'radius' | 'cooldown'): void => {
        const el = set<HTMLInputElement>(sel);
        if (!el) return;
        el.value = String(a[key]);
        el.oninput = () => {
          a[key] = Number(el.value) || 0;
          set<HTMLElement>('#ab-help')!.textContent = EFFECT_HELP[a.effect](a);
          host.touch();
        };
      };
      num('#ab-power', 'power');
      num('#ab-radius', 'radius');
      num('#ab-cd', 'cooldown');

      const key = set<HTMLInputElement>('#ab-key')!;
      key.value = a.key;
      key.title = 'Optional keyboard shortcut — handy while editing; phones use the button.';
      key.oninput = () => {
        a.key = key.value.toLowerCase();
        host.touch();
      };

      const pickList = (sel: string, values: readonly string[], cur: string, cb: (v: string) => void): void => {
        const el = set<HTMLSelectElement>(sel);
        if (!el) return;
        for (const v of values) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v || '(none)';
          if (v === cur) o.selected = true;
          el.appendChild(o);
        }
        el.onchange = () => {
          cb(el.value);
          host.touch();
        };
      };
      pickList('#ab-icon', ICON_IDS, a.icon, (v) => (a.icon = v));
      pickList('#ab-vfx', ['', 'sparkle', 'confetti', 'poof', 'hearts', 'embers', 'coins'], a.vfx, (v) => (a.vfx = v));
      pickList('#ab-sfx', ['', 'pop', 'blip', 'chime', 'buzz'], a.sfx, (v) => (a.sfx = v as TapSound));
      pickList('#ab-spawn', ['crate', 'lantern', 'plant', 'blob', 'mob'], a.spawn, (v) => (a.spawn = v as AbilityDef['spawn']));

      const script = set<HTMLTextAreaElement>('#ab-script');
      if (script) {
        script.value = a.script;
        script.oninput = () => {
          a.script = script.value;
          host.touch();
        };
      }

      set<HTMLButtonElement>('#ab-del')!.onclick = () => {
        const n = deleteAbility(p, a.id);
        host.touch();
        current = abilityList(p)[0]?.id ?? '';
        render();
        if (n) alert(`Removed from ${n} actor${n === 1 ? '' : 's'} too.`);
      };
    };
    render();
  });
}
