import { describe, expect, it } from 'vitest';
import { VFX_PRESETS, stepParticle } from '../src/art/particles.js';

describe('VFX presets', () => {
  it('every preset is well-formed', () => {
    for (const spec of Object.values(VFX_PRESETS)) {
      expect(spec.count).toBeGreaterThan(0);
      expect(spec.count).toBeLessThanOrEqual(40); // phone-friendly
      expect(spec.life[0]).toBeGreaterThan(0);
      expect(spec.life[1]).toBeGreaterThanOrEqual(spec.life[0]);
      expect(spec.speed[1]).toBeGreaterThanOrEqual(spec.speed[0]);
      expect(spec.colors.length).toBeGreaterThan(0);
    }
  });
});

describe('stepParticle', () => {
  const particle = () => ({
    g: { x: 0, y: 0, rotation: 0, alpha: 1 } as never,
    vx: 100,
    vy: -50,
    spin: 2,
    life: 1,
    age: 0,
  });

  it('integrates position, gravity, spin, and fades alpha to zero', () => {
    const p = particle();
    stepParticle(p, 500, 0.5);
    const g = p.g as unknown as { x: number; y: number; rotation: number; alpha: number };
    expect(g.x).toBeCloseTo(50);
    expect(g.y).toBeCloseTo(100); // vy: -50 + 500*0.5 = 200, then y += 200*0.5
    expect(g.rotation).toBeCloseTo(1);
    expect(g.alpha).toBeCloseTo(0.5);
    stepParticle(p, 500, 0.5);
    expect(g.alpha).toBe(0);
    expect(p.age).toBeCloseTo(1);
  });
});
