import { describe, expect, it } from 'vitest';
import { fitTransform } from '../src/models.js';

describe('model fitting', () => {
  it('scales a model to the stated height', () => {
    const fit = fitTransform({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } }, 100);
    expect(fit.scale).toBe(50);
  });

  it('puts the feet on the floor wherever the exporter left the origin', () => {
    // Origin at the model's centre — common Blender export.
    const centred = fitTransform({ min: { x: 0, y: -3, z: 0 }, max: { x: 0, y: 3, z: 0 } }, 60);
    expect(centred.offsetY).toBeCloseTo(30);
    // Origin already at the feet: nothing to do.
    const grounded = fitTransform({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 6, z: 0 } }, 60);
    expect(grounded.offsetY).toBe(0);
    // Origin floating above: pull it DOWN.
    const floating = fitTransform({ min: { x: 0, y: 2, z: 0 }, max: { x: 0, y: 8, z: 0 } }, 60);
    expect(floating.offsetY).toBeCloseTo(-20);
  });

  it('keeps the file scale when no height is asked for', () => {
    const fit = fitTransform({ min: { x: 0, y: 1, z: 0 }, max: { x: 0, y: 4, z: 0 } });
    expect(fit.scale).toBe(1);
    expect(fit.offsetY).toBe(-1);
  });

  it('does not divide by a flat model', () => {
    const fit = fitTransform({ min: { x: 0, y: 5, z: 0 }, max: { x: 9, y: 5, z: 9 } }, 100);
    expect(fit.scale).toBe(1);
  });
});
