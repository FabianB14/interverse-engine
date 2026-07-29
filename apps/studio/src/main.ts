/** Interverse Studio — boot + DOM wiring (toolbar, palette, tabs, files). */
import { StudioEditor } from './editor.js';
import { wireInspector } from './inspector.js';
import { wireChat } from './chat.js';
import { PALETTE } from './palette.js';
import type { EntityKind } from './model.js';
import './debug.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function main(): Promise<void> {
  const editor = new StudioEditor();
  const center = $<HTMLElement>('center');
  await editor.boot(center);

  // ------------------------------------------------------------- toolbar
  const nameInput = $<HTMLInputElement>('project-name');
  const sceneSelect = $<HTMLSelectElement>('scene-select');
  const chkInterverse = $<HTMLInputElement>('chk-interverse');
  const playBtn = $<HTMLButtonElement>('btn-play');
  const banner = $('play-banner');

  const refreshToolbar = (): void => {
    nameInput.value = editor.project.name;
    chkInterverse.checked = editor.project.interverse;
    sceneSelect.innerHTML = '';
    for (const s of editor.project.scenes) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      if (s.id === editor.sceneId) o.selected = true;
      sceneSelect.appendChild(o);
    }
    playBtn.textContent = editor.playing ? '⏹ Stop' : '▶ Play';
    playBtn.className = editor.playing ? 'btn good' : 'btn primary';
    banner.style.display = editor.playing ? 'block' : 'none';
  };
  nameInput.oninput = () => {
    editor.project.name = nameInput.value;
    editor.touch();
  };
  chkInterverse.onchange = () => {
    editor.project.interverse = chkInterverse.checked;
    editor.touch();
  };
  sceneSelect.onchange = () => editor.switchScene(sceneSelect.value);
  $('btn-add-scene').onclick = () => {
    const name = prompt('Level name?', `Level ${editor.project.scenes.length + 1}`);
    if (name !== null) editor.addScene(name);
  };
  playBtn.onclick = () => (editor.playing ? editor.stop() : editor.play());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editor.playing) editor.stop();
  });

  // ------------------------------------------------------ import / export
  const fileImport = $<HTMLInputElement>('file-import');
  $('btn-export').onclick = () => {
    const blob = new Blob([editor.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${editor.project.name.replace(/\W+/g, '-').toLowerCase() || 'game'}.interverse.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('btn-import').onclick = () => fileImport.click();
  fileImport.onchange = () => {
    const f = fileImport.files?.[0];
    if (!f) return;
    void f.text().then((json) => {
      try {
        editor.importJson(json);
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    fileImport.value = '';
  };

  // ------------------------------------------------------------- palette
  const left = $('left');
  const fileImage = $<HTMLInputElement>('file-image');
  let pendingImageAt: { x: number; y: number } | null = null;
  const placeImage = (x: number, y: number): void => {
    pendingImageAt = { x, y };
    fileImage.click();
  };
  fileImage.onchange = () => {
    const f = fileImage.files?.[0];
    const at = pendingImageAt ?? { x: 360, y: 640 };
    pendingImageAt = null;
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const assetId = editor.addAsset(String(reader.result));
      const def = editor.addEntity('image', at.x, at.y);
      def.assetId = assetId;
      editor.updateEntity(def);
    };
    reader.readAsDataURL(f);
    fileImage.value = '';
  };

  for (const group of PALETTE) {
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = group.title;
    left.appendChild(head);
    for (const item of group.items) {
      const btn = document.createElement('div');
      btn.className = 'pal-item';
      btn.draggable = true;
      btn.innerHTML = `<span class="em">${item.emoji}</span>${item.label}`;
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/interverse-kind', item.kind);
      });
      // Click also places (center of the design space) — friendlier on touch.
      btn.addEventListener('click', () => {
        if (item.kind === 'image') placeImage(360, 640);
        else editor.addEntity(item.kind, 360, 640);
      });
      left.appendChild(btn);
    }
  }

  // Drop onto the canvas.
  center.addEventListener('dragover', (e) => {
    e.preventDefault();
    center.classList.add('dropping');
  });
  center.addEventListener('dragleave', () => center.classList.remove('dropping'));
  center.addEventListener('drop', (e) => {
    e.preventDefault();
    center.classList.remove('dropping');
    const kind = e.dataTransfer?.getData('text/interverse-kind') as EntityKind | '';
    if (!kind || editor.playing) return;
    const p = editor.toDesign(e.clientX, e.clientY);
    if (kind === 'image') placeImage(p.x, p.y);
    else editor.addEntity(kind, p.x, p.y);
  });

  // ---------------------------------------------------------------- tabs
  const tabs = document.querySelectorAll<HTMLButtonElement>('#tabs button');
  tabs.forEach((b) =>
    b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('active', x === b));
      document
        .querySelectorAll<HTMLElement>('.tabpane')
        .forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
    }),
  );

  // ------------------------------------------------------------ code tab
  const codeText = $<HTMLTextAreaElement>('code-text');
  const refreshCode = (): void => {
    codeText.value = editor.scene.script;
    codeText.placeholder = `// This code runs when "${editor.scene.name}" starts in Play mode.\n// Try:\n// api.entity('Hero').x = 100\n// api.onUpdate((dt) => { api.entity('Hero').rotation += dt })\n// api.sfx.chime()`;
  };
  codeText.oninput = () => {
    editor.scene.script = codeText.value;
    editor.touch();
  };
  $('btn-apply-code').onclick = () => {
    editor.scene.script = codeText.value;
    editor.touch();
    if (editor.playing) editor.runScriptNow(codeText.value);
    else editor.play();
  };
  editor.onScriptError = (err) =>
    alert(`Script error: ${err instanceof Error ? err.message : String(err)}`);

  // ----------------------------------------------------------- story tab
  const storyText = $<HTMLTextAreaElement>('story-text');
  const storyHint = $('story-hint');
  const refreshStory = (): void => {
    const def = editor.selected;
    if (def && (def.kind === 'npc' || def.kind === 'blob')) {
      storyText.value = def.lines.join('\n');
      storyText.disabled = false;
      storyHint.textContent = `Story for "${def.name}" — one line per row, said in order when tapped in Play mode.`;
    } else {
      storyText.value = '';
      storyText.disabled = true;
      storyHint.textContent = 'Select a character on the canvas first.';
    }
  };
  $('btn-apply-story').onclick = () => {
    const def = editor.selected;
    if (!def) return;
    def.lines = storyText.value.split('\n').filter((l) => l.trim().length > 0);
    if (def.kind === 'blob' && def.lines.length) def.kind = 'npc';
    editor.updateEntity(def);
  };

  // ------------------------------------------------------------ wire-ups
  wireInspector(editor);
  wireChat(editor);
  const prevSelection = editor.onSelection;
  editor.onSelection = () => {
    prevSelection();
    refreshStory();
  };
  editor.onChanged = () => {
    refreshToolbar();
    refreshCode();
  };
  editor.onPlayState = () => {
    refreshToolbar();
    editor.onSelection();
  };
  refreshToolbar();
  refreshCode();
  refreshStory();

  // ------------------------------------------------------------ debug API
  window.__studio = {
    ready: () => true,
    addEntity: (kind, x, y) => editor.addEntity(kind, x, y).name,
    entityCount: () => editor.scene.entities.length,
    select: (name) => {
      const def = editor.entityByName(name);
      if (def) editor.select(def.id);
      return !!def;
    },
    setProp: (key, value) => {
      const def = editor.selected;
      if (!def) return false;
      (def as unknown as Record<string, unknown>)[key] = value;
      editor.updateEntity(def);
      return true;
    },
    getEntity: (name) => {
      const def = editor.entityByName(name);
      return def ? ({ ...def } as unknown as Record<string, unknown>) : null;
    },
    play: () => editor.play(),
    stop: () => editor.stop(),
    playing: () => editor.playing,
    playEntityCount: () => editor.playEntityCount(),
    setScript: (code) => {
      editor.scene.script = code;
      editor.touch();
    },
    applyScriptNow: (code) => editor.runScriptNow(code),
    addScene: (name) => editor.addScene(name).name,
    sceneCount: () => editor.project.scenes.length,
    switchSceneByName: (name) => {
      const s = editor.project.scenes.find((x) => x.name === name);
      if (s) editor.switchScene(s.id);
      return !!s;
    },
    sceneName: () => editor.scene.name,
    exportJson: () => editor.exportJson(),
    importJson: (json) => editor.importJson(json),
    projectName: () => editor.project.name,
    setStory: (lines) => {
      const def = editor.selected;
      if (!def) return false;
      def.lines = lines;
      if (def.kind === 'blob' && lines.length) def.kind = 'npc';
      editor.updateEntity(def);
      return true;
    },
  };
}

void main();
