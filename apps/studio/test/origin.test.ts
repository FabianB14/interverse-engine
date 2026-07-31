import { beforeEach, describe, expect, it } from 'vitest';
import { getOrigin, originLabel, projectId, readFromGitHub, setOrigin, stripSecrets, syncIcon } from '../src/origin.js';
import { defaultProject } from '../src/model.js';

beforeEach(() => localStorage.clear());

describe('project identity', () => {
  it('mints an id once and keeps it', () => {
    const p = defaultProject();
    const id = projectId(p);
    expect(id).toBeTruthy();
    expect(projectId(p)).toBe(id);
  });

  it('gives different projects different ids', () => {
    expect(projectId(defaultProject())).not.toBe(projectId(defaultProject()));
  });
});

describe('where a project lives', () => {
  it('round-trips each kind of origin', () => {
    const p = defaultProject();
    setOrigin(p, { kind: 'github', owner: 'me', repo: 'games', branch: 'main', path: 'a.json' });
    expect(getOrigin(p)).toEqual({ kind: 'github', owner: 'me', repo: 'games', branch: 'main', path: 'a.json' });
    setOrigin(p, { kind: 'device', slot: 'My Game' });
    expect(getOrigin(p)!.kind).toBe('device');
  });

  it('keeps two projects separate', () => {
    const a = defaultProject();
    const b = defaultProject();
    setOrigin(a, { kind: 'device', slot: 'A' });
    expect(getOrigin(b)).toBeNull();
  });

  it('forgets on null', () => {
    const p = defaultProject();
    setOrigin(p, { kind: 'device', slot: 'x' });
    setOrigin(p, null);
    expect(getOrigin(p)).toBeNull();
  });

  it('survives a corrupt store instead of failing to boot', () => {
    localStorage.setItem('interverse.studio.origins', '{not json');
    expect(getOrigin(defaultProject())).toBeNull();
  });

  it('labels each kind for the toolbar', () => {
    expect(originLabel(null)).toMatch(/device/);
    expect(originLabel({ kind: 'github', owner: 'me', repo: 'g', branch: 'dev', path: 'x' })).toBe('me/g@dev');
    expect(originLabel({ kind: 'folder', name: 'Games' })).toContain('Games');
    expect(syncIcon('conflict')).toBeTruthy();
  });
});

/** spec §8.4 — no credentials ship with a game. The origin is stored on the
 *  device precisely so it cannot ride along in a published file. */
describe('published files carry no secrets', () => {
  it('never writes the origin into the project', () => {
    const p = defaultProject();
    setOrigin(p, { kind: 'github', owner: 'me', repo: 'g', branch: 'main', path: 'a.json' });
    const json = JSON.stringify(p);
    expect(json).not.toContain('github');
    expect(json).not.toContain('"owner"');
  });

  it('strips credential keys an imported file might carry', () => {
    const dirty = { ...defaultProject(), token: 'ghp_secret', origin: { x: 1 }, api_key: 'k' } as never;
    const clean = stripSecrets(dirty) as unknown as Record<string, unknown>;
    expect('token' in clean).toBe(false);
    expect('origin' in clean).toBe(false);
    expect('api_key' in clean).toBe(false);
    expect(JSON.stringify(clean)).not.toContain('ghp_secret');
  });
});

describe('reading a project back out of a repo', () => {
  const origin = { kind: 'github', owner: 'me', repo: 'g', branch: 'main', path: 'a.json' } as const;

  it('decodes base64 contents', async () => {
    const fake = (async () =>
      ({
        ok: true,
        json: async () => ({ content: btoa('{"hello":1}'), sha: 'abc' }),
      }) as unknown as Response) as unknown as typeof fetch;
    const file = await readFromGitHub(origin, 't', fake);
    expect(file.content).toBe('{"hello":1}');
    expect(file.sha).toBe('abc');
  });

  it('explains an HTTP failure instead of throwing something opaque', async () => {
    const fake = (async () => ({ ok: false, status: 404 }) as unknown as Response) as unknown as typeof fetch;
    await expect(readFromGitHub(origin, 't', fake)).rejects.toThrow(/404/);
  });

  it('rejects a directory rather than importing nothing', async () => {
    const fake = (async () =>
      ({ ok: true, json: async () => [{ name: 'a' }] }) as unknown as Response) as unknown as typeof fetch;
    await expect(readFromGitHub(origin, 't', fake)).rejects.toThrow(/not a file/);
  });
});
