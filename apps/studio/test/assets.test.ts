import { describe, expect, it } from 'vitest';
import {
  assetBytes, assetList, assetUsers, assignAsset, dataUrlBytes, deleteAsset,
  formatBytes, frameCount, frameRect, guessFrameSize, importRejectReason, unusedAssets,
} from '../src/assets.js';
import { defaultEntity, defaultProject } from '../src/model.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

function withArt() {
  const p = defaultProject();
  p.assets = { hero: PNG, unused: PNG };
  const e = p.scenes[0]!.entities[0]!;
  e.kind = 'image';
  e.assetId = 'hero';
  return p;
}

describe('byte accounting', () => {
  it('measures a base64 data URL, padding included', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/png;base64,AA==')).toBe(1);
  });

  it('handles a non-base64 URL and junk without throwing', () => {
    expect(dataUrlBytes('data:image/svg+xml,%3Csvg%3E')).toBe(5);
    expect(dataUrlBytes('nonsense')).toBe(0);
  });

  it('totals the project', () => {
    expect(assetBytes(withArt())).toBe(dataUrlBytes(PNG) * 2);
  });

  it('formats sizes the way a person reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('who uses what', () => {
  it('finds actors and script references', () => {
    const p = withArt();
    p.scenes[0]!.script = "api.ability('X', { icon: '@hero' }, function () {});";
    expect(assetUsers(p, 'hero')).toEqual([p.scenes[0]!.entities[0]!.name, 'Level 1 (script)']);
  });

  it('reports unused art, which is what bloats a published game', () => {
    expect(unusedAssets(withArt())).toEqual(['unused']);
    expect(assetList(withArt()).find((a) => a.id === 'hero')!.users).toBe(1);
  });
});

describe('deleting and reusing', () => {
  it('blanks every reference so no actor points at a missing picture', () => {
    const p = withArt();
    expect(deleteAsset(p, 'hero')).toBe(1);
    expect(p.assets.hero).toBeUndefined();
    expect(p.scenes[0]!.entities[0]!.assetId).toBe('');
  });

  it('reuses one picture on a second actor', () => {
    const p = withArt();
    p.scenes[0]!.entities.push({ ...defaultEntity('crate', 100, 100), name: 'Box' });
    expect(assignAsset(p, 'Box', 'hero')).toBe(true);
    const box = p.scenes[0]!.entities.find((e) => e.name === 'Box')!;
    expect(box.kind).toBe('image');
    expect(box.assetId).toBe('hero');
    expect(assetUsers(p, 'hero')).toHaveLength(2);
  });

  it('refuses to assign art that does not exist', () => {
    expect(assignAsset(withArt(), 'Hero', 'ghost')).toBe(false);
  });
});

/** The overlay in the dialog and the runtime both read frameRect, so a
 *  disagreement here is a frame that looks right and plays wrong. */
describe('spritesheet slicing', () => {
  it('walks frames left-to-right, top-to-bottom', () => {
    expect(frameRect(128, 64, 32, 32, 0)).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(frameRect(128, 64, 32, 32, 3)).toEqual({ x: 96, y: 0, w: 32, h: 32 });
    expect(frameRect(128, 64, 32, 32, 4)).toEqual({ x: 0, y: 32, w: 32, h: 32 });
    expect(frameCount(128, 64, 32, 32)).toBe(8);
  });

  it('ignores a remainder rather than emitting a clipped frame', () => {
    expect(frameCount(100, 32, 32, 32)).toBe(3);
    expect(frameRect(100, 32, 32, 32, 3)).toBeNull();
  });

  it('refuses nonsense sizes instead of dividing by zero', () => {
    expect(frameCount(64, 64, 0, 32)).toBe(0);
    expect(frameRect(64, 64, 128, 128, 0)).toBeNull();
    expect(frameRect(64, 64, 32, 32, -1)).toBeNull();
  });

  it('guesses a square frame from a strip', () => {
    expect(guessFrameSize(512, 64)).toEqual({ frameW: 64, frameH: 64 });
  });

  /** A square sheet has no single right answer, so the guess just has to
   *  be conventional and easy to fix by eye — 4+ columns, largest first. */
  it('guesses a conventional grid for a square sheet', () => {
    expect(guessFrameSize(256, 256)).toEqual({ frameW: 64, frameH: 64 });
    // 128x64 is a two-frame strip, which the strip rule catches first.
    expect(guessFrameSize(128, 64)).toEqual({ frameW: 64, frameH: 64 });
  });

  it('calls an odd-sized picture a single image rather than guessing wrong', () => {
    expect(guessFrameSize(97, 53)).toEqual({ frameW: 0, frameH: 0 });
    expect(guessFrameSize(0, 0)).toEqual({ frameW: 0, frameH: 0 });
  });
});

describe('what we accept', () => {
  it('takes the raster formats the engine can draw', () => {
    expect(importRejectReason('hero.png', 'image/png')).toBeNull();
    expect(importRejectReason('hero.WEBP', 'image/webp')).toBeNull();
    expect(importRejectReason('x', 'image/jpeg')).toBeNull();
  });

  it('explains a 3D model instead of silently failing', () => {
    expect(importRejectReason('hero.glb', '')).toMatch(/2D/);
    expect(importRejectReason('hero.fbx', '')).toMatch(/spritesheet/);
  });

  it('says what to do about GIF and SVG', () => {
    expect(importRejectReason('run.gif', 'image/gif')).toMatch(/spritesheet/);
    expect(importRejectReason('logo.svg', 'image/svg+xml')).toMatch(/PNG/);
  });
});
