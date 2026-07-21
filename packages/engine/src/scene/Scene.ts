import { Container } from 'pixi.js';
import type { Game } from '../app/createGame.js';
import type { Entity } from '../entity/Entity.js';

/**
 * Scene base class (§4.2). Subclasses implement onEnter/onExit/onUpdate.
 * Entities added via add() are updated every fixed step and torn down with
 * the scene.
 */
export abstract class Scene {
  /** Root container for everything this scene draws (design-space coords). */
  readonly stage = new Container();
  protected game!: Game;
  private readonly entities: Entity[] = [];

  /**
   * Add an entity: it joins the update list and a display parent (default
   * the scene stage — pass a sub-layer to control draw order, e.g. a map
   * layer under a UI layer).
   */
  add<T extends Entity>(entity: T, parent?: Container): T {
    this.entities.push(entity);
    (parent ?? this.stage).addChild(entity);
    return entity;
  }

  /** Remove and destroy an entity. */
  remove(entity: Entity): void {
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    if (!entity.destroyed) {
      entity.parent?.removeChild(entity);
      entity.destroy({ children: true });
    }
  }

  /** Called when the scene becomes active. */
  protected onEnter(): void {}
  /** Called before the scene is torn down. */
  protected onExit(): void {}
  /** Per-fixed-step scene logic. dt is the constant step in seconds. */
  protected onUpdate(_dt: number): void {}

  /** @internal Called by SceneManager. */
  _mount(game: Game): void {
    this.game = game;
    this.onEnter();
  }

  /** @internal Called by SceneManager; stage (and children) are destroyed after. */
  _unmount(): void {
    this.onExit();
    this.entities.length = 0;
  }

  /** @internal Fixed-step update from SceneManager. */
  _update(dt: number): void {
    this.onUpdate(dt);
    // Snapshot: updates may add/remove entities mid-iteration.
    for (const e of [...this.entities]) {
      if (!e.destroyed) e.update(dt);
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i]?.destroyed) this.entities.splice(i, 1);
    }
  }
}
