import { describe, expect, it } from 'vitest';
import { Timer, Tween, Velocity, easings } from '../src/entity/behaviors.js';
import type { Entity } from '../src/entity/Entity.js';

// Behaviors only touch numeric fields — a bare object stands in for Entity.
const fakeEntity = (x = 0, y = 0) => ({ x, y }) as unknown as Entity;

describe('easings', () => {
  it('all start at 0 and end at 1', () => {
    for (const ease of Object.values(easings)) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
    }
  });
});

describe('Velocity', () => {
  it('moves the entity by units per second', () => {
    const e = fakeEntity(10, 20);
    const v = new Velocity(100, -50);
    v.update(0.5, e);
    expect(e.x).toBeCloseTo(60);
    expect(e.y).toBeCloseTo(-5);
  });
});

describe('Timer', () => {
  it('fires once after the delay', () => {
    let fires = 0;
    const t = new Timer(1, () => fires++);
    t.update(0.6, fakeEntity());
    expect(fires).toBe(0);
    t.update(0.6, fakeEntity());
    expect(fires).toBe(1);
    expect(t.done).toBe(true);
    t.update(5, fakeEntity());
    expect(fires).toBe(1);
  });

  it('repeats on an interval when asked, catching up across big steps', () => {
    let fires = 0;
    const t = new Timer(0.5, () => fires++, true);
    t.update(0.5, fakeEntity());
    t.update(0.5, fakeEntity());
    expect(fires).toBe(2);
    expect(t.done).toBe(false);
  });
});

describe('Tween', () => {
  it('interpolates numeric properties and calls onDone once', () => {
    const target = { x: 0, alpha: 1 };
    let done = 0;
    const tw = new Tween(target, { x: 100, alpha: 0 }, 1, { ease: easings.linear, onDone: () => done++ });
    tw.update(0.5, fakeEntity());
    expect(target.x).toBeCloseTo(50);
    expect(target.alpha).toBeCloseTo(0.5);
    tw.update(0.5, fakeEntity());
    expect(target.x).toBeCloseTo(100);
    expect(target.alpha).toBeCloseTo(0);
    expect(done).toBe(1);
    expect(tw.done).toBe(true);
  });

  it('honors a start delay', () => {
    const target = { x: 0 };
    const tw = new Tween(target, { x: 10 }, 1, { ease: easings.linear, delay: 1 });
    tw.update(0.9, fakeEntity());
    expect(target.x).toBe(0);
    tw.update(0.6, fakeEntity()); // 0.1s into the tween
    expect(target.x).toBeGreaterThan(0);
    expect(target.x).toBeLessThan(10);
  });
});
