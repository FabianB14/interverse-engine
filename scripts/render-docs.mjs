/**
 * Render docs/studio-guide.md into a styled HTML docs page. Used by
 * assemble-site.mjs so interverseengine.com/docs/ always matches the guide
 * in the repo — one source of truth, no hand-copied HTML to drift.
 *
 * Deliberately small: it only handles the constructs the guide actually
 * uses (headings, paragraphs, bullet/numbered lists with one nesting level,
 * fenced code, tables, bold/italic/inline code).
 */
import { readFileSync } from 'node:fs';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Inline markdown: `code`, **bold**, *italic* — applied after escaping. */
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function renderGuide(mdPath) {
  const lines = readFileSync(mdPath, 'utf8').split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  /** Consume consecutive |-rows (any indentation) and return table HTML. */
  const renderTable = () => {
    const rows = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++].trim());
    const cells = (r) =>
      r
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
    const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r.replace(/\s/g, '')));
    const [head, ...rest] = body;
    const html = ['<div class="tbl"><table>'];
    html.push(
      `<thead><tr>${cells(head)
        .map((c) => `<th>${inline(c)}</th>`)
        .join('')}</tr></thead>`,
    );
    html.push('<tbody>');
    for (const r of rest)
      html.push(
        `<tr>${cells(r)
          .map((c) => `<td>${inline(c)}</td>`)
          .join('')}</tr>`,
      );
    html.push('</tbody></table></div>');
    return html.join('\n');
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.startsWith('```')) {
      flushPara();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // headings
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) {
      flushPara();
      const depth = h[1].length;
      const text = h[2];
      const id = slug(text);
      if (depth === 2) toc.push({ id, text });
      out.push(`<h${depth} id="${id}">${inline(text)}</h${depth}>`);
      i++;
      continue;
    }

    // tables (top-level or indented under a list item)
    if (/^\s*\|/.test(line)) {
      flushPara();
      out.push(renderTable());
      continue;
    }

    // lists (bulleted or numbered, one nesting level, continuation lines)
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      out.push(ordered ? '<ol>' : '<ul>');
      let open = false; // an <li> awaiting its close (maybe holding a sublist)
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.) (.*)$/.exec(lines[i]);
        if (m && m[1].length === 0) {
          // collect continuation lines (indented, non-list)
          let item = m[3];
          i++;
          while (
            i < lines.length &&
            /^\s+\S/.test(lines[i]) &&
            !/^\s*([-*]|\d+\.) /.test(lines[i]) &&
            !/^\s*\|/.test(lines[i])
          ) {
            item += ' ' + lines[i++].trim();
          }
          // a table indented under this item renders after it, full width
          if (i < lines.length && /^\s*\|/.test(lines[i])) {
            if (open) out.push('</li>');
            out.push(`<li>${inline(item)}`);
            out.push(renderTable());
            open = true;
            continue;
          }
          if (open) out.push('</li>');
          out.push(`<li>${inline(item)}`);
          open = true;
        } else if (m) {
          // nested item
          let item = m[3];
          i++;
          while (
            i < lines.length &&
            /^\s+\S/.test(lines[i]) &&
            !/^\s*([-*]|\d+\.) /.test(lines[i]) &&
            !/^\s*\|/.test(lines[i])
          ) {
            item += ' ' + lines[i++].trim();
          }
          out.push('<ul>');
          out.push(`<li>${inline(item)}</li>`);
          while (i < lines.length) {
            const n = /^(\s+)([-*]|\d+\.) (.*)$/.exec(lines[i]);
            if (!n) break;
            let sub = n[3];
            i++;
            while (
              i < lines.length &&
              /^\s+\S/.test(lines[i]) &&
              !/^\s*([-*]|\d+\.) /.test(lines[i]) &&
              !/^\s*\|/.test(lines[i])
            ) {
              sub += ' ' + lines[i++].trim();
            }
            out.push(`<li>${inline(sub)}</li>`);
          }
          out.push('</ul>');
        } else {
          break;
        }
      }
      if (open) out.push('</li>');
      out.push(ordered ? '</ol>' : '</ul>');
      continue;
    }

    // blank line ends a paragraph
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return { html: out.join('\n'), toc };
}

export function docsPage(mdPath) {
  const { html, toc } = renderGuide(mdPath);
  const nav = toc.map((t) => `<a href="#${t.id}">${inline(t.text)}</a>`).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#12101c" />
    <meta
      name="description"
      content="The complete guide to making a game with Interverse Studio — scenes, actors, tiles, events, flow graphs, multiplayer, saves, skill trees, cosmetics and publishing."
    />
    <title>Make a game — the Interverse Studio guide</title>
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='7' fill='%23c77dff'/%3E%3Ccircle cx='13' cy='14' r='2.4' fill='%2312101c'/%3E%3Ccircle cx='21' cy='14' r='2.4' fill='%2312101c'/%3E%3Cpath d='M11 20q5 4 10 0' stroke='%2312101c' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"
    />
    <style>
      :root {
        --bg: #12101c;
        --panel: #1a1726;
        --panel2: #211d30;
        --line: #2e2942;
        --ink: #e6e4f0;
        --soft: #9a97b8;
        --accent: #c77dff;
        --good: #8affc1;
        --warn: #ffd166;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; scroll-padding-top: 76px; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: system-ui, 'Segoe UI', sans-serif;
        line-height: 1.6;
      }
      header {
        position: sticky; top: 0; z-index: 10;
        background: rgba(18, 16, 28, 0.92);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
      }
      .nav { display: flex; align-items: center; gap: 18px; height: 60px; max-width: 1160px; margin: 0 auto; padding: 0 20px; }
      .logo { font-weight: 900; letter-spacing: 0.06em; color: var(--accent); text-decoration: none; white-space: nowrap; }
      .nav a.link { color: var(--soft); text-decoration: none; font-weight: 700; font-size: 0.95rem; }
      .nav a.link:hover { color: var(--ink); }
      .nav .spacer { flex: 1; }
      .btn {
        display: inline-block; text-decoration: none; font-weight: 800; border-radius: 12px;
        padding: 10px 18px; background: var(--accent); color: #16101f; white-space: nowrap;
      }
      .shell { max-width: 1160px; margin: 0 auto; padding: 28px 20px 80px; display: grid; grid-template-columns: 250px 1fr; gap: 36px; }
      aside {
        position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 100px);
        overflow-y: auto; font-size: 0.86rem; padding-right: 6px;
      }
      aside a {
        display: block; color: var(--soft); text-decoration: none; font-weight: 600;
        padding: 4px 10px; border-left: 2px solid var(--line); white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      aside a:hover { color: var(--ink); border-left-color: var(--accent); }
      main { min-width: 0; }
      main h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 18px; }
      main h2 {
        font-size: 1.5rem; margin: 44px 0 12px; padding-top: 18px;
        border-top: 1px solid var(--line);
      }
      main h3 { font-size: 1.15rem; margin: 28px 0 8px; color: var(--warn); }
      main h4 { font-size: 1rem; margin: 22px 0 6px; }
      main p { margin: 0 0 14px; color: var(--ink); }
      main li { margin: 0 0 8px; }
      main ul, main ol { padding-left: 24px; margin: 0 0 14px; }
      main ul ul { margin: 8px 0 0; }
      main code {
        background: var(--panel2); border: 1px solid var(--line); border-radius: 6px;
        padding: 1px 6px; font-size: 0.88em; color: var(--good);
      }
      main pre {
        background: #0d0b16; border: 1px solid var(--line); border-radius: 14px;
        padding: 16px 18px; overflow-x: auto; margin: 0 0 16px;
      }
      main pre code { background: none; border: none; padding: 0; color: var(--ink); font-size: 0.85rem; }
      .tbl { overflow-x: auto; margin: 0 0 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
      th, td { border: 1px solid var(--line); padding: 8px 12px; text-align: left; vertical-align: top; }
      th { background: var(--panel); color: var(--warn); }
      strong { color: var(--warn); font-weight: 800; }
      em { color: var(--accent); font-style: normal; font-weight: 700; }
      @media (max-width: 860px) {
        .shell { grid-template-columns: 1fr; }
        aside { position: static; max-height: none; border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
        .nav a.link { display: none; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="nav">
        <a class="logo" href="../">◆ INTERVERSE</a>
        <a class="link" href="../#hushfall">Hushfall</a>
        <a class="link" href="../#studio">Studio</a>
        <a class="link" href="../#support">Support</a>
        <span class="spacer"></span>
        <a class="btn" href="../studio/">Open Studio</a>
      </div>
    </header>
    <div class="shell">
      <aside>
${nav}
      </aside>
      <main>
${html}
      </main>
    </div>
  </body>
</html>
`;
}
