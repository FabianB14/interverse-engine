/**
 * 📍 Where a project LIVES — the persistent link between the game you have
 * open and the folder or repository it came from.
 *
 * The binding is stored on the device, keyed by project id, and never
 * inside ProjectDef. That is deliberate and load-bearing: the project JSON
 * is the thing you publish, and spec §8.4 says no credentials ship with a
 * game. A token or a private repo path riding along in an exported file
 * would be exactly that. The exported game stays pure data; where it lives
 * is this device's business.
 */
import type { ProjectDef } from './model.js';

export type Origin =
  | { kind: 'device'; slot: string }
  | { kind: 'folder'; name: string }
  | { kind: 'github'; owner: string; repo: string; branch: string; path: string };

export type SyncState = 'clean' | 'dirty' | 'saving' | 'error' | 'conflict';

const KEY = 'interverse.studio.origins';

type Table = Record<string, Origin>;

function read(): Table {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Table) : {};
  } catch {
    return {};
  }
}

function write(t: Table): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* a full quota must not break editing */
  }
}

/** Projects predate ids, so mint one lazily and keep it in the file — it
 *  identifies the project, which is not a secret. */
export function projectId(p: ProjectDef & { id?: string }): string {
  p.id ??= `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return p.id;
}

export function getOrigin(p: ProjectDef & { id?: string }): Origin | null {
  return read()[projectId(p)] ?? null;
}

export function setOrigin(p: ProjectDef & { id?: string }, origin: Origin | null): void {
  const t = read();
  const id = projectId(p);
  if (origin) t[id] = origin;
  else delete t[id];
  write(t);
}

/** One short line for the toolbar chip. */
export function originLabel(o: Origin | null): string {
  if (!o) return 'on this device';
  if (o.kind === 'github') return `${o.owner}/${o.repo}@${o.branch}`;
  if (o.kind === 'folder') return `📁 ${o.name}`;
  return '💾 this device';
}

export function syncIcon(s: SyncState): string {
  return { clean: '✓', dirty: '●', saving: '⟳', error: '⚠', conflict: '⚡' }[s];
}

/** Strip anything that must never travel with a published game. Belt and
 *  braces: origins are not stored in the file, but an imported project
 *  from elsewhere might carry these keys, and re-exporting it would then
 *  leak someone else's. */
export function stripSecrets(p: ProjectDef): ProjectDef {
  const dirty = p as unknown as Record<string, unknown>;
  for (const key of ['origin', 'github', 'token', 'pat', 'secrets', 'apiKey', 'api_key']) delete dirty[key];
  return p;
}

export interface GhFile {
  content: string;
  sha: string;
}

/** Read a project file back out of a repository. Kept here rather than in
 *  publish.ts because opening is not publishing. */
export async function readFromGitHub(
  o: Extract<Origin, { kind: 'github' }>,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GhFile> {
  const url = `https://api.github.com/repos/${o.owner}/${o.repo}/contents/${o.path}?ref=${o.branch}`;
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status} — check the repo, branch and path.`);
  const body = (await res.json()) as { content?: string; sha?: string; encoding?: string };
  if (!body.content || !body.sha) throw new Error('That path is not a file.');
  const text = new TextDecoder().decode(
    Uint8Array.from(atob(body.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
  );
  return { content: text, sha: body.sha };
}
