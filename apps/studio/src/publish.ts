/**
 * Publishing — two paths, both author-credentialed and dev-time only:
 *
 * 1. GitHub: push the project JSON into the author's own repository via the
 *    contents API (their fine-grained token, kept in localStorage). Anyone
 *    can then PLAY the game through the Studio player: ?load=<raw-url>&play=1.
 *
 * 2. Interverse world: register the game with an Interverse (IVX) node
 *    (POST /games/register). The returned api_key is dev-time material and
 *    stays on this device; the project only records public fields.
 */
import { PlatformClient } from '@interverse/platform';
import type { ProjectDef } from './model.js';

export const store = {
  ghToken: 'interverse.studio.ghtoken',
  ghRepo: 'interverse.studio.ghrepo',
  worldApi: 'interverse.studio.worldapi',
  devName: 'interverse.studio.devname',
  worldKey: (gameId: string) => `interverse.studio.worldkey.${gameId}`,
};

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'game'
  );
}

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface GitHubTarget {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface PushResult {
  htmlUrl: string;
  rawUrl: string;
  playUrl: string;
}

/** Create-or-update one file in the author's repository. */
export async function pushToGitHub(target: GitHubTarget, content: string): Promise<PushResult> {
  const base = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.path}`;
  const headers = {
    authorization: `Bearer ${target.token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
  };
  // Existing file? Need its sha to update.
  let sha: string | undefined;
  const probe = await fetch(`${base}?ref=${encodeURIComponent(target.branch)}`, { headers });
  if (probe.ok) sha = ((await probe.json()) as { sha?: string }).sha;
  const res = await fetch(base, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Publish from Interverse Studio`,
      content: b64(content),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  const data = (await res.json()) as {
    message?: string;
    content?: { html_url?: string; download_url?: string };
  };
  if (!res.ok) throw new Error(data.message ?? `GitHub ${res.status}`);
  const rawUrl =
    data.content?.download_url ??
    `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${target.path}`;
  const playUrl = `${location.origin}${location.pathname}?load=${encodeURIComponent(rawUrl)}&play=1`;
  return { htmlUrl: data.content?.html_url ?? base, rawUrl, playUrl };
}

export interface WorldResult {
  gameId: string;
  apiKey: string;
}

/** Register the project as a game in the Interverse world. */
export async function registerInWorld(
  project: ProjectDef,
  apiUrl: string,
  developerName: string,
): Promise<WorldResult> {
  const client = new PlatformClient({ apiUrl });
  const gameId = slugify(project.name);
  const res = await client.registerGame({
    game_id: gameId,
    developer_name: developerName,
    game_name: project.name,
    game_metadata: {
      engine: 'interverse-engine',
      studio: true,
      scenes: project.scenes.length,
    },
  });
  const data = res.data ?? ({} as { game_id?: string; api_key?: string });
  if (!data.api_key) throw new Error(res.message ?? 'registration failed');
  // Public wiring goes into the project; the key stays on this device.
  project.platform = { apiUrl, gameId: data.game_id ?? gameId, wallet: project.platform?.wallet ?? '' };
  localStorage.setItem(store.worldKey(gameId), data.api_key);
  return { gameId: data.game_id ?? gameId, apiKey: data.api_key };
}
