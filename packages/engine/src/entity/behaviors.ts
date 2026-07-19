import type { Container } from 'pixi.js';
import type { Behavior, Entity } from './Entity.js';

export type Ease = (t: number) => number;

export const easings = {
  linear: (t: number): number => t,
  inQuad: (t: number): number => t * t,
  outQuad: (t: number): number => 1 - (1 - t) ** 2,
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Ease>;

/** Moves the entity by (vx, vy) design-units per second. */
export class Velocity implements Behavior {
  constructor(
    public vx = 0,
    public vy = 0,
  ) {}

  update(dt: number, entity: Entity): void {
    entity.x += this.vx * dt;
    entity.y += this.vy * dt;
  }
}

/** Fires a callback after `delay` seconds; optionally repeats. */
export class Timer implements Behavior {
  done = false;
  private elapsed = 0;

  constructor(
    private readonly delay: number,
    private readonly onFire: () => void,
    private readonly repeat = false,
  ) {}

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= this.delay) {
      if (this.repeat) {
        this.elapsed -= this.delay;
      } else {
        this.done = true;
      }
      this.onFire();
    }
  }
}

type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;

export interface TweenOptions {
  ease?: Ease;
  delay?: number;
  onDone?: () => void;
}

/**
 * Interpolates numeric properties on any object (positions, scale, alpha…)
 * from their current values to `to` over `duration` seconds.
 */
export class Tween<T extends object> implements Behavior {
  done = false;
  private elapsed = 0;
  private delayLeft: number;
  private from: Record<string, number> | null = null;
  private readonly ease: Ease;
  private readonly onDone: (() => void) | undefined;

  constructor(
    private readonly target: T,
    private readonly to: Partial<Record<NumericKeys<T>, number>>,
    private readonly duration: number,
    opts: TweenOptions = {},
  ) {
    this.ease = opts.ease ?? easings.outQuad;
    this.delayLeft = opts.delay ?? 0;
    this.onDone = opts.onDone;
  }

  update(dt: number): void {
    if (this.done) return;
    if (this.delayLeft > 0) {
      this.delayLeft -= dt;
      if (this.delayLeft > 0) return;
    }
    const record = this.target as unknown as Record<string, number>;
    if (!this.from) {
      // Capture start values lazily so chained tweens read fresh state.
      this.from = {};
      for (const key of Object.keys(this.to)) this.from[key] = record[key] ?? 0;
    }
    this.elapsed += dt;
    const raw = this.duration <= 0 ? 1 : Math.min(1, this.elapsed / this.duration);
    const k = this.ease(raw);
    for (const [key, end] of Object.entries(this.to)) {
      if (typeof end !== 'number') continue;
      const start = this.from[key] ?? 0;
      record[key] = start + (end - start) * k;
    }
    if (raw >= 1) {
      this.done = true;
      this.onDone?.();
    }
  }
}

export interface WobbleOptions {
  /** Oscillation speed (radians/second). Default 3. */
  speed?: number;
  /** Scale deviation, e.g. 0.05 = ±5%. Default 0.03. */
  amount?: number;
  /** Container to wobble; defaults to the entity itself. */
  target?: Container;
  /** Starting phase — randomize to de-sync a crowd. */
  phase?: number;
}

/** Idle squash/stretch breathing — cozy games live and die on juice (§4.5). */
export class Wobble implements Behavior {
  private t: number;
  private base: { x: number; y: number } | null = null;
  private readonly speed: number;
  private readonly amount: number;
  private readonly target: Container | undefined;

  constructor(opts: WobbleOptions = {}) {
    this.t = opts.phase ?? 0;
    this.speed = opts.speed ?? 3;
    this.amount = opts.amount ?? 0.03;
    this.target = opts.target;
  }

  update(dt: number, entity: Entity): void {
    const target = this.target ?? entity;
    if (!this.base) this.base = { x: target.scale.x, y: target.scale.y };
    this.t += dt * this.speed;
    const s = Math.sin(this.t) * this.amount;
    target.scale.set(this.base.x * (1 + s), this.base.y * (1 - s));
  }
}
