/** Right-hand inspector: edit every property of the selected entity. */
import type { StudioEditor } from './editor.js';
import { HATS, HELD_ITEMS } from './cosmetics.js';
import { cmdMenuLabel, cmdSpec, cmdsFor, triggerLabel, triggersFor } from './cmds.js';
import { EFFECT_LABEL, abilityList, createAbility, grantTo } from './abilities.js';
import { ATTACK_SPECS, attackSpec } from './attacks.js';
import type { Scope } from './cmds.js';
import { ACTOR_EVENTS, danglingDialogueLinks, dialogueFromLines } from './model.js';
import type { EntityDef, EventAction, EventDef } from './model.js';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export interface InspectorHooks {
  /** Opens the ⚡ ability editor (owned by main.ts, which has the modal). */
  openAbilityEditor: (focusId?: string) => void;
}

export function wireInspector(editor: StudioEditor, hooks: InspectorHooks): void {
  const title = document.getElementById('insp-title')!;
  const body = document.getElementById('insp-body')!;

  /** More than one actor picked: the useful things are the ones that only
   *  make sense in bulk — tidy them up, copy them, delete them. Editing
   *  properties still belongs to the primary (last-clicked) actor. */
  const renderGroup = (): void => {
    const defs = editor.selection;
    title.textContent = `⬚ ${defs.length} actors selected`;
    body.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.style.cssText = 'font-size:12px;margin-bottom:8px';
    hint.textContent = 'Drag any of them to move the whole group. Arrow keys nudge; hold Shift for a whole tile.';
    body.appendChild(hint);

    const bar = (label: string, buttons: [string, string, () => void][]): void => {
      const head = document.createElement('div');
      head.className = 'pal-head';
      head.textContent = label;
      body.appendChild(head);
      const row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = 'flex-wrap:wrap;gap:4px;margin-bottom:6px';
      for (const [text, tip, fn] of buttons) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = text;
        b.title = tip;
        b.onclick = fn;
        row.appendChild(b);
      }
      body.appendChild(row);
    };

    bar('Line them up', [
      ['⇤', 'Align left edges', () => editor.align('left')],
      ['⇥', 'Align right edges', () => editor.align('right')],
      ['⤒', 'Align tops', () => editor.align('top')],
      ['⤓', 'Align bottoms', () => editor.align('bottom')],
      ['↔', 'Centre horizontally', () => editor.align('centerX')],
      ['↕', 'Centre vertically', () => editor.align('centerY')],
      ['≡', 'Space them evenly', () => editor.distribute()],
    ]);
    bar('Do to all of them', [
      ['⧉ Duplicate', 'Copy them next to themselves (Ctrl+D)', () => editor.duplicate()],
      ['📋 Copy', 'Copy (Ctrl+C) — paste into any level', () => editor.copy()],
      ['🗑 Delete', 'Delete them all (Del)', () => editor.deleteSelected()],
    ]);

    const list = document.createElement('div');
    list.className = 'muted';
    list.style.cssText = 'font-size:12px;margin-top:6px;line-height:1.6';
    list.textContent = defs.map((d) => d.name).join(', ');
    body.appendChild(list);
  };

  const render = (): void => {
    if (!editor.playing && editor.selectedIds.length > 1) {
      renderGroup();
      return;
    }
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
      // ⚔ Attack pattern + how often. The hint under the menu says what the
      // player will actually see, because "spread" means nothing on its own.
      const atk = document.createElement('select');
      for (const a of ATTACK_SPECS) {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = `${a.emoji} ${a.label}`;
        if (def.attack === a.id) o.selected = true;
        atk.appendChild(o);
      }
      const atkHint = document.createElement('div');
      atkHint.className = 'muted';
      atkHint.style.cssText = 'font-size:12px;margin:-4px 0 8px';
      const showAtk = (): void => {
        const spec = attackSpec(def.attack);
        atkHint.textContent = spec.hint;
        // "Every N secs" is meaningless for an enemy that only bumps you.
        timeRow.style.display = spec.timed ? '' : 'none';
        if (spec.timed && def.shootEvery <= 0) {
          def.shootEvery = 2;
          timeInput.value = '2';
        }
      };
      atk.onchange = () => {
        def.attack = atk.value as EntityDef['attack'];
        showAtk();
        editor.touch();
      };
      field('⚔ Attack', atk);
      body.appendChild(atkHint);
      const timeInput = document.createElement('input');
      timeInput.type = 'number';
      timeInput.step = '0.1';
      timeInput.value = String(def.shootEvery);
      timeInput.oninput = () => {
        def.shootEvery = Number(timeInput.value) || 0;
        editor.touch();
      };
      const timeRow = document.createElement('div');
      timeRow.className = 'field';
      const timeLabel = document.createElement('label');
      timeLabel.textContent = 'Attack every (secs)';
      timeRow.append(timeLabel, timeInput);
      body.appendChild(timeRow);
      showAtk();
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

    // 🧊 The 3D slots. On EVERY actor, because the contract is the point:
    // a model if you have one, animations if it is a character, and sfx/vfx
    // hooks either way. Used by the 3D view; ignored by 2D ones.
    {
      const model = document.createElement('input');
      model.type = 'text';
      model.placeholder = 'models/thing.glb or @assetId';
      model.value = def.model3d;
      model.onchange = () => {
        def.model3d = model.value.trim();
        editor.touch();
      };
      field('🧊 Model (.glb)', model);

      const isCharacter = def.kind === 'blob' || def.kind === 'npc' || def.kind === 'mob' || def.kind === 'boss';
      if (isCharacter) {
        const idle = document.createElement('input');
        idle.type = 'text';
        idle.placeholder = 'clip name, e.g. idle';
        idle.value = def.animIdle;
        idle.onchange = () => {
          def.animIdle = idle.value.trim();
          editor.touch();
        };
        field('🎞 Anim: standing', idle);
        const move = document.createElement('input');
        move.type = 'text';
        move.placeholder = 'clip name, e.g. walk';
        move.value = def.animMove;
        move.onchange = () => {
          def.animMove = move.value.trim();
          editor.touch();
        };
        field('🎞 Anim: moving', move);
      }

      // One compact row per hookable moment: [sound ▾] [vfx ▾].
      const SOUNDS = ['', 'pop', 'blip', 'chime', 'buzz'] as const;
      const PRESETS = ['', 'confetti', 'poof', 'sparkle', 'ember', 'heal', 'hit', 'magic'];
      for (const on of ACTOR_EVENTS) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center';
        const sSel = document.createElement('select');
        for (const o of SOUNDS) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o === '' ? '🔊 (none)' : `🔊 ${o}`;
          if ((def.sfxSlot.find((x) => x.on === on)?.sound ?? '') === o) opt.selected = true;
          sSel.appendChild(opt);
        }
        sSel.onchange = () => {
          def.sfxSlot = def.sfxSlot.filter((x) => x.on !== on);
          if (sSel.value) def.sfxSlot.push({ on, sound: sSel.value as EntityDef['tapSound'] });
          editor.touch();
        };
        const vSel = document.createElement('select');
        for (const o of PRESETS) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o === '' ? '✨ (none)' : `✨ ${o}`;
          if ((def.vfxSlot.find((x) => x.on === on)?.preset ?? '') === o) opt.selected = true;
          vSel.appendChild(opt);
        }
        vSel.onchange = () => {
          def.vfxSlot = def.vfxSlot.filter((x) => x.on !== on);
          if (vSel.value) def.vfxSlot.push({ on, preset: vSel.value });
          editor.touch();
        };
        row.append(sSel, vSel);
        field(`on ${on}`, row);
      }
    }

    if (def.kind === 'npc') {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.marginTop = '6px';
      hint.textContent = '💬 Write this character’s lines in the Story tab below.';
      body.appendChild(hint);
    }

    renderDialogue(def);
    renderAbilities(def);
    renderEvents(def, 'entity');

    const del = document.createElement('button');
    del.className = 'btn';
    del.style.marginTop = '12px';
    del.textContent = '🗑 Delete';
    del.onclick = () => editor.removeEntity(def.id);
    body.appendChild(del);
  };

  /** 💬 Branching conversation: nodes, and the choices that link them. */
  const renderDialogue = (def: EntityDef): void => {
    if (def.kind !== 'npc' && def.kind !== 'blob') return;
    const head = document.createElement('div');
    head.className = 'muted';
    head.style.margin = '12px 0 4px';
    head.textContent = '💬 Conversation';
    body.appendChild(head);

    if (!def.dialogue) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.fontSize = '11px';
      hint.textContent = 'Uses the plain Story lines. Turn it into a branching conversation to add choices.';
      const make = document.createElement('button');
      make.className = 'btn';
      make.style.marginTop = '4px';
      make.textContent = '🌿 Make it branching';
      make.onclick = () => {
        // Start from whatever lines exist, so nothing is lost.
        def.dialogue = dialogueFromLines(def.lines);
        editor.editLabel = 'add conversation';
        editor.touch();
        render();
      };
      body.append(hint, make);
      return;
    }

    const d = def.dialogue;
    const touchAndRender = (): void => {
      editor.touch();
      render();
    };
    const ids = d.nodes.map((n) => n.id);
    const bad = danglingDialogueLinks(d);
    if (bad.length) {
      const warn = document.createElement('div');
      warn.className = 'muted';
      warn.style.cssText = 'font-size:11px;color:#ffd166';
      warn.textContent = `⚠ goes nowhere: ${bad.join(', ')}`;
      body.appendChild(warn);
    }

    /** A "where does this go" picker — every node, plus "end". */
    const target = (value: string, onPick: (v: string) => void): HTMLSelectElement => {
      const sel = document.createElement('select');
      sel.style.maxWidth = '110px';
      for (const v of ['', ...ids]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v === '' ? '— end —' : v;
        if (v === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        onPick(sel.value);
        editor.touch();
      };
      return sel;
    };

    d.nodes.forEach((node, ni) => {
      const box = document.createElement('div');
      box.style.cssText = 'border:1px solid #35304d;border-radius:8px;padding:6px;margin-bottom:6px';

      const top = document.createElement('div');
      top.className = 'row';
      const tag = document.createElement('span');
      tag.className = 'muted';
      tag.style.cssText = 'font-size:11px;width:34px';
      tag.textContent = node.id;
      const startMark = document.createElement('button');
      startMark.className = 'btn';
      startMark.style.cssText = 'padding:1px 5px;font-size:10px';
      startMark.textContent = d.start === node.id ? '▶ start' : 'start?';
      startMark.title = 'Begin the conversation here';
      startMark.onclick = () => {
        d.start = node.id;
        touchAndRender();
      };
      const kill = document.createElement('button');
      kill.className = 'btn';
      kill.textContent = '✕';
      kill.onclick = () => {
        d.nodes.splice(ni, 1);
        if (!d.nodes.length) delete def.dialogue;
        else if (!d.nodes.some((n) => n.id === d.start)) d.start = d.nodes[0]!.id;
        touchAndRender();
      };
      top.append(tag, startMark, kill);
      box.appendChild(top);

      const line = document.createElement('input');
      line.type = 'text';
      line.style.cssText = 'width:100%;margin-top:4px';
      line.value = node.text;
      line.placeholder = 'what they say';
      line.oninput = () => {
        node.text = line.value;
        editor.editLabel = 'edit actor';
        editor.touch();
      };
      box.appendChild(line);

      if (!node.choices?.length) {
        const row = document.createElement('div');
        row.className = 'row';
        row.style.marginTop = '4px';
        const l = document.createElement('label');
        l.className = 'muted';
        l.style.fontSize = '11px';
        l.textContent = 'then →';
        row.append(l, target(node.next ?? '', (v) => {
          if (v) node.next = v;
          else delete node.next;
        }));
        box.appendChild(row);
      }

      for (const [ci, choice] of (node.choices ?? []).entries()) {
        const row = document.createElement('div');
        row.className = 'row';
        row.style.cssText = 'margin-top:4px;flex-wrap:wrap;gap:4px';
        const t = document.createElement('input');
        t.type = 'text';
        t.style.flex = '1';
        t.value = choice.text;
        t.placeholder = 'the player says…';
        t.oninput = () => {
          choice.text = t.value;
          editor.editLabel = 'edit actor';
          editor.touch();
        };
        const gate = document.createElement('input');
        gate.type = 'text';
        gate.style.width = '86px';
        gate.placeholder = 'only if…';
        gate.title = 'Only offer this reply while that switch is ON';
        gate.value = choice.ifSwitch ?? '';
        gate.oninput = () => {
          if (gate.value.trim()) choice.ifSwitch = gate.value.trim();
          else delete choice.ifSwitch;
          editor.touch();
        };
        const x = document.createElement('button');
        x.className = 'btn';
        x.textContent = '✕';
        x.onclick = () => {
          node.choices!.splice(ci, 1);
          if (!node.choices!.length) delete node.choices;
          touchAndRender();
        };
        row.append('↳', t, target(choice.to, (v) => (choice.to = v)), gate, x);
        box.appendChild(row);
      }

      const addChoice = document.createElement('button');
      addChoice.className = 'btn';
      addChoice.style.cssText = 'margin-top:4px;font-size:11px';
      addChoice.textContent = '+ reply';
      addChoice.onclick = () => {
        node.choices ??= [];
        node.choices.push({ text: 'Sure.', to: '' });
        delete node.next;
        touchAndRender();
      };
      box.appendChild(addChoice);
      body.appendChild(box);
    });

    const addNode = document.createElement('button');
    addNode.className = 'btn';
    addNode.textContent = '+ Add line';
    addNode.onclick = () => {
      const used = new Set(d.nodes.map((n) => n.id));
      let i = d.nodes.length;
      while (used.has(`n${i}`)) i++;
      d.nodes.push({ id: `n${i}`, text: '…' });
      touchAndRender();
    };
    body.appendChild(addNode);
  };

  /** ⚡ Abilities this actor OWNS. On the player they become on-screen
   *  buttons; this is where a mobile game's controls really get authored. */
  const renderAbilities = (def: EntityDef): void => {
    if (!['blob', 'npc', 'mob', 'boss', 'image'].includes(def.kind)) return;
    const head = document.createElement('div');
    head.className = 'muted';
    head.style.margin = '12px 0 4px';
    head.textContent = '⚡ Abilities (buttons this actor gets)';
    body.appendChild(head);

    const all = abilityList(editor.project);
    if (!all.length) {
      const none = document.createElement('div');
      none.className = 'muted';
      none.style.fontSize = '11px';
      none.textContent = 'No abilities exist yet.';
      body.appendChild(none);
    }
    for (const a of all) {
      const row = document.createElement('label');
      row.className = 'muted';
      row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:2px';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = def.abilities.includes(a.id);
      cb.onchange = () => {
        grantTo(editor.project, def.name, a.id, cb.checked);
        editor.touch();
      };
      const edit = document.createElement('button');
      edit.className = 'btn';
      edit.style.cssText = 'padding:1px 6px;font-size:11px';
      edit.textContent = '✎';
      edit.title = `Edit "${a.name}"`;
      edit.onclick = (e) => {
        e.preventDefault();
        hooks.openAbilityEditor(a.id);
      };
      row.append(cb, `${a.name} — ${EFFECT_LABEL[a.effect]}`, edit);
      body.appendChild(row);
    }

    const make = document.createElement('button');
    make.className = 'btn';
    make.style.marginTop = '4px';
    make.textContent = '✚ Create an ability…';
    make.onclick = () => {
      const a = createAbility(editor.project, 'New ability');
      grantTo(editor.project, def.name, a.id, true);
      editor.touch();
      hooks.openAbilityEditor(a.id);
    };
    body.appendChild(make);

    // 🌳 Which skill tree this actor uses, if any.
    const trees = Object.keys(editor.project.db?.skills ?? {});
    if (trees.length) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginTop = '6px';
      const label = document.createElement('label');
      label.className = 'muted';
      label.textContent = '🌳 Skill tree';
      const sel = document.createElement('select');
      for (const t of ['', ...trees]) {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t || '(none)';
        if (t === def.skillTree) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => {
        def.skillTree = sel.value;
        editor.touch();
      };
      row.append(label, sel);
      body.appendChild(row);
    }
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
      gate.title =
        'Name a switch and this event only runs while that switch is ON. Turn switches on with the "Turn switch ON" action. Blank = always run.';
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
      vGate.placeholder = 'needs counter… (blank = always)';
      vGate.title =
        'Name a counter and this event only runs once it has reached the number beside it. Count up with the "Add to variable" action. Blank = always run.';
      vGate.style.flex = '1';
      vGate.value = ev.ifVar ?? '';
      vGate.oninput = () => {
        ev.ifVar = vGate.value.trim();
        editor.touch();
      };
      const vMin = document.createElement('input');
      vMin.type = 'number';
      vMin.title = 'at least this many';
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
          // Say what belongs in here — it is a message for one command and a
          // level name for the next, and the box itself cannot tell you.
          t.placeholder = spec.placeholder ?? '';
          t.title = spec.placeholder ?? '';
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
          vn.placeholder = spec.placeholder ?? 'counter name';
          vn.title = 'Any name you like. The same name means the same counter.';
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
