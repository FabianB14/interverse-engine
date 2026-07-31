/** Interverse Studio — boot + DOM wiring (toolbar, palette, tabs, files). */
import { StudioEditor } from './editor.js';
import { wireInspector } from './inspector.js';
import { wireChat } from './chat.js';
import { wireFlow } from './flow.js';
import { wireCodePane } from './codepane.js';
import { wireControls } from './controls.js';
import { STARTER_SCRIPT } from './apidocs.js';
import { PALETTE } from './palette.js';
import { TEMPLATES } from './templates.js';
import { TILE_TYPES } from './tiles.js';
import { pushToGitHub, registerInWorld, slugify, store as pubStore } from './publish.js';
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
  const viewSelect = $<HTMLSelectElement>('view-select');
  const sizeSelect = $<HTMLSelectElement>('size-select');
  const chkGravity = $<HTMLInputElement>('chk-gravity');
  const chkInterverse = $<HTMLInputElement>('chk-interverse');
  const chkMultiplayer = $<HTMLInputElement>('chk-multiplayer');
  const playBtn = $<HTMLButtonElement>('btn-play');
  const banner = $('play-banner');

  const refreshToolbar = (): void => {
    nameInput.value = editor.project.name;
    chkInterverse.checked = editor.project.interverse;
    chkMultiplayer.checked = !!editor.project.multiplayer;
    sceneSelect.innerHTML = '';
    for (const s of editor.project.scenes) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      if (s.id === editor.sceneId) o.selected = true;
      sceneSelect.appendChild(o);
    }
    viewSelect.value = editor.scene.view ?? 'top';
    sizeSelect.value = String(editor.scene.worldW);
    if (![...sizeSelect.options].some((o) => o.value === sizeSelect.value)) sizeSelect.value = '720';
    chkGravity.checked = !!editor.scene.gravity;
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
  chkMultiplayer.onchange = () => {
    editor.project.multiplayer = chkMultiplayer.checked;
    editor.touch();
  };
  sceneSelect.onchange = () => editor.switchScene(sceneSelect.value);
  viewSelect.onchange = () => {
    const v = viewSelect.value as 'top' | 'depth';
    editor.scene.view = v;
    // 2.5D boards are one landscape screen tall; top-down boards a phone tall.
    if (v === 'depth' && editor.scene.worldH !== 720) {
      editor.setWorldSize(editor.scene.worldW, 720);
    } else if (v === 'top' && editor.scene.worldH === 720) {
      editor.setWorldSize(editor.scene.worldW, 1280);
    } else if (!editor.playing) {
      // Re-open so the change is visible immediately (depth previews live).
      editor.openEditScene();
    }
    editor.touch();
  };
  sizeSelect.onchange = () => {
    // Length is the choice; height comes from the view (2.5D = 720 tall).
    const w = Number(sizeSelect.value) || 720;
    editor.setWorldSize(w, editor.scene.view === 'depth' ? 720 : 1280);
  };
  chkGravity.onchange = () => {
    editor.scene.gravity = chkGravity.checked;
    editor.touch();
  };
  $('btn-add-scene').onclick = () => {
    const name = prompt('Level name?', `Level ${editor.project.scenes.length + 1}`);
    if (name !== null) editor.addScene(name);
  };
  // Screen-fit preview: cycles off -> rotated (landscape) -> portrait.
  const frameBtn = $<HTMLButtonElement>('btn-frame');
  const frameCycle = { off: 'landscape', landscape: 'portrait', portrait: 'off' } as const;
  const frameLabels = { off: '📱 Fit', landscape: '📱 Fit ↔', portrait: '📱 Fit ↕' };
  frameBtn.onclick = () => {
    editor.setFramePreview(frameCycle[editor.framePreview]);
    frameBtn.textContent = frameLabels[editor.framePreview];
  };
  playBtn.onclick = () => (editor.playing ? editor.stop() : editor.play());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editor.playing) editor.stop();
  });

  // ---------------------------------------------------------------- modal
  const modalBack = $('modal-back');
  const modal = $('modal');
  const closeModal = (): void => modalBack.classList.remove('open');
  modalBack.addEventListener('click', (e) => {
    if (e.target === modalBack) closeModal();
  });
  const openModal = (build: (root: HTMLElement) => void): void => {
    modal.innerHTML = '';
    build(modal);
    modalBack.classList.add('open');
  };

  // -------------------------------------------------- multiplayer lobby
  editor.onNeedLobby = () =>
    openModal((root) => {
      root.innerHTML = `<h2>🎮 Multiplayer — "${editor.project.name}"</h2>
        <p class="muted">Host a room and share the 4-letter code, join a friend's, or play alone.</p>
        <div class="row" style="margin-bottom:12px">
          <button class="btn primary" id="mp-host">🏠 HOST A ROOM</button>
          <input id="mp-code" type="text" maxlength="4" placeholder="CODE" style="width:90px;text-transform:uppercase" />
          <button class="btn" id="mp-join">JOIN</button>
          <button class="btn" id="mp-solo">Play solo</button>
        </div>
        <div class="out" id="mp-out" style="display:none"></div>`;
      const out = root.querySelector<HTMLElement>('#mp-out')!;
      const show = (msg: string): void => {
        out.style.display = 'block';
        out.textContent = msg;
      };
      root.querySelector<HTMLButtonElement>('#mp-host')!.onclick = () => {
        show('Opening a room…');
        editor
          .hostMultiplayer()
          .then((code) => {
            closeModal();
            alert(`Room open! Share this code: ${code}\n(Friends: Play → JOIN → ${code})`);
          })
          .catch((err) => show(`Could not host: ${err instanceof Error ? err.message : String(err)}`));
      };
      root.querySelector<HTMLButtonElement>('#mp-join')!.onclick = () => {
        const code = root.querySelector<HTMLInputElement>('#mp-code')!.value.trim();
        if (code.length !== 4) return show('Enter the 4-letter room code.');
        show('Joining…');
        editor
          .joinMultiplayer(code)
          .then(() => closeModal())
          .catch((err) => show(`Could not join: ${err instanceof Error ? err.message : String(err)}`));
      };
      root.querySelector<HTMLButtonElement>('#mp-solo')!.onclick = () => {
        closeModal();
        editor.playSolo();
      };
    });

  // ------------------------------------------------------- 🎮 controls
  const controlsUi = wireControls(() => editor.project, () => editor.touch(), openModal);
  $('btn-controls').onclick = () => controlsUi.open();

  // ------------------------------------------------- templates ("✚ New")
  const openTemplates = (): void =>
    openModal((root) => {
      root.innerHTML = `<h2>✚ New game from a template</h2><div id="lib-row"></div><div class="tpl-grid"></div>`;
      // Your saved games first — open (or delete) any 💾 Save slot.
      const lib = editor.libraryList();
      const libRow = root.querySelector<HTMLElement>('#lib-row')!;
      if (lib.length) {
        libRow.innerHTML = `<p class="muted" style="margin:4px 0 6px">💾 Your saved games:</p>`;
        for (const entry of lib) {
          const row = document.createElement('div');
          row.className = 'row';
          row.style.marginBottom = '6px';
          const open = document.createElement('button');
          open.className = 'btn';
          open.textContent = `📂 ${entry.name}`;
          open.onclick = () => {
            if (editor.openFromLibrary(entry.id)) closeModal();
          };
          const del = document.createElement('button');
          del.className = 'btn';
          del.textContent = '🗑';
          del.title = 'Delete this saved game';
          del.onclick = () => {
            if (confirm(`Delete saved game "${entry.name}"?`)) {
              editor.deleteFromLibrary(entry.id);
              openTemplates();
            }
          };
          row.append(open, del);
          libRow.appendChild(row);
        }
        libRow.appendChild(document.createElement('hr'));
      }
      const grid = root.querySelector('.tpl-grid')!;
      for (const t of TEMPLATES) {
        const card = document.createElement('div');
        card.className = 'tpl';
        card.innerHTML = `<div class="t-view">${t.view}</div><div class="t-name">${t.emoji} ${t.name}</div><p>${t.blurb}</p>`;
        card.onclick = () => {
          editor.importProject(t.make());
          closeModal();
        };
        grid.appendChild(card);
      }
      const locked = document.createElement('div');
      locked.className = 'tpl locked';
      locked.innerHTML = `<div class="t-view">First-person · 3D</div><div class="t-name">🥽 Coming later</div><p>First-person and 3D templates arrive when the engine grows its 3D renderer.</p>`;
      grid.appendChild(locked);
    });
  $('btn-new').onclick = openTemplates;

  // 🗄 Database: project-wide item + language tables.
  $('btn-db').onclick = () =>
    openModal((root) => {
      root.innerHTML = `<h2>🗄 Database — "${editor.project.name}"</h2>
        <h3>🎁 Items</h3>
        <p class="muted">Referenced by id everywhere: api.items.give/use/buy, the 🎁 event action, shops.</p>
        <div id="db-items"></div>
        <h3 style="margin-top:16px">🌐 Languages</h3>
        <p class="muted">Any text starting with @key (labels, stories, 💬 events) translates per player language. JSON: {"en": {"greet": "Hello"}, "es": {"greet": "Hola"}}</p>
        <textarea id="db-locales" style="width:100%;height:120px"></textarea>
        <div class="row" style="margin-top:6px"><button class="btn primary" id="db-locales-save">Save languages</button><span class="muted" id="db-locales-out"></span></div>`;
      const itemsRoot = root.querySelector<HTMLElement>('#db-items')!;
      const renderItems = (): void => {
        itemsRoot.innerHTML = '';
        const db = (editor.project.db ??= { items: [] });
        db.items.forEach((item, i) => {
          const row = document.createElement('div');
          row.className = 'row';
          row.style.marginBottom = '6px';
          const mk = (val: string, w: number, cb: (v: string) => void, ph = ''): HTMLInputElement => {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.style.width = `${w}px`;
            inp.value = val;
            inp.placeholder = ph;
            inp.oninput = () => {
              cb(inp.value);
              editor.touch();
            };
            return inp;
          };
          row.append(
            mk(item.emoji, 44, (v) => (item.emoji = v)),
            mk(item.id, 90, (v) => (item.id = v), 'id'),
            mk(item.name, 110, (v) => (item.name = v), 'name'),
          );
          const price = document.createElement('input');
          price.type = 'number';
          price.style.width = '64px';
          price.title = 'price (coins)';
          price.value = String(item.price);
          price.oninput = () => {
            item.price = Number(price.value) || 0;
            editor.touch();
          };
          const eff = document.createElement('select');
          for (const o of ['none', 'heal', 'coins', 'xp']) {
            const op = document.createElement('option');
            op.value = o;
            op.textContent = o === 'none' ? 'no effect' : `use: ${o}`;
            if (item.effect === o) op.selected = true;
            eff.appendChild(op);
          }
          eff.onchange = () => {
            item.effect = eff.value as typeof item.effect;
            editor.touch();
          };
          const n = document.createElement('input');
          n.type = 'number';
          n.style.width = '56px';
          n.title = 'effect amount';
          n.value = String(item.n);
          n.oninput = () => {
            item.n = Number(n.value) || 0;
            editor.touch();
          };
          const kill = document.createElement('button');
          kill.className = 'btn';
          kill.textContent = '✕';
          kill.onclick = () => {
            db.items.splice(i, 1);
            editor.touch();
            renderItems();
          };
          row.append(price, eff, n, kill);
          itemsRoot.appendChild(row);
        });
        const add = document.createElement('button');
        add.className = 'btn';
        add.textContent = '+ item';
        add.onclick = () => {
          db.items.push({ id: `item${db.items.length + 1}`, name: 'New item', emoji: '🎁', desc: '', price: 0, effect: 'none', n: 1 });
          editor.touch();
          renderItems();
        };
        itemsRoot.appendChild(add);
      };
      renderItems();
      const locBox = root.querySelector<HTMLTextAreaElement>('#db-locales')!;
      locBox.value = JSON.stringify(editor.project.locales ?? {}, null, 2);
      root.querySelector<HTMLButtonElement>('#db-locales-save')!.onclick = () => {
        const out = root.querySelector<HTMLElement>('#db-locales-out')!;
        try {
          editor.project.locales = JSON.parse(locBox.value || '{}') as Record<string, Record<string, string>>;
          editor.touch();
          out.textContent = 'Saved ✓';
        } catch (err) {
          out.textContent = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
        }
      };
    });

  // 💾 quick-save the whole game to My Games (named slot per project name).
  const saveBtn = $<HTMLButtonElement>('btn-save');
  saveBtn.onclick = () => {
    editor.saveToLibrary();
    saveBtn.textContent = '✓ Saved';
    setTimeout(() => (saveBtn.textContent = '💾 Save'), 1200);
  };

  // --------------------------------------------------- publish ("🌍")
  const field = (root: HTMLElement, label: string, input: HTMLElement): void => {
    const row = document.createElement('div');
    row.className = 'field';
    const l = document.createElement('label');
    l.textContent = label;
    row.append(l, input);
    root.appendChild(row);
  };
  const textInput = (value: string, type = 'text'): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = type;
    i.value = value;
    return i;
  };
  $('btn-publish').onclick = () =>
    openModal((root) => {
      root.innerHTML = `<h2>🌍 Publish "${editor.project.name}"</h2>
        <p class="muted">All paths use YOUR credentials/devices, stored only on this device (never inside the game).</p>
        <h3>1 · A folder on this computer</h3><div id="pub-folder"></div>
        <h3 style="margin-top:18px">2 · Push to your GitHub repo</h3><div id="pub-gh"></div>
        <h3 style="margin-top:18px">3 · Add it to the Interverse world</h3><div id="pub-world"></div>`;
      const gh = root.querySelector<HTMLElement>('#pub-gh')!;
      const world = root.querySelector<HTMLElement>('#pub-world')!;
      const folder = root.querySelector<HTMLElement>('#pub-folder')!;
      // File System Access: save/open .interverse.json in a folder the user
      // picks — their PC's documents, a synced drive, a git checkout, etc.
      type DirPicker = { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> };
      const picker = window as unknown as DirPicker;
      if (picker.showDirectoryPicker) {
        const row = document.createElement('div');
        row.className = 'row';
        const fOut = document.createElement('div');
        fOut.className = 'muted';
        fOut.style.cssText = 'font-size:12px;margin-top:6px';
        fOut.textContent = 'Works great with a local git checkout — commit the saved file with your usual tools.';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn primary';
        saveBtn.textContent = '📁 Save to a folder…';
        saveBtn.onclick = () => {
          void (async () => {
            try {
              const dir = await picker.showDirectoryPicker!({ mode: 'readwrite' });
              const name = `${slugify(editor.project.name) || 'game'}.interverse.json`;
              const fh = await dir.getFileHandle(name, { create: true });
              const w = await (fh as unknown as { createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }> }).createWritable();
              await w.write(editor.exportJson());
              await w.close();
              fOut.textContent = `Saved ${name} ✓`;
            } catch (err) {
              if ((err as Error).name !== 'AbortError') fOut.textContent = `Could not save: ${(err as Error).message}`;
            }
          })();
        };
        const openBtn = document.createElement('button');
        openBtn.className = 'btn';
        openBtn.textContent = '📂 Open from this computer…';
        openBtn.onclick = () => {
          void (async () => {
            try {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json,application/json';
              input.onchange = () => {
                const f = input.files?.[0];
                if (!f) return;
                void f.text().then((json) => {
                  editor.importJson(json);
                  closeModal();
                });
              };
              input.click();
            } catch {
              /* cancelled */
            }
          })();
        };
        row.append(saveBtn, openBtn);
        folder.append(row, fOut);
      } else {
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent = 'This browser (Safari/iPhone/iPad) can’t write folders directly — use Export/Import in the toolbar; the files are identical.';
        folder.appendChild(note);
      }

      const token = textInput(localStorage.getItem(pubStore.ghToken) ?? '', 'password');
      token.placeholder = 'fine-grained token with Contents: write';
      const repo = textInput(localStorage.getItem(pubStore.ghRepo) ?? '');
      repo.placeholder = 'owner/repo';
      const branch = textInput('main');
      const path = textInput(`games/${slugify(editor.project.name)}.interverse.json`);
      field(gh, 'GitHub token', token);
      field(gh, 'Repository', repo);
      field(gh, 'Branch', branch);
      field(gh, 'File path', path);
      const ghOut = document.createElement('div');
      const ghBtn = document.createElement('button');
      ghBtn.className = 'btn primary';
      ghBtn.textContent = 'Push to GitHub';
      ghBtn.onclick = () => {
        const [owner, repoName] = repo.value.trim().split('/');
        if (!token.value.trim() || !owner || !repoName) {
          ghOut.className = 'out';
          ghOut.textContent = 'Fill in the token and owner/repo first.';
          return;
        }
        localStorage.setItem(pubStore.ghToken, token.value.trim());
        localStorage.setItem(pubStore.ghRepo, repo.value.trim());
        ghBtn.disabled = true;
        ghOut.className = 'out';
        ghOut.textContent = 'Pushing…';
        pushToGitHub(
          {
            token: token.value.trim(),
            owner,
            repo: repoName,
            branch: branch.value.trim() || 'main',
            path: path.value.trim(),
          },
          editor.exportJson(),
        )
          .then((r) => {
            ghOut.innerHTML = `✅ Pushed!<br>File: <a href="${r.htmlUrl}" target="_blank">${r.htmlUrl}</a><br>▶ Anyone can play it at:<br><a href="${r.playUrl}" target="_blank">${r.playUrl}</a>`;
          })
          .catch((err) => {
            ghOut.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
          })
          .finally(() => {
            ghBtn.disabled = false;
          });
      };
      gh.append(ghBtn, ghOut);

      const apiUrl = textInput(localStorage.getItem(pubStore.worldApi) ?? '');
      apiUrl.placeholder = 'https://your-interverse-node';
      const dev = textInput(localStorage.getItem(pubStore.devName) ?? '');
      dev.placeholder = 'developer name';
      field(world, 'Interverse node URL', apiUrl);
      field(world, 'Developer', dev);
      const wOut = document.createElement('div');
      const wBtn = document.createElement('button');
      wBtn.className = 'btn good';
      wBtn.textContent = 'Register in the world';
      wBtn.onclick = () => {
        if (!apiUrl.value.trim() || !dev.value.trim()) {
          wOut.className = 'out';
          wOut.textContent = 'Fill in the node URL and developer name first.';
          return;
        }
        localStorage.setItem(pubStore.worldApi, apiUrl.value.trim());
        localStorage.setItem(pubStore.devName, dev.value.trim());
        wBtn.disabled = true;
        wOut.className = 'out';
        wOut.textContent = 'Registering…';
        registerInWorld(editor.project, apiUrl.value.trim(), dev.value.trim())
          .then((r) => {
            editor.touch();
            wOut.innerHTML = `✅ Registered as <b>${r.gameId}</b> — the game's world id is saved in the project, and your reward api-key stays on this device. Verium/IVX balance will show in Play mode once a wallet address is set in the project platform settings.`;
          })
          .catch((err) => {
            wOut.textContent = `Failed: ${err instanceof Error ? err.message : String(err)} (is the node URL reachable?)`;
          })
          .finally(() => {
            wBtn.disabled = false;
          });
      };
      world.append(wBtn, wOut);
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

  // ----------------------------------------------------------- installing
  // Windows/Android/desktop: the browser offers a real install prompt.
  // iOS Safari never fires beforeinstallprompt — show the Share steps.
  const installBtn = $<HTMLButtonElement>('btn-install');
  let deferredInstall: (Event & { prompt: () => void }) | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as Event & { prompt: () => void };
    installBtn.style.display = '';
  });
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (isIOS && !standalone) installBtn.style.display = '';
  // Arriving from the hub's "⬇ Install Studio" link: surface the install
  // flow immediately — the button appears highlighted, and as soon as the
  // browser's install prompt is available one click starts it. (Browsers
  // only allow prompt() inside a user gesture, so we spotlight, not force.)
  if (new URLSearchParams(window.location.search).get('install') === '1' && !standalone) {
    installBtn.style.display = '';
    installBtn.classList.add('primary');
    installBtn.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 700, iterations: 6 },
    );
    if (isIOS) setTimeout(() => installBtn.click(), 600); // Share-steps modal
  }
  installBtn.onclick = () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall = null;
      installBtn.style.display = 'none';
      return;
    }
    openModal((root) => {
      root.innerHTML = `<h2>⬇ Install Interverse Studio</h2>
        <p>On iPhone / iPad (Safari):</p>
        <ol><li>Tap the <b>Share</b> button (square with an arrow)</li>
        <li>Scroll and tap <b>Add to Home Screen</b></li>
        <li>Tap <b>Add</b> — Studio installs like an app</li></ol>
        <p class="muted">On Windows / Android, Chrome and Edge show an install icon in the address bar (or this button offers it directly).</p>`;
    });
  };

  // ------------------------------------------------------------- palette
  const left = $('left');
  const hier = document.createElement('div');
  const palEntities = document.createElement('div');
  const palTiles = document.createElement('div');
  palTiles.style.display = 'none';
  left.append(hier, palEntities, palTiles);

  // 🌲 Hierarchy: every level and its actors as a tree — click to select.
  const KIND_EMOJI: Record<string, string> = {
    blob: '🙂', npc: '💬', mob: '👾', boss: '👹', crate: '📦', lantern: '🏮',
    plant: '🪴', text: '🔤', button: '🔘', image: '🖼',
  };
  const refreshHierarchy = (): void => {
    hier.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = '🌲 Hierarchy';
    hier.appendChild(head);
    for (const scene of editor.project.scenes) {
      const active = scene.id === editor.sceneId;
      const row = document.createElement('div');
      row.style.cssText = `cursor:pointer;font-weight:800;padding:2px 4px;border-radius:6px;${active ? 'color:var(--accent)' : 'color:var(--ink-soft)'}`;
      row.textContent = `${active ? '▾' : '▸'} 🚪 ${scene.name}`;
      row.onclick = () => editor.switchScene(scene.id);
      hier.appendChild(row);
      if (!active) continue;
      for (const ent of scene.entities) {
        const er = document.createElement('div');
        const sel = editor.selectedId === ent.id;
        er.style.cssText = `cursor:pointer;padding:1px 4px 1px 20px;border-radius:6px;font-size:13px;${sel ? 'background:var(--panel2);color:var(--accent)' : ''}`;
        er.textContent = `${KIND_EMOJI[ent.kind] ?? '·'} ${ent.name}${ent.events.length ? ' ⚡' : ''}`;
        er.onclick = () => editor.select(ent.id);
        hier.appendChild(er);
      }
    }
    const spacer = document.createElement('div');
    spacer.style.height = '8px';
    hier.appendChild(spacer);
  };

  // Tile paintbox (🗺 Tiles toggles it in place of the entity palette).
  const tilesBtn = $<HTMLButtonElement>('btn-tiles');
  let activeSwatch: HTMLElement | null = null;
  const exitTileMode = (): void => {
    editor.setTileMode(null);
    palTiles.style.display = 'none';
    palEntities.style.display = '';
    tilesBtn.classList.remove('primary');
    activeSwatch?.style.removeProperty('border-color');
    activeSwatch = null;
  };
  const buildTilePalette = (): void => {
    palTiles.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = 'Paint terrain';
    palTiles.appendChild(head);
    const pick = (el: HTMLElement, ch: string): void => {
      editor.setTileMode(ch);
      activeSwatch?.style.removeProperty('border-color');
      activeSwatch = el;
      el.style.borderColor = 'var(--accent)';
    };
    for (const t of TILE_TYPES) {
      const item = document.createElement('div');
      item.className = 'pal-item';
      item.innerHTML = `<span class="em" style="display:inline-block;width:20px;height:20px;border-radius:5px;background:#${t.color
        .toString(16)
        .padStart(6, '0')}"></span>${t.name}${t.solid ? ' <span class="muted" style="font-size:11px">solid</span>' : ''}`;
      item.onclick = () => pick(item, t.ch);
      palTiles.appendChild(item);
    }
    const eraser = document.createElement('div');
    eraser.className = 'pal-item';
    eraser.innerHTML = `<span class="em">🧽</span>Eraser`;
    eraser.onclick = () => pick(eraser, '.');
    palTiles.appendChild(eraser);
    const genHead = document.createElement('div');
    genHead.className = 'pal-head';
    genHead.style.marginTop = '8px';
    genHead.textContent = '🎲 Generate a level';
    palTiles.appendChild(genHead);
    for (const [kind, label] of [['maze', '🌀 Maze'], ['dungeon', '🏰 Dungeon'], ['island', '🏝 Island']] as const) {
      const b = document.createElement('div');
      b.className = 'pal-item';
      b.innerHTML = `<span class="em"></span>${label}`;
      b.onclick = () => editor.generateTiles(kind);
      palTiles.appendChild(b);
    }
    const done = document.createElement('button');
    done.className = 'btn good';
    done.style.width = '100%';
    done.style.marginTop = '10px';
    done.textContent = '✓ Done painting';
    done.onclick = exitTileMode;
    palTiles.appendChild(done);
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.style.cssText = 'font-size:12px;margin-top:10px';
    hint.textContent =
      'Click / drag on the canvas to paint. Solid tiles (water, walls, trees) block players in Play mode.';
    palTiles.appendChild(hint);
  };
  buildTilePalette();
  tilesBtn.onclick = () => {
    if (palTiles.style.display === 'none') {
      if (editor.playing) editor.stop();
      palEntities.style.display = 'none';
      palTiles.style.display = '';
      tilesBtn.classList.add('primary');
    } else {
      exitTileMode();
    }
  };

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
    palEntities.appendChild(head);
    for (const item of group.items) {
      const btn = document.createElement('div');
      btn.className = 'pal-item';
      btn.innerHTML = `<span class="em">${item.emoji}</span>${item.label}`;
      // Some palette entries open a screen instead of placing an actor.
      if (item.opens === 'controls') {
        btn.addEventListener('click', () => controlsUi.open());
        palEntities.appendChild(btn);
        continue;
      }
      const kind = item.kind!;
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/interverse-kind', kind);
      });
      // Click also places (center of the design space) — friendlier on touch.
      btn.addEventListener('click', () => {
        if (kind === 'image') placeImage(360, 640);
        else editor.addEntity(kind, 360, 640);
      });
      palEntities.appendChild(btn);
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
  const flow = wireFlow(editor);
  const tabs = document.querySelectorAll<HTMLButtonElement>('#tabs button[data-tab]');
  tabs.forEach((b) =>
    b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('active', x === b));
      document
        .querySelectorAll<HTMLElement>('.tabpane')
        .forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
      if (b.dataset.tab === 'flow') flow.render();
    }),
  );

  // ▾ minimize the bottom panel (the canvas grows to fill the space)
  const minBtn = $<HTMLButtonElement>('btn-minimize');
  minBtn.style.cssText = 'background:transparent;border:0;color:var(--ink-soft);cursor:pointer;font-weight:800';
  minBtn.onclick = () => {
    const app = document.getElementById('app')!;
    const min = app.classList.toggle('bottom-min');
    minBtn.textContent = min ? '▴' : '▾';
    minBtn.title = min ? 'Restore this panel' : 'Minimize this panel';
    window.dispatchEvent(new Event('resize'));
  };

  // ------------------------------------------------------------ code tab
  const codeText = $<HTMLTextAreaElement>('code-text');
  const codePane = wireCodePane(codeText, () => {
    editor.scene.script = codeText.value;
    editor.touch();
  });
  const refreshCode = (): void => {
    codeText.value = editor.scene.script;
    // An empty Code window used to be a blinking cursor with no clue what
    // "api" was. Show a runnable starter instead — greyed, so it is clearly
    // a suggestion until the author types.
    codeText.placeholder = STARTER_SCRIPT.replace('the level starts', `"${editor.scene.name}" starts`);
  };
  codeText.oninput = () => {
    editor.scene.script = codeText.value;
    editor.touch();
  };
  $('btn-apply-code').onclick = () => {
    // Blank script + untouched starter = run the starter, so the very first
    // Apply does something instead of nothing.
    if (!codeText.value.trim()) codeText.value = STARTER_SCRIPT;
    editor.scene.script = codeText.value;
    editor.touch();
    codePane.showError(null);
    if (editor.playing) editor.runScriptNow(codeText.value);
    else editor.play();
  };
  editor.onScriptError = (err) => codePane.showError(err);

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
  const chat = wireChat(editor);
  const prevSelection = editor.onSelection;
  editor.onSelection = () => {
    prevSelection();
    refreshStory();
    refreshHierarchy();
  };
  editor.onChanged = () => {
    refreshToolbar();
    refreshCode();
    refreshHierarchy();
  };
  editor.onPlayState = () => {
    refreshToolbar();
    editor.onSelection();
  };
  refreshToolbar();
  refreshCode();
  refreshHierarchy();
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
    templateCount: () => TEMPLATES.length,
    loadTemplate: (id: string) => {
      const t = TEMPLATES.find((x) => x.id === id);
      if (t) editor.importProject(t.make());
      return !!t;
    },
    playScore: () => editor.getPlayScene()?.scoreNow() ?? 0,
    playVisibleCount: () => editor.getPlayScene()?.visibleEntityCount() ?? 0,
    gameIsOver: () => editor.getPlayScene()?.isOver() ?? false,
    skillNodeCount: () => editor.getPlayScene()?.skillTree()?.nodeCount() ?? 0,
    skillPoints: () => editor.getPlayScene()?.skillTree()?.getPoints() ?? 0,
    skillAddPoints: (n: number) => editor.getPlayScene()?.skillTree()?.addPoints(n),
    skillUnlock: (id: string) => editor.getPlayScene()?.skillTree()?.unlock(id) ?? false,
    skillUnlocked: () => editor.getPlayScene()?.skillTree()?.unlockedIds() ?? [],
    setMultiplayer: (b: boolean) => {
      editor.project.multiplayer = b;
      editor.touch();
    },
    netHost: () => editor.hostMultiplayer(),
    netJoin: (code: string) => editor.joinMultiplayer(code),
    netCode: () => editor.net?.code ?? null,
    netIsHost: () => editor.net?.isHost ?? false,
    netPlayerCount: () => editor.net?.players().length ?? 0,
    netRemoteCount: () => editor.getPlayScene()?.remoteCount() ?? 0,
    netRemotePos: () => {
      const r = editor.net?.remotes()[0];
      return r && r.x > -9000 ? { x: r.x, y: r.y } : null;
    },
    netSetState: (k: string, v: unknown) => editor.net?.setState(k, v),
    netGetState: (k: string) => editor.net?.getState(k),
    setTile: (c: number, r: number, ch: string) => editor.setTile(c, r, ch),
    tileAt: (c: number, r: number) => editor.tileAt(c, r),
    setTileMode: (ch: string | null) => editor.setTileMode(ch),
    playHasTiles: () => editor.getPlayScene()?.hasTiles() ?? false,
    setWorldSize: (w: number, h: number) => editor.setWorldSize(w, h),
    worldSize: () => editor.getPlayScene()?.worldSize() ?? { w: editor.scene.worldW, h: editor.scene.worldH },
    cameraX: () => editor.getPlayScene()?.cameraX() ?? 0,
    setGravity: (g: boolean) => {
      editor.scene.gravity = g;
      editor.touch();
    },
    setView: (v: 'top' | 'depth') => {
      editor.scene.view = v;
      editor.touch();
      if (!editor.playing) editor.openEditScene();
    },
    setFramePreview: (m: 'off' | 'landscape' | 'portrait') => editor.setFramePreview(m),
    framePreview: () => editor.framePreview,
    mobCount: () => editor.getPlayScene()?.mobCount() ?? 0,
    mobHp: (name: string) => editor.getPlayScene()?.mobHpOf(name) ?? 0,
    heartsNow: () => editor.getPlayScene()?.heartsState().now ?? 0,
    xpNow: () => editor.getPlayScene()?.xpNow() ?? 0,
    levelNow: () => editor.getPlayScene()?.levelNow() ?? 0,
    abilityCount: () => editor.getPlayScene()?.abilityCount() ?? 0,
    fireAbility: (name: string) => editor.getPlayScene()?.fireAbility(name) ?? false,
    bossBarVisible: () => editor.getPlayScene()?.bossBarVisible() ?? false,
    playerZ: () => editor.getPlayScene()?.playerAirHeight() ?? 0,
    shotsFired: () => editor.getPlayScene()?.shotsFired() ?? 0,
    mobEnraged: (name: string) => editor.getPlayScene()?.mobEnraged(name) ?? false,
    chatBridged: () => chat.bridged(),
    coinsNow: () => editor.getPlayScene()?.coinsNow() ?? 0,
    setEvents: (name: string, events: unknown) => {
      const d = editor.entityByName(name);
      if (!d) return false;
      d.events = events as typeof d.events;
      editor.touch();
      return true;
    },
    bindKey: (action: string, key: string) => controlsUi.bind(action, key),
    unbindKey: (action: string, key: string) => controlsUi.unbind(action, key),
    keysOf: (action: string) => controlsUi.keysOf(action),
    addAction: (id: string) => controlsUi.addAction(id),
    removeAction: (id: string) => controlsUi.removeAction(id),
    keyConflicts: () => controlsUi.conflicts(),
    resetControls: () => controlsUi.reset(),
    getPlayPos: (name: string) => {
      const e = editor.getPlayScene()?.entityByName(name);
      return e ? { x: e.x, y: e.y } : { x: 0, y: 0 };
    },
    apiSearch: (q: string) => codePane.search(q),
    apiInsert: (name: string) => codePane.insert(name),
    codeText: () => codeText.value,
    scriptError: () => codePane.errorText(),
    setLevelEvents: (events: unknown) => {
      editor.scene.events = events as NonNullable<typeof editor.scene.events>;
      editor.touch();
      return true;
    },
    levelEventCount: () => editor.scene.events?.length ?? 0,
    tapLevel: () => editor.getPlayScene()?.fireLevelTaps() ?? false,
    switchIsOn: (name: string) => editor.getPlayScene()?.switchState(name) ?? false,
    musicNow: () => editor.getPlayScene()?.musicNow() ?? null,
    vfxCount: () => editor.getPlayScene()?.vfxCount ?? 0,
    setOutfit: (name: string, opts: { hat?: string; held?: string }) =>
      editor.getPlayScene()?.setOutfit(name, opts),
    outfitOf: (name: string) => editor.getPlayScene()?.outfitOf(name) ?? null,
    flowLink: (fromName: string, toName: string) => {
      let fromId = '';
      let toId = '';
      for (const scene of editor.project.scenes) {
        if (scene.name === toName) toId = `lvl:${scene.id}`;
        for (const ent of scene.entities) {
          if (ent.name === fromName) fromId = `ent:${ent.id}`;
          if (ent.name === toName) toId = `ent:${ent.id}`;
        }
      }
      return fromId && toId ? flow.link(fromId, toId) : false;
    },
    setDbItems: (items: unknown) => {
      editor.project.db = { items: items as never };
      editor.touch();
    },
    setLocales: (locales: unknown) => {
      editor.project.locales = locales as never;
      editor.touch();
    },
    itemCountOf: (id: string) => editor.getPlayScene()?.itemCount(id) ?? 0,
    giveItem: (id: string) => editor.getPlayScene()?.giveItem(id) ?? false,
    useItem: (id: string) => editor.getPlayScene()?.useItem(id) ?? false,
    buyItem: (id: string) => editor.getPlayScene()?.buyItem(id) ?? false,
    cameraHolding: () => editor.getPlayScene()?.cameraHolding() ?? false,
    varNow: (name: string) => editor.getPlayScene()?.varNow(name) ?? 0,
    shopVisible: () => editor.getPlayScene()?.shopVisible() ?? false,
    hierarchyCount: () => document.querySelectorAll('#left div').length,
    flowNodes: () => {
      flow.render();
      return flow.nodeCount();
    },
    titleVisible: () => editor.getPlayScene()?.titleVisible() ?? false,
    titlePick: (kind: 'continue' | 'new') => editor.getPlayScene()?.titlePick(kind),
    togglePanel: () => $<HTMLButtonElement>('btn-minimize').click(),
    panelMinimized: () => document.getElementById('app')!.classList.contains('bottom-min'),
    genTiles: (kind: 'maze' | 'dungeon' | 'island') => editor.generateTiles(kind),
    tileRows: () => editor.scene.tiles ?? null,
    playClip: (name: string, clip: string) => editor.getPlayScene()?.playClip(name, clip) ?? false,
    activeClip: (name: string) => editor.getPlayScene()?.activeClips.get(name) ?? null,
    librarySave: () => editor.saveToLibrary(),
    libraryList: () => editor.libraryList(),
    libraryOpen: (id: string) => editor.openFromLibrary(id),
    libraryDelete: (id: string) => editor.deleteFromLibrary(id),
  };

  // Player boot: ?load=<url-to-project-json> (+ &play=1 to jump straight in).
  // This is how repo-published games are playable by anyone, install-free.
  const boot = new URLSearchParams(window.location.search);
  const loadUrl = boot.get('load');
  if (loadUrl) {
    try {
      const res = await fetch(loadUrl);
      const json = await res.text();
      editor.importJson(json);
      if (boot.get('play') === '1') editor.play();
    } catch (err) {
      alert(`Could not load the game: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

void main();
