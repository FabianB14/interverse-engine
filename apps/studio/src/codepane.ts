/**
 * 🔍 The Code window's command dock.
 *
 * The api is big and was previously advertised by five examples in a hint
 * box, so the honest state of scripting was "you can do anything, and you
 * will never find out what". This is the fix: a searchable list of every
 * call, grouped by category, that inserts a working line at the cursor.
 *
 * It also owns the two other things a non-programmer needs — a starter
 * script instead of a blank page, and script errors rendered in the panel
 * with a plain-language hint instead of a browser alert().
 */
import { API_DOCS, STARTER_SCRIPT, searchApi } from './apidocs.js';
import type { ApiEntry } from './apidocs.js';

export interface CodePane {
  /** Re-filter the list (also called on first render). */
  refresh: () => void;
  /** Show a script failure in the panel. null clears it. */
  showError: (err: unknown) => void;
  /** Headless hooks. */
  search: (q: string) => string[];
  insert: (name: string) => boolean;
  errorText: () => string;
  starter: () => string;
}

/** Turn a thrown value into something a 12-year-old can act on. */
export function explainError(err: unknown): { message: string; hint: string } {
  const message = err instanceof Error ? err.message : String(err);
  const m = /^(\w+) is not defined$/.exec(message);
  if (m) {
    return {
      message,
      hint: `There is no "${m[1]}" here. Every command starts with api. — try the 🔍 list on the right.`,
    };
  }
  if (/is not a function/.test(message)) {
    return { message, hint: 'That name exists but is not a command — check the spelling against the 🔍 list.' };
  }
  if (/of undefined|of null|Cannot read/.test(message)) {
    return {
      message,
      hint: 'Something was missing — usually an actor name that is not in this level. Check the name matches exactly.',
    };
  }
  if (/Unexpected|Invalid or unexpected token|missing/i.test(message)) {
    return { message, hint: 'The script could not be read — usually a missing ) or }.' };
  }
  return { message, hint: 'Fix the line above and press Apply to game again.' };
}

export function wireCodePane(textarea: HTMLTextAreaElement, onEdited: () => void): CodePane {
  const searchBox = document.getElementById('api-search') as HTMLInputElement;
  const list = document.getElementById('api-list')!;
  const help = document.getElementById('api-help')!;
  const errBox = document.getElementById('code-error')!;
  let lastError = '';

  /** Drop text at the caret, on its own line, and keep focus in the editor. */
  const insertSnippet = (snippet: string): void => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const pad = before && !before.endsWith('\n') ? '\n' : '';
    const text = `${pad}${snippet}\n`;
    textarea.value = before + text + after;
    const caret = start + text.length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
    onEdited();
  };

  const showHelp = (e: ApiEntry): void => {
    help.textContent = '';
    const sig = document.createElement('div');
    sig.innerHTML = `<b>${escapeHtml(e.signature)}</b>`;
    const blurb = document.createElement('div');
    blurb.style.marginTop = '3px';
    blurb.textContent = e.blurb;
    const code = document.createElement('code');
    code.textContent = e.snippet;
    const add = document.createElement('button');
    add.className = 'btn';
    add.style.marginTop = '6px';
    add.textContent = '⤵ Insert into script';
    add.onclick = () => insertSnippet(e.snippet);
    help.append(sig, blurb, code, add);
  };

  const refresh = (): void => {
    const hits = searchApi(searchBox.value);
    list.textContent = '';
    let cat = '';
    for (const e of hits) {
      if (e.category !== cat) {
        cat = e.category;
        const h = document.createElement('div');
        h.className = 'api-cat';
        h.textContent = cat;
        list.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'api-item';
      row.dataset.name = e.name;
      row.textContent = e.name;
      row.title = e.blurb;
      // One click explains it, a double click commits it — so browsing the
      // list never silently rewrites the script you are reading.
      row.onclick = () => {
        for (const el of list.querySelectorAll('.api-item.on')) el.classList.remove('on');
        row.classList.add('on');
        showHelp(e);
      };
      row.ondblclick = () => insertSnippet(e.snippet);
      list.appendChild(row);
    }
    if (!hits.length) {
      const none = document.createElement('div');
      none.className = 'api-cat';
      none.textContent = 'nothing matches — try "coin", "jump", "music"';
      list.appendChild(none);
    }
  };

  searchBox.oninput = refresh;
  refresh();

  const showError = (err: unknown): void => {
    if (err === null) {
      lastError = '';
      errBox.classList.remove('on');
      errBox.textContent = '';
      return;
    }
    const { message, hint } = explainError(err);
    lastError = message;
    errBox.textContent = '';
    const head = document.createElement('div');
    head.innerHTML = `<b>⚠ ${escapeHtml(message)}</b>`;
    const tip = document.createElement('div');
    tip.style.marginTop = '2px';
    tip.textContent = hint;
    errBox.append(head, tip);
    errBox.classList.add('on');
  };

  return {
    refresh,
    showError,
    search: (q: string) => {
      searchBox.value = q;
      refresh();
      return searchApi(q).map((e) => e.name);
    },
    insert: (name: string) => {
      const entry = API_DOCS.find((e) => e.name === name);
      if (!entry) return false;
      insertSnippet(entry.snippet);
      return true;
    },
    errorText: () => lastError,
    starter: () => STARTER_SCRIPT,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
