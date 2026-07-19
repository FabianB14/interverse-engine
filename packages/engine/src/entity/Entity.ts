import { Container } from 'pixi.js';

export interface Behavior {
  /** Set true to have the entity drop this behavior after the current step. */
  done?: boolean;
  update(dt: number, entity: Entity): void;
}

/**
 * Entity = PixiJS container + optional behaviors (§4.3).
 * Not a full ECS — behaviors are small composable classes with update(dt).
 */
export class Entity extends Container {
  private readonly behaviors: Behavior[] = [];

  addBehavior(behavior: Behavior): this {
    this.behaviors.push(behavior);
    return this;
  }

  removeBehavior(behavior: Behavior): void {
    const i = this.behaviors.indexOf(behavior);
    if (i >= 0) this.behaviors.splice(i, 1);
  }

  /** Called by the owning Scene every fixed step. */
  update(dt: number): void {
    // Snapshot: behaviors may add/remove behaviors while running.
    for (const b of [...this.behaviors]) {
      if (!b.done) b.update(dt, this);
    }
    for (let i = this.behaviors.length - 1; i >= 0; i--) {
      if (this.behaviors[i]?.done) this.behaviors.splice(i, 1);
    }
  }
}
