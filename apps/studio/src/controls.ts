/**
 * 🎮 Controls — the key + on-screen button editor.
 *
 * Before this existed the only way to bind anything was to type
 * `key: 'q'` inside an object literal in the Code window, and movement
 * could not be rebound at all. Every control now has a NAME, and keys and
 * the on-screen button are two bindings of that one name — the Unity /
 * Godot input-map idea at kid scale, which is also what makes a phone
 * player and a keyboard player able to share a game.
 */
import { BUILTIN_ACTIONS, defaultControls, normalizeControls } from './model.js';
import type { ActionDef, ControlsDef } from './model.js';

/** How a key reads on a keycap. */
export function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  const arrows: Record<string, string> = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' };
  return arrows[k] ?? (k.length === 1 ? k.toUpperCase() : k[0]!.toUpperCase() + k.slice(1));
}

/** Every key bound to more than one action, with the actions that claim it.
 *  Duplicates are legal (Godot allows them) — we warn rather than steal. */
export function keyConflicts(c: ControlsDef): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const a of c.actions) {
    for (const k of a.keys) owners.set(k, [...(owners.get(k) ?? []), a.id]);
  }
  for (const [k, ids] of owners) if (ids.length < 2) owners.delete(k);
  return owners;
}

export interface ControlsUi {
  open: () => void;
  /** Headless hooks. */
  bind: (actionId: string, key: string) => boolean;
  unbind: (actionId: string, key: string) => boolean;
  keysOf: (actionId: string) => string[];
  addAction: (id: string) => boolean;
  removeAction: (id: string) => boolean;
  setButton: (actionId: string, on: boolean) => boolean;
  conflicts: () => string[];
  reset: () => void;
}

export function wireControls(
  /** A GETTER, not the object: loading a template or importing a file
   *  replaces editor.project wholesale, and a captured reference would
   *  quietly write bindings into the discarded one. */
  getProject: () => { controls?: ControlsDef },
  touch: () => void,
  openModal: (build: (root: HTMLElement) => void) => void,
): ControlsUi {
  const table = (): ControlsDef => (getProject().controls ??= defaultControls());
  const find = (id: string): ActionDef | undefined => table().actions.find((a) => a.id === id);

  const bind = (actionId: string, key: string): boolean => {
    const a = find(actionId);
    const k = key.toLowerCase();
    if (!a || !k || a.keys.includes(k)) return false;
    a.keys.push(k);
    touch();
    return true;
  };
  const unbind = (actionId: string, key: string): boolean => {
    const a = find(actionId);
    const i = a?.keys.indexOf(key.toLowerCase()) ?? -1;
    if (!a || i < 0) return false;
    a.keys.splice(i, 1);
    touch();
    return true;
  };
  const addAction = (id: string): boolean => {
    const clean = id.trim();
    if (!clean || find(clean)) return false;
    table().actions.push({ id: clean, label: clean, keys: [], button: true, icon: 'star', builtin: false });
    touch();
    return true;
  };
  const removeAction = (id: string): boolean => {
    const t = table();
    const i = t.actions.findIndex((a) => a.id === id);
    // Builtins stay: a game with no "move left" is broken, not customized.
    if (i < 0 || t.actions[i]!.builtin) return false;
    t.actions.splice(i, 1);
    touch();
    return true;
  };
  const setButton = (actionId: string, on: boolean): boolean => {
    const a = find(actionId);
    if (!a) return false;
    a.button = on;
    touch();
    return true;
  };

  const render = (root: HTMLElement): void => {
    const project = getProject();
    const t = normalizeControls(project.controls);
    project.controls = t;
    root.innerHTML = `<h2>🎮 Controls</h2>
      <p class="muted">Every control has a name. Bind it to a key, an on-screen button, or both —
      phone players tap the buttons, keyboard players use the keys.</p>
      <div class="row" style="margin-bottom:10px">
        <label class="muted">Touch steering:</label>
        <label class="muted"><input type="radio" name="tsteer" value="joystick" /> 🕹 Joystick</label>
        <label class="muted"><input type="radio" name="tsteer" value="dpad" /> ✜ D-pad buttons</label>
      </div>
      <div id="ctl-rows"></div>
      <div class="row" style="margin-top:10px">
        <input id="ctl-new" type="text" placeholder="new control name (e.g. Dash)" style="flex:1" />
        <button class="btn" id="ctl-add">+ Add an action</button>
        <button class="btn" id="ctl-reset">↺ Reset to defaults</button>
      </div>`;

    for (const r of root.querySelectorAll<HTMLInputElement>('input[name="tsteer"]')) {
      r.checked = r.value === t.touch;
      r.onchange = () => {
        t.touch = r.value === 'dpad' ? 'dpad' : 'joystick';
        touch();
      };
    }

    const rows = root.querySelector<HTMLElement>('#ctl-rows')!;
    const conflicts = keyConflicts(t);
    for (const a of t.actions) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = 'align-items:center;margin-bottom:6px;flex-wrap:wrap';

      const name = document.createElement('div');
      name.style.cssText = 'width:150px;font-size:13px';
      name.textContent = a.label;
      row.appendChild(name);

      // Keycaps: click one to replace it, ✕ to clear, + to add another.
      for (const k of a.keys) {
        const cap = document.createElement('button');
        cap.className = 'btn';
        cap.dataset.key = k;
        cap.textContent = keyLabel(k);
        cap.title = conflicts.has(k) ? `Also used by ${conflicts.get(k)!.filter((x) => x !== a.id).join(', ')}` : 'Click to rebind, or press Backspace to clear';
        if (conflicts.has(k)) cap.style.borderColor = '#c9a227';
        cap.onclick = () => capture(cap, a, k);
        row.appendChild(cap);
      }
      const add = document.createElement('button');
      add.className = 'btn';
      add.textContent = '+ key';
      add.onclick = () => capture(add, a, null);
      row.appendChild(add);

      // Movement steers with the joystick, so a button would be noise.
      const isSteer = a.id.startsWith('move-');
      const btnL = document.createElement('label');
      btnL.className = 'muted';
      btnL.style.marginLeft = '8px';
      if (isSteer) {
        btnL.textContent = '— steered by the joystick';
      } else {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = a.button;
        cb.onchange = () => {
          a.button = cb.checked;
          touch();
        };
        btnL.append(cb, ' on-screen button');
      }
      row.appendChild(btnL);

      if (!a.builtin) {
        const kill = document.createElement('button');
        kill.className = 'btn';
        kill.textContent = '✕';
        kill.title = 'Delete this control';
        kill.onclick = () => {
          removeAction(a.id);
          render(root);
        };
        row.appendChild(kill);
      }
      rows.appendChild(row);

      if (a.keys.some((k) => conflicts.has(k))) {
        const warn = document.createElement('div');
        warn.className = 'muted';
        warn.style.cssText = 'width:100%;font-size:11px;color:#ffd166;margin:-2px 0 4px 150px';
        const shared = a.keys.filter((k) => conflicts.has(k)).map(keyLabel).join(', ');
        warn.textContent = `⚠ ${shared} is also used by another control — that is allowed, but both will fire.`;
        rows.appendChild(warn);
      }
    }

    /** Press-a-key-to-bind, Unity's interactive rebind at kid scale. */
    const capture = (chip: HTMLButtonElement, a: ActionDef, replacing: string | null): void => {
      const was = chip.textContent;
      chip.textContent = 'press a key…';
      chip.classList.add('primary');
      const onKey = (e: KeyboardEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        if (e.key === 'Escape') {
          chip.textContent = was;
          chip.classList.remove('primary');
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (replacing) unbind(a.id, replacing);
        } else {
          if (replacing) unbind(a.id, replacing);
          bind(a.id, e.key);
        }
        render(root);
      };
      window.addEventListener('keydown', onKey, true);
    };

    root.querySelector<HTMLButtonElement>('#ctl-add')!.onclick = () => {
      const input = root.querySelector<HTMLInputElement>('#ctl-new')!;
      if (addAction(input.value)) render(root);
    };
    root.querySelector<HTMLButtonElement>('#ctl-reset')!.onclick = () => {
      getProject().controls = defaultControls();
      touch();
      render(root);
    };
  };

  return {
    open: () => openModal(render),
    bind,
    unbind,
    keysOf: (id) => [...(find(id)?.keys ?? [])],
    addAction,
    removeAction,
    setButton,
    conflicts: () => [...keyConflicts(table()).keys()],
    reset: () => {
      getProject().controls = defaultControls();
      touch();
    },
  };
}

/** Ids that always exist, exported for the inspector's "acts as" dropdown. */
export const BUILTIN_IDS: readonly string[] = BUILTIN_ACTIONS;
