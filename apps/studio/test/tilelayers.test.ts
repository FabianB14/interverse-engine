import { describe, expect, it } from 'vitest';
import { TILE_LAYERS, isTileLayerId, layerBlocks, tileLayerSpec } from '../src/tiles.js';
import { defaultProject, parseProject } from '../src/model.js';

describe('the three layers', () => {
  it('paints back to front', () => {
    expect(TILE_LAYERS.map((l) => l.id)).toEqual(['back', 'main', 'over']);
  });

  /** Decoration that could quietly block the player is the confusion layers
   *  exist to remove, so exactly one layer collides. */
  it('lets only the main layer stop anybody', () => {
    expect(TILE_LAYERS.filter((l) => l.solid).map((l) => l.id)).toEqual(['main']);
    expect(layerBlocks('back')).toBe(false);
    expect(layerBlocks('over')).toBe(false);
    expect(layerBlocks('main')).toBe(true);
  });

  /** Every game made before layers existed is already a main-layer game —
   *  which only holds while main keeps the original field name. */
  it('keeps the original field name for main', () => {
    expect(tileLayerSpec('main').key).toBe('tiles');
  });

  it('falls back to main rather than returning undefined', () => {
    expect(tileLayerSpec('nonsense').id).toBe('main');
    expect(isTileLayerId('over')).toBe(true);
    expect(isTileLayerId('middle')).toBe(false);
  });

  it('explains each one', () => {
    for (const l of TILE_LAYERS) expect(l.hint.length).toBeGreaterThan(20);
  });
});

describe('saving layers', () => {
  const paint = (cols: number, rows: number, ch: string): string[] =>
    Array.from({ length: rows }, (_, r) => (r === 0 ? ch.repeat(cols) : '.'.repeat(cols)));

  it('round-trips a painted decoration layer', () => {
    const p = defaultProject();
    const s = p.scenes[0]!;
    s.tilesOver = paint(s.worldW / 40, s.worldH / 40, 'k');
    const out = parseProject(JSON.stringify(p));
    expect(out.scenes[0]!.tilesOver?.[0]).toMatch(/^k+$/);
  });

  /** A game that never touches the decorative layers should not carry a
   *  screenful of dots for each of them. */
  it('drops a decoration layer that has nothing on it', () => {
    const p = defaultProject();
    const s = p.scenes[0]!;
    s.tilesBack = paint(s.worldW / 40, s.worldH / 40, '.');
    s.tilesOver = paint(s.worldW / 40, s.worldH / 40, '.');
    const out = parseProject(JSON.stringify(p));
    expect('tilesBack' in out.scenes[0]!).toBe(false);
    expect('tilesOver' in out.scenes[0]!).toBe(false);
  });

  it('leaves a project with no layers alone', () => {
    const out = parseProject(JSON.stringify(defaultProject()));
    expect('tilesBack' in out.scenes[0]!).toBe(false);
    expect('tilesOver' in out.scenes[0]!).toBe(false);
  });

  it('resizes a decoration layer to the level, like the main one', () => {
    const p = defaultProject();
    const s = p.scenes[0]!;
    s.tilesOver = ['kk', 'kk'];
    const out = parseProject(JSON.stringify(p));
    expect(out.scenes[0]!.tilesOver).toHaveLength(s.worldH / 40);
    expect(out.scenes[0]!.tilesOver![0]).toHaveLength(s.worldW / 40);
  });
});
