import { describe, expect, it } from 'vitest';
import { swipeDir, wrapAngle } from '../src/index.js';

// The renderer-coupled edges of the runner kit: swipe reading (the Swipe
// entity is a Pixi container) and the rolling-blob angle wrap. The pure
// runner logic is tested in @interverse/core.
describe('swipes', () => {
  it('ignores a drag that has not committed yet', () => {
    expect(swipeDir(5, 3)).toBeNull();
  });

  it('lets the dominant axis win, because nobody swipes straight', () => {
    expect(swipeDir(80, 30)).toBe('right');
    expect(swipeDir(30, 80)).toBe('down');
    expect(swipeDir(-80, -30)).toBe('left');
    expect(swipeDir(-30, -80)).toBe('up');
  });
});

describe('rolling', () => {
  it('keeps the angle small so a long run cannot go jittery', () => {
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5);
    expect(wrapAngle(-0.5)).toBeCloseTo(Math.PI * 2 - 0.5);
    expect(wrapAngle(1e7)).toBeLessThan(Math.PI * 2);
    expect(wrapAngle(1e7)).toBeGreaterThanOrEqual(0);
  });
});
