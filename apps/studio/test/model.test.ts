import { describe, expect, it } from 'vitest';
import { defaultEntity, defaultProject, parseProject } from '../src/model.js';

const roundTrip = (mutate: (p: ReturnType<typeof defaultProject>) => void) => {
  const p = defaultProject();
  mutate(p);
  return parseProject(JSON.stringify(p));
};

describe('defaultEntity', () => {
  it('gives kinds their combat presets', () => {
    expect(defaultEntity('mob', 0, 0)).toMatchObject({ hp: 3, behavior: 'chase', shootEvery: 0 });
    expect(defaultEntity('boss', 0, 0)).toMatchObject({ hp: 25, xp: 50, behavior: 'guard' });
    expect(defaultEntity('npc', 0, 0).lines.length).toBeGreaterThan(0);
    expect(defaultEntity('button', 0, 0).tapSound).toBe('blip');
  });
});

describe('parseProject', () => {
  it('rejects hopeless input', () => {
    expect(() => parseProject('{"scenes": []}')).toThrow();
    expect(() => parseProject('"nope"')).toThrow();
  });

  it("migrates the legacy 'side' view into top-down + gravity", () => {
    const p = roundTrip((proj) => {
      (proj.scenes[0]! as { view: string }).view = 'side';
    });
    expect(p.scenes[0]!.view).toBe('top');
    expect(p.scenes[0]!.gravity).toBe(true);
  });

  it('forces 2.5D boards to one landscape screen tall (720)', () => {
    const p = roundTrip((proj) => {
      proj.scenes[0]!.view = 'depth';
      proj.scenes[0]!.worldH = 2560;
    });
    expect(p.scenes[0]!.worldH).toBe(720);
  });

  it('clamps world sizes to the supported range', () => {
    const p = roundTrip((proj) => {
      proj.scenes[0]!.worldW = 99999;
      proj.scenes[0]!.worldH = 10;
    });
    expect(p.scenes[0]!.worldW).toBe(2880);
    expect(p.scenes[0]!.worldH).toBe(720);
  });

  it('repairs unknown mob behaviors to chase', () => {
    const p = roundTrip((proj) => {
      const mob = defaultEntity('mob', 100, 100);
      (mob as { behavior: string }).behavior = 'zigzag';
      proj.scenes[0]!.entities.push(mob);
    });
    const mob = p.scenes[0]!.entities.find((e) => e.kind === 'mob')!;
    expect(mob.behavior).toBe('chase');
  });

  it('fills missing entity fields with defaults (old saves stay loadable)', () => {
    const p = roundTrip((proj) => {
      // simulate a save from before combat existed
      proj.scenes[0]!.entities.push({ kind: 'blob', name: 'Old', x: 1, y: 2 } as never);
    });
    const old = p.scenes[0]!.entities.find((e) => e.name === 'Old')!;
    expect(old.hp).toBe(3);
    expect(old.scale).toBe(1);
    expect(old.behavior).toBe('chase');
  });

  it('repoints startScene at a real scene', () => {
    const p = roundTrip((proj) => {
      proj.startScene = 'ghost';
    });
    expect(p.scenes.some((s) => s.id === p.startScene)).toBe(true);
  });

  it('normalizes painted tiles to the world dimensions', () => {
    const p = roundTrip((proj) => {
      proj.scenes[0]!.worldW = 720;
      proj.scenes[0]!.worldH = 1280;
      proj.scenes[0]!.tiles = ['ggg']; // far too small
    });
    const tiles = p.scenes[0]!.tiles!;
    expect(tiles.length).toBe(32); // 1280 / 40
    expect(tiles[0]!.length).toBe(18); // 720 / 40
  });
});

describe('3D mode + actor slots', () => {
  it('keeps the 3d view through a save/load round trip', () => {
    const proj = defaultProject();
    proj.scenes[0]!.view = '3d';
    const back = parseProject(JSON.stringify(proj))!;
    expect(back.scenes[0]!.view).toBe('3d');
  });

  it('gives every new actor empty model/anim/sfx/vfx slots', () => {
    const e = defaultEntity('mob', 0, 0);
    expect(e.model3d).toBe('');
    expect(e.animIdle).toBe('');
    expect(e.animMove).toBe('');
    expect(e.sfxSlot).toEqual([]);
    expect(e.vfxSlot).toEqual([]);
  });

  it('repairs pre-slot projects to defaults instead of undefined', () => {
    const proj = defaultProject();
    const raw = JSON.parse(JSON.stringify(proj)) as Record<string, unknown>;
    for (const sc of (raw.scenes as { entities: Record<string, unknown>[] }[])) {
      for (const e of sc.entities) {
        delete e.model3d;
        delete e.animIdle;
        delete e.animMove;
        delete e.sfxSlot;
        delete e.vfxSlot;
      }
    }
    const back = parseProject(JSON.stringify(raw))!;
    const e = back.scenes[0]!.entities[0]!;
    expect(e.model3d).toBe('');
    expect(e.sfxSlot).toEqual([]);
    expect(e.vfxSlot).toEqual([]);
  });

  it('drops slot rows with unknown events instead of keeping garbage', () => {
    const proj = defaultProject();
    const e = proj.scenes[0]!.entities[0]!;
    (e as { sfxSlot: unknown }).sfxSlot = [
      { on: 'hit', sound: 'pop' },
      { on: 'explode', sound: 'pop' },
      'junk',
    ];
    const back = parseProject(JSON.stringify(proj))!;
    expect(back.scenes[0]!.entities[0]!.sfxSlot).toEqual([{ on: 'hit', sound: 'pop' }]);
  });
});

describe('3D kinds', () => {
  it('gives a shape its primitive and honest sizes', () => {
    const s = defaultEntity('shape', 100, 200);
    expect(s.shapeType).toBe('box');
    expect(s.sizeX).toBeGreaterThan(0);
    expect(s.sizeH).toBeGreaterThan(0);
  });

  it('gives a camera an eye height and a distance', () => {
    const c = defaultEntity('camera', 0, 0);
    expect(c.camHeight).toBeGreaterThan(0);
    expect(c.camDist).toBeGreaterThan(0);
  });

  it('round-trips 3D kinds through save and load', () => {
    const p = defaultProject();
    p.scenes[0]!.entities.push(defaultEntity('shape', 50, 60), defaultEntity('camera', 70, 80));
    const back = parseProject(JSON.stringify(p))!;
    const kinds = back.scenes[0]!.entities.map((e) => e.kind);
    expect(kinds).toContain('shape');
    expect(kinds).toContain('camera');
  });
});
