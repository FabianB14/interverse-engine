import { describe, expect, it } from 'vitest';
import { anchorFor, moveHudPart, place } from '../src/hud.js';
import { HUD_PARTS, defaultHud, defaultProject, hudPos, isDefaultHud, normalizeHud, parseProject } from '../src/model.js';

const W = 720;
const H = 1280;

/** The layout the engine drew before it was data. If this snapshot changes,
 *  every existing game's HUD moves — so it changes only on purpose. */
describe('the default layout', () => {
  it('matches what the engine has always drawn', () => {
    const d = defaultHud();
    expect(d.parts.hearts).toEqual({ anchor: 'top-left', dx: 16, dy: 12, scale: 1, show: true });
    expect(d.parts.score.anchor).toBe('top-right');
    expect(d.parts.abilities.anchor).toBe('bottom-right');
    expect(d.parts.joystick).toEqual({ anchor: 'bottom-left', dx: 150, dy: 170, scale: 1, show: true });
    expect(d.safeTop).toBe(0);
  });

  it('covers every part the runtime places', () => {
    expect(Object.keys(defaultHud().parts).sort()).toEqual([...HUD_PARTS].sort());
  });
});

describe('resolving a position', () => {
  it('measures inward from each corner', () => {
    expect(hudPos({ anchor: 'top-left', dx: 16, dy: 12, scale: 1, show: true }, W, H)).toEqual({ x: 16, y: 12 });
    expect(hudPos({ anchor: 'top-right', dx: 16, dy: 12, scale: 1, show: true }, W, H)).toEqual({ x: 704, y: 12 });
    expect(hudPos({ anchor: 'bottom-left', dx: 20, dy: 40, scale: 1, show: true }, W, H)).toEqual({ x: 20, y: 1240 });
    expect(hudPos({ anchor: 'bottom-right', dx: 20, dy: 40, scale: 1, show: true }, W, H)).toEqual({ x: 700, y: 1240 });
  });

  it('centres relative to the middle', () => {
    expect(hudPos({ anchor: 'top-center', dx: 0, dy: 16, scale: 1, show: true }, W, H).x).toBe(360);
    expect(hudPos({ anchor: 'top-center', dx: 40, dy: 16, scale: 1, show: true }, W, H).x).toBe(400);
  });

  /** The reason anchors exist: the same layout on a different screen. */
  it('keeps a corner piece in its corner on a wide screen', () => {
    const el = { anchor: 'bottom-right', dx: 84, dy: 96, scale: 1, show: true } as const;
    expect(hudPos(el, 1440, 720, 0, 0)).toEqual({ x: 1356, y: 624 });
  });

  it('pushes pieces clear of a notch and a home bar', () => {
    const top = { anchor: 'top-left', dx: 16, dy: 12, scale: 1, show: true } as const;
    const bottom = { anchor: 'bottom-left', dx: 16, dy: 12, scale: 1, show: true } as const;
    expect(hudPos(top, W, H, 60, 40).y).toBe(72);
    expect(hudPos(bottom, W, H, 60, 40).y).toBe(1228);
  });
});

describe('dropping a piece', () => {
  it('snaps to the nearest corner', () => {
    expect(anchorFor(10, 10, W, H)).toBe('top-left');
    expect(anchorFor(700, 10, W, H)).toBe('top-right');
    expect(anchorFor(360, 10, W, H)).toBe('top-center');
    expect(anchorFor(10, 1200, W, H)).toBe('bottom-left');
    expect(anchorFor(700, 1200, W, H)).toBe('bottom-right');
  });

  /** Drop it, resolve it, and it should land where you dropped it. */
  it('round-trips: placing then resolving returns the same point', () => {
    for (const [x, y] of [[40, 30], [690, 40], [360, 60], [50, 1240], [680, 1200], [360, 1250]] as const) {
      const el = { ...place(x, y, W, H), scale: 1, show: true };
      const back = hudPos(el, W, H);
      expect(back.x, `x for ${x},${y}`).toBe(x);
      expect(back.y, `y for ${x},${y}`).toBe(y);
    }
  });

  it('measures from inside the safe area', () => {
    const el = place(100, 100, W, H, 60, 0);
    expect(el.anchor).toBe('top-left');
    expect(el.dy).toBe(40); // 100 on screen is 40 below a 60 inset
    expect(hudPos({ ...el, scale: 1, show: true }, W, H, 60, 0).y).toBe(100);
  });

  it('moves a part through the helper the playtest uses', () => {
    const p = defaultProject();
    const el = moveHudPart(p, 'hearts', 700, 1200);
    expect(el.anchor).toBe('bottom-right');
    expect(p.hud!.parts.hearts.anchor).toBe('bottom-right');
  });
});

describe('saving', () => {
  it('leaves an untouched HUD out of the file entirely', () => {
    expect(isDefaultHud(defaultHud())).toBe(true);
    expect(parseProject(JSON.stringify(defaultProject())).hud).toBeUndefined();
  });

  it('keeps a customised one', () => {
    const p = defaultProject();
    moveHudPart(p, 'joystick', 690, 1210);
    p.hud!.safeTop = 44;
    const out = parseProject(JSON.stringify(p));
    expect(out.hud!.parts.joystick.anchor).toBe('bottom-right');
    expect(out.hud!.safeTop).toBe(44);
  });

  it('repairs junk rather than dropping the layout', () => {
    const out = normalizeHud({ parts: { hearts: { anchor: 'nowhere', dx: 'x', scale: 99 }, ghost: {} }, safeTop: -50 });
    expect(out.parts.hearts.anchor).toBe('top-left'); // fell back
    expect(out.parts.hearts.dx).toBe(16);
    expect(out.parts.hearts.scale).toBeLessThanOrEqual(2.5);
    expect(out.safeTop).toBe(0);
  });

  it('accepts a missing table', () => {
    expect(isDefaultHud(normalizeHud(undefined))).toBe(true);
    expect(isDefaultHud(normalizeHud(null))).toBe(true);
  });
});
