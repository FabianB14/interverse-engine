import { Circle, Rectangle } from 'pixi.js';
import type { Container, FederatedPointerEvent } from 'pixi.js';

export interface TapOptions {
  /**
   * Circular hit area radius around the object's origin. Oversize this for
   * fat fingers — the spec's 44pt touch-target rule applies to games too.
   */
  hitRadius?: number;
  /** Rectangular hit area (design units, relative to the object). */
  hitRect?: { x: number; y: number; width: number; height: number };
}

/**
 * Make a container tappable (§4.4). Multi-touch friendly: each active
 * pointer dispatches its own pointerdown, so simultaneous taps on different
 * objects all land — party games need simultaneous touches.
 */
export function makeTappable(
  target: Container,
  onTap: (event: FederatedPointerEvent) => void,
  opts: TapOptions = {},
): void {
  target.eventMode = 'static';
  target.cursor = 'pointer';
  if (opts.hitRadius !== undefined) {
    target.hitArea = new Circle(0, 0, opts.hitRadius);
  } else if (opts.hitRect) {
    const r = opts.hitRect;
    target.hitArea = new Rectangle(r.x, r.y, r.width, r.height);
  }
  target.on('pointerdown', onTap);
}
