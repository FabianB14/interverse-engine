/**
 * 👆 Swipes, and the arrow keys that stand in for them at a desk.
 *
 * The rules here are all about what a thumb actually does on glass:
 *
 *   - A swipe fires as soon as it passes the threshold, NOT on release.
 *     Waiting for the finger to lift adds however long the player takes to
 *     let go, which at running speed is the difference between clearing a
 *     barrier and eating it.
 *   - One swipe per gesture. A flick that keeps travelling must not fire
 *     four lane changes.
 *   - The dominant axis wins outright. Diagonals are how humans swipe; a
 *     detector that demands a clean vertical rejects half of them.
 */

import { Container, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Entity } from '../entity/Entity.js';

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

export interface SwipeOptions {
  onSwipe: (dir: SwipeDir) => void;
  /** Fired for a touch that never became a swipe. */
  onTap?: () => void;
  /** How far a thumb must travel, in design units. */
  threshold?: number;
  /** Listening area. Defaults to the whole screen. */
  width?: number;
  height?: number;
  /** Bind arrow keys / WASD too. Default true — a runner has to be playable
   *  at a desk or it cannot be developed at one. */
  keys?: boolean;
}

export const SWIPE_THRESHOLD = 42;

/** Which way a drag went, or null if it did not go far enough yet. */
export function swipeDir(dx: number, dy: number, threshold = SWIPE_THRESHOLD): SwipeDir | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < threshold) return null;
  if (ax >= ay) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export class Swipe extends Entity {
  private startX = 0;
  private startY = 0;
  private tracking = false;
  private fired = false;
  private readonly area = new Container();
  private readonly threshold: number;
  private readonly onSwipe: (dir: SwipeDir) => void;
  private readonly onTap: (() => void) | undefined;
  private readonly keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(opts: SwipeOptions) {
    super();
    this.threshold = opts.threshold ?? SWIPE_THRESHOLD;
    this.onSwipe = opts.onSwipe;
    this.onTap = opts.onTap;

    const w = opts.width ?? 4000;
    const h = opts.height ?? 4000;
    this.area.eventMode = 'static';
    this.area.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
    this.area.on('pointerdown', (e: FederatedPointerEvent) => this.down(e));
    this.area.on('pointermove', (e: FederatedPointerEvent) => this.move(e));
    this.area.on('pointerup', () => this.up());
    this.area.on('pointerupoutside', () => this.up());
    this.addChild(this.area);

    if (opts.keys !== false) {
      this.keyHandler = (e: KeyboardEvent): void => {
        const dir = KEY_DIRS[e.key];
        if (!dir) return;
        // Held keys must not machine-gun lane changes any more than a held
        // thumb does.
        if (e.repeat) return;
        e.preventDefault();
        this.onSwipe(dir);
      };
      window.addEventListener('keydown', this.keyHandler);
    }
  }

  private down(e: FederatedPointerEvent): void {
    this.startX = e.global.x;
    this.startY = e.global.y;
    this.tracking = true;
    this.fired = false;
  }

  private move(e: FederatedPointerEvent): void {
    if (!this.tracking || this.fired) return;
    const dir = swipeDir(e.global.x - this.startX, e.global.y - this.startY, this.threshold);
    if (!dir) return;
    this.fired = true;
    this.onSwipe(dir);
  }

  private up(): void {
    if (this.tracking && !this.fired) this.onTap?.();
    this.tracking = false;
    this.fired = false;
  }

  /** Drop the window-level key listener. A scene that swaps out without
   *  calling this leaks a handler that keeps steering a dead game. */
  dispose(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.dispose();
    super.destroy(options);
  }
}

const KEY_DIRS: Record<string, SwipeDir | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
  ' ': 'up',
};
