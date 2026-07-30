/** Right-hand inspector: edit every property of the selected entity. */
import type { StudioEditor } from './editor.js';
import type { EntityDef } from './model.js';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function wireInspector(editor: StudioEditor): void {
  const title = document.getElementById('insp-title')!;
  const body = document.getElementById('insp-body')!;

  const render = (): void => {
    const def = editor.selected;
    if (!def) {
      title.textContent = editor.playing ? 'Playing' : 'Nothing selected';
      body.innerHTML = editor.playing
        ? '<span class="muted">Press ⏹ Stop to go back to editing.</span>'
        : '<span class="muted">Drag something in from the palette, or click an entity on the canvas.</span>';
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
        | 'moveSpeed',
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

    const del = document.createElement('button');
    del.className = 'btn';
    del.style.marginTop = '12px';
    del.textContent = '🗑 Delete';
    del.onclick = () => editor.removeEntity(def.id);
    body.appendChild(del);
  };

  editor.onSelection = render;
  render();
}
