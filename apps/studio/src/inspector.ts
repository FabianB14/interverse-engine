/** Right-hand inspector: edit every property of the selected entity. */
import type { StudioEditor } from './editor.js';
import { HATS, HELD_ITEMS } from './cosmetics.js';
import { cmdMenuLabel, cmdSpec, cmdsFor, triggerLabel, triggersFor } from './cmds.js';
import type { Scope } from './cmds.js';
import type { EntityDef, EventAction, EventDef } from './model.js';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function wireInspector(editor: StudioEditor): void {
  const title = document.getElementById('insp-title')!;
  const body = document.getElementById('insp-body')!;

  const render = (): void => {
    const def = editor.selected;
    if (!def) {
      // Nothing selected is not nothing to edit — this is the LEVEL, and
      // its own ⚡ events live here (start the music, run a timer, win when
      // every enemy is down). Before, this panel was a dead end.
      if (editor.playing) {
        title.textContent = 'Playing';
        body.innerHTML = '<span class="muted">Press ⏹ Stop to go back to editing.</span>';
        return;
      }
      const scene = editor.scene;
      title.textContent = `level — ${scene.name}`;
      body.innerHTML = '';
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.fontSize = '12px';
      hint.textContent =
        'Click an actor to edit it. These events belong to the level itself and run with no actor involved.';
      body.appendChild(hint);
      scene.events ??= [];
      renderEvents(scene as { events: EventDef[] }, 'level');
      return;
    }
    title.textContent = `${def.kind} — ${def.name}`;
    body.innerHTML = '';

    const field = (label: string, input: HTMLElement): void => {
      const row = document.createElement('div');
      row.className = 'field';
      const l = document.createElement('label');
      l.textContent = label;
      row.append(l, input);
      body.appendChild(row);
    };
    const num = (
      label: string,
      key:
        | 'x'
        | 'y'
        | 'scale'
        | 'rotation'
        | 'radius'
        | 'fontSize'
        | 'seed'
        | 'frameW'
        | 'frameH'
        | 'fps'
        | 'hp'
        | 'damage'
        | 'xp'
        | 'moveSpeed'
        | 'shootEvery',
      step = 1,
    ): void => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = String(step);
      i.value = String(def[key]);
      i.oninput = () => {
        def[key] = Number(i.value) || 0;
        editor.updateEntity(def);
      };
      field(label, i);
    };
    const text = (label: string, key: 'name' | 'text'): void => {
      const i = document.createElement('input');
      i.type = 'text';
      i.value = def[key];
      i.oninput = () => {
        def[key] = i.value;
        editor.updateEntity(def);
        title.textContent = `${def.kind} — ${def.name}`;
      };
      field(label, i);
    };
    const check = (label: string, key: 'wobble' | 'popIn'): void => {
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = def[key];
      i.onchange = () => {
        def[key] = i.checked;
        editor.updateEntity(def);
      };
      field(label, i);
    };

    text('Name', 'name');
    num('X', 'x');
    num('Y', 'y');
    num('Scale', 'scale', 0.05);
    num('Rotation', 'rotation', 0.05);

    const color = document.createElement('input');
    color.type = 'color';
    color.value = hex(def.color);
    color.oninput = () => {
      def.color = parseInt(color.value.slice(1), 16);
      editor.updateEntity(def);
    };
    field('Color', color);

    if (def.kind === 'blob' || def.kind === 'npc') {
      num('Radius', 'radius');
      num('Look (seed)', 'seed');
    }
    if (def.kind === 'mob' || def.kind === 'boss') {
      num('Radius', 'radius');
      num('Look (seed)', 'seed');
      num('Health (HP)', 'hp');
      num('Contact damage', 'damage');
      num('XP reward', 'xp');
      num('Move speed', 'moveSpeed');
      num('Shoot every (secs, 0=never)', 'shootEvery', 0.1);
      const beh = document.createElement('select');
      for (const opt of ['chase', 'patrol', 'wander', 'guard'] as const) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent =
          opt === 'chase'
            ? '🏃 Chase the player'
            : opt === 'patrol'
              ? '↔ Patrol left-right'
              : opt === 'wander'
                ? '🎲 Wander around'
                : '🛡 Guard its spot';
        if (def.behavior === opt) o.selected = true;
        beh.appendChild(o);
      }
      beh.onchange = () => {
        def.behavior = beh.value as EntityDef['behavior'];
        editor.touch();
      };
      field('Behavior (AI)', beh);
    }
    if (['blob', 'npc', 'mob', 'boss'].includes(def.kind)) {
      const mkSel = (label: string, list: readonly string[], key: 'hat' | 'held'): void => {
        const sel = document.createElement('select');
        for (const v of list) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = v === '' ? '(none)' : v;
          if (def[key] === v) o.selected = true;
          sel.appendChild(o);
        }
        sel.onchange = () => {
          def[key] = sel.value;
          editor.updateEntity(def);
        };
        field(label, sel);
      };
      mkSel('🎩 Hat', HATS, 'hat');
      mkSel('🗡 Held item', HELD_ITEMS, 'held');
    }
    if (def.kind === 'crate') num('Size', 'radius');
    if (def.kind === 'text' || def.kind === 'button') {
      text('Text', 'text');
      num('Font size', 'fontSize');
    }
    if (def.kind === 'image') {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.margin = '2px 0 8px';
      hint.textContent =
        '🎞 Spritesheet animation: set the frame size (px) and speed. Frames read left-to-right, top-to-bottom. 0 = still image.';
      body.appendChild(hint);
      num('Frame width', 'frameW');
      num('Frame height', 'frameH');
      num('Frames / sec', 'fps');
      // Named clips: idle/walk/attack ranges inside the same sheet.
      const clipHead = document.createElement('div');
      clipHead.className = 'muted';
      clipHead.style.margin = '8px 0 4px';
      clipHead.textContent = '🎬 Clips (frame ranges) — play with api.playClip';
      body.appendChild(clipHead);
      def.clips.forEach((clip, ci) => {
        const row = document.createElement('div');
        row.className = 'row';
        const nm = document.createElement('input');
        nm.type = 'text';
        nm.style.width = '76px';
        nm.value = clip.name;
        nm.oninput = () => {
          clip.name = nm.value;
          editor.touch();
        };
        const mkN = (val: number, cb: (n: number) => void, w = 48): HTMLInputElement => {
          const i = document.createElement('input');
          i.type = 'number';
          i.style.width = `${w}px`;
          i.value = String(val);
          i.oninput = () => {
            cb(Number(i.value) || 0);
            editor.touch();
          };
          return i;
        };
        const kill = document.createElement('button');
        kill.className = 'btn';
        kill.textContent = '✕';
        kill.onclick = () => {
          def.clips.splice(ci, 1);
          editor.updateEntity(def);
          render();
        };
        row.append(nm, mkN(clip.from, (n) => (clip.from = n)), mkN(clip.to, (n) => (clip.to = n)), mkN(clip.fps, (n) => (clip.fps = n)), kill);
        body.appendChild(row);
      });
      const addClip = document.createElement('button');
      addClip.className = 'btn';
      addClip.textContent = '+ clip (name · from · to · fps)';
      addClip.onclick = () => {
        def.clips.push({ name: `clip${def.clips.length + 1}`, from: 0, to: 3, fps: 8 });
        editor.touch();
        render();
      };
      body.appendChild(addClip);
    }

    check('Wobble (idle animation)', 'wobble');
    check('Pop-in (spawn vfx)', 'popIn');

    const snd = document.createElement('select');
    for (const opt of ['', 'pop', 'blip', 'chime', 'buzz']) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt === '' ? '(none)' : opt;
      if (def.tapSound === opt) o.selected = true;
      snd.appendChild(o);
    }
    snd.onchange = () => {
      def.tapSound = snd.value as EntityDef['tapSound'];
      editor.touch();
    };
    field('Tap sound (sfx)', snd);

    if (def.kind === 'npc') {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.marginTop = '6px';
      hint.textContent = '💬 Write this character’s lines in the Story tab below.';
      body.appendChild(hint);
    }

    renderEvents(def, 'entity');

    const del = document.createElement('button');
    del.className = 'btn';
    del.style.marginTop = '12px';
    del.textContent = '🗑 Delete';
    del.onclick = () => editor.removeEntity(def.id);
    body.appendChild(del);
  };

  /** ⚡ No-code events: trigger + stacked actions, all dropdowns. The same
   *  editor serves an actor and a whole level — only the legal triggers and
   *  commands differ, which is what `scope` selects. */
  const renderEvents = (owner: { events: EventDef[] }, scope: Scope): void => {
    const head = document.createElement('div');
    head.className = 'muted';
    head.style.margin = '12px 0 4px';
    head.textContent = scope === 'level' ? '⚡ Level events (no code needed)' : '⚡ Events (no code needed)';
    body.appendChild(head);

    const touchAndRender = (): void => {
      editor.touch();
      render();
    };

    owner.events.forEach((ev, ei) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #35304d;border-radius:8px;padding:6px;margin-bottom:6px';

      const row = document.createElement('div');
      row.className = 'row';
      const trig = document.createElement('select');
      for (const t of triggersFor(scope)) {
        const o = document.createElement('option');
        o.value = t.trigger;
        o.textContent = triggerLabel(t.trigger, scope);
        if (ev.trigger === t.trigger) o.selected = true;
        trig.appendChild(o);
      }
      trig.onchange = () => {
        ev.trigger = trig.value as EventDef['trigger'];
        touchAndRender();
      };
      row.appendChild(trig);
      if (ev.trigger === 'every') {
        const secs = document.createElement('input');
        secs.type = 'number';
        secs.step = '0.5';
        secs.style.width = '64px';
        secs.value = String(ev.every ?? 2);
        secs.oninput = () => {
          ev.every = Number(secs.value) || 2;
          editor.touch();
        };
        row.appendChild(secs);
      }
      const kill = document.createElement('button');
      kill.className = 'btn';
      kill.textContent = '✕';
      kill.title = 'Delete this event';
      kill.onclick = () => {
        owner.events.splice(ei, 1);
        touchAndRender();
      };
      row.appendChild(kill);
      box.appendChild(row);

      // optional gates: "only if switch" + "once"
      const gates = document.createElement('div');
      gates.className = 'row';
      gates.style.marginTop = '4px';
      const gate = document.createElement('input');
      gate.type = 'text';
      gate.placeholder = 'only if switch… (blank = always)';
      gate.style.flex = '1';
      gate.value = ev.ifSwitch ?? '';
      gate.oninput = () => {
        ev.ifSwitch = gate.value.trim();
        editor.touch();
      };
      const onceL = document.createElement('label');
      onceL.className = 'muted';
      const once = document.createElement('input');
      once.type = 'checkbox';
      once.checked = !!ev.once;
      once.onchange = () => {
        ev.once = once.checked;
        editor.touch();
      };
      onceL.append(once, ' once');
      gates.append(gate, onceL);
      box.appendChild(gates);
      const vgates = document.createElement('div');
      vgates.className = 'row';
      vgates.style.marginTop = '4px';
      const vGate = document.createElement('input');
      vGate.type = 'text';
      vGate.placeholder = 'needs variable… (blank = always)';
      vGate.style.flex = '1';
      vGate.value = ev.ifVar ?? '';
      vGate.oninput = () => {
        ev.ifVar = vGate.value.trim();
        editor.touch();
      };
      const vMin = document.createElement('input');
      vMin.type = 'number';
      vMin.title = 'at least';
      vMin.style.width = '56px';
      vMin.value = String(ev.ifVarAtLeast ?? 1);
      vMin.oninput = () => {
        ev.ifVarAtLeast = Number(vMin.value) || 1;
        editor.touch();
      };
      vgates.append(vGate, vMin);
      box.appendChild(vgates);

      ev.actions.forEach((a, ai) => {
        const arow = document.createElement('div');
        arow.className = 'row';
        arow.style.marginTop = '4px';
        const sel = document.createElement('select');
        for (const c of cmdsFor(scope)) {
          const o = document.createElement('option');
          o.value = c.cmd;
          o.textContent = cmdMenuLabel(c);
          if (a.cmd === c.cmd) o.selected = true;
          sel.appendChild(o);
        }
        sel.onchange = () => {
          a.cmd = sel.value as EventAction['cmd'];
          touchAndRender();
        };
        arow.appendChild(sel);
        const spec = cmdSpec(a.cmd);
        if (spec.params === 'text') {
          const t = document.createElement('input');
          t.type = 'text';
          t.style.flex = '1';
          t.value = a.text ?? '';
          t.oninput = () => {
            a.text = t.value;
            editor.touch();
          };
          arow.appendChild(t);
        } else if (spec.params === 'n') {
          const n = document.createElement('input');
          n.type = 'number';
          n.style.width = '64px';
          n.value = String(a.n ?? 1);
          n.oninput = () => {
            a.n = Number(n.value) || 0;
            editor.touch();
          };
          arow.appendChild(n);
        } else if (spec.params === 'varn') {
          const vn = document.createElement('input');
          vn.type = 'text';
          vn.placeholder = 'variable';
          vn.style.width = '90px';
          vn.value = a.text ?? '';
          vn.oninput = () => {
            a.text = vn.value.trim();
            editor.touch();
          };
          const amt = document.createElement('input');
          amt.type = 'number';
          amt.style.width = '56px';
          amt.value = String(a.n ?? 1);
          amt.oninput = () => {
            a.n = Number(amt.value) || 0;
            editor.touch();
          };
          arow.append(vn, amt);
        } else if (spec.params === 'item') {
          const it = document.createElement('select');
          const items = editor.project.db?.items ?? [];
          if (!items.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = '(add items in 🗄 Database)';
            it.appendChild(o);
          }
          for (const item of items) {
            const o = document.createElement('option');
            o.value = item.id;
            o.textContent = `${item.emoji} ${item.name}`;
            if ((a.text ?? '') === item.id) o.selected = true;
            it.appendChild(o);
          }
          it.onchange = () => {
            a.text = it.value;
            editor.touch();
          };
          arow.appendChild(it);
        } else if (spec.params === 'vfx') {
          const vf = document.createElement('select');
          for (const v of ['confetti', 'sparkle', 'poof', 'hearts', 'embers', 'coins']) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = v;
            if ((a.text ?? 'sparkle') === v) o.selected = true;
            vf.appendChild(o);
          }
          vf.onchange = () => {
            a.text = vf.value;
            editor.touch();
          };
          arow.appendChild(vf);
        } else if (spec.params === 'music') {
          const mus = document.createElement('select');
          for (const m of ['adventure', 'cozy', 'battle', 'spooky', 'fanfare', 'stop']) {
            const o = document.createElement('option');
            o.value = m;
            o.textContent = m;
            if ((a.text ?? 'adventure') === m) o.selected = true;
            mus.appendChild(o);
          }
          mus.onchange = () => {
            a.text = mus.value;
            editor.touch();
          };
          arow.appendChild(mus);
        } else if (spec.params === 'sound') {
          const snd = document.createElement('select');
          for (const s of ['pop', 'blip', 'chime', 'buzz']) {
            const o = document.createElement('option');
            o.value = s;
            o.textContent = s;
            if ((a.text ?? 'pop') === s) o.selected = true;
            snd.appendChild(o);
          }
          snd.onchange = () => {
            a.text = snd.value;
            editor.touch();
          };
          arow.appendChild(snd);
        } else if (spec.params === 'spawn') {
          const kind = document.createElement('select');
          for (const k of ['crate', 'lantern', 'plant', 'mob', 'boss', 'blob', 'npc']) {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = k;
            if ((a.text ?? 'crate') === k) o.selected = true;
            kind.appendChild(o);
          }
          kind.onchange = () => {
            a.text = kind.value;
            editor.touch();
          };
          arow.appendChild(kind);
        }
        const akill = document.createElement('button');
        akill.className = 'btn';
        akill.textContent = '✕';
        akill.title = 'Delete this action';
        akill.onclick = () => {
          ev.actions.splice(ai, 1);
          touchAndRender();
        };
        arow.appendChild(akill);
        box.appendChild(arow);
      });

      const addAction = document.createElement('button');
      addAction.className = 'btn';
      addAction.style.marginTop = '4px';
      addAction.textContent = '+ action';
      addAction.onclick = () => {
        ev.actions.push({ cmd: 'say', text: 'Hello!' });
        touchAndRender();
      };
      box.appendChild(addAction);
      body.appendChild(box);
    });

    const addEvent = document.createElement('button');
    addEvent.className = 'btn';
    addEvent.textContent = '+ Add event';
    addEvent.onclick = () => {
      owner.events.push(
        scope === 'level'
          ? { trigger: 'start', actions: [{ cmd: 'music', text: 'adventure' }] }
          : { trigger: 'tap', actions: [{ cmd: 'sfx', text: 'pop' }] },
      );
      touchAndRender();
    };
    body.appendChild(addEvent);
  };

  editor.onSelection = render;
  render();
}
