import { Tween, easings } from '../entity/behaviors.js';
import type { TweenOptions } from '../entity/behaviors.js';
import type { Entity } from '../entity/Entity.js';

/**
 * Procedural animation helpers (§4.5). These assume the entity's resting
 * scale is 1 — attach them to a wrapper entity if you scale the art itself.
 */

/** Spawn pop: scale 0 → 1 with a springy overshoot. */
export function popIn(entity: Entity, opts: { duration?: number } = {}): void {
  const duration = opts.duration ?? 0.35;
  entity.scale.set(0.01);
  entity.addBehavior(new Tween(entity.scale, { x: 1, y: 1 }, duration, { ease: easings.outBack }));
}

/** Squash-and-stretch impact: flatten, then spring back to rest. */
export function squash(
  entity: Entity,
  opts: { amount?: number; duration?: number; onDone?: () => void } = {},
): void {
  const amount = opts.amount ?? 0.35;
  const duration = opts.duration ?? 0.2;
  const settle: TweenOptions = { ease: easings.outBack };
  if (opts.onDone) settle.onDone = opts.onDone;
  entity.addBehavior(
    new Tween(entity.scale, { x: 1 + amount, y: 1 - amount }, duration * 0.35, {
      ease: easings.outQuad,
      onDone: () =>
        entity.addBehavior(new Tween(entity.scale, { x: 1, y: 1 }, duration * 0.65, settle)),
    }),
  );
}
