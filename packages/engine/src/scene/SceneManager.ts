import { Container, Graphics } from 'pixi.js';
import type { Game } from '../app/createGame.js';
import type { Scene } from './Scene.js';

export interface TransitionOptions {
  /**
   * Total fade duration in seconds (half out, half in). 0 switches
   * instantly. Defaults to 0.3, or instant when there is no current scene.
   */
  fade?: number;
}

interface FadeState {
  phase: 'out' | 'in';
  t: number;
  duration: number;
  action: (() => void) | null;
}

/** Scene stack with push/pop/replace and a fade transition (§4.2). */
export class SceneManager {
  private readonly stack: Scene[] = [];
  private readonly sceneLayer = new Container();
  private readonly fadeOverlay = new Graphics();
  private game: Game | null = null;
  private fade: FadeState | null = null;
  /** Latest request made mid-transition; runs once the current fade ends. */
  private pending: { action: () => void; opts: TransitionOptions } | null = null;

  private viewW: number;
  private viewH: number;

  constructor(width: number, height: number) {
    this.viewW = width;
    this.viewH = height;
    this.fadeOverlay.rect(0, 0, width, height).fill(0x000000);
    this.fadeOverlay.alpha = 0;
    this.fadeOverlay.visible = false;
  }

  /** @internal Called by createGame once the world exists. */
  _attach(world: Container, game: Game): void {
    this.game = game;
    world.addChild(this.sceneLayer, this.fadeOverlay);
  }

  get current(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  get isTransitioning(): boolean {
    return this.fade !== null;
  }

  /** Swap the top scene for a new one. */
  replace(scene: Scene, opts: TransitionOptions = {}): void {
    this.transitionTo(() => {
      const old = this.stack.pop();
      if (old) this.unmount(old);
      this.mount(scene);
    }, opts);
  }

  /** Layer a scene on top (the one below stops updating but stays visible). */
  push(scene: Scene, opts: TransitionOptions = {}): void {
    this.transitionTo(() => this.mount(scene), opts);
  }

  /** Remove the top scene, revealing the one below. */
  pop(opts: TransitionOptions = {}): void {
    this.transitionTo(() => {
      const old = this.stack.pop();
      if (old) this.unmount(old);
    }, opts);
  }

  /** @internal Viewport changed (adaptive mode) — reflow the active scene. */
  _resize(w: number, h: number): void {
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w;
    this.viewH = h;
    this.fadeOverlay.clear();
    this.fadeOverlay.rect(0, 0, w, h).fill(0x000000);
    this.current?._resizeHook(w, h);
  }

  /** @internal Fixed-timestep update from the game loop. */
  _update(dt: number): void {
    const fade = this.fade;
    if (fade) {
      fade.t += dt;
      const k = fade.duration <= 0 ? 1 : Math.min(1, fade.t / fade.duration);
      if (fade.phase === 'out') {
        this.fadeOverlay.alpha = k;
        if (k >= 1) {
          fade.action?.();
          fade.action = null;
          fade.phase = 'in';
          fade.t = 0;
        }
      } else {
        this.fadeOverlay.alpha = 1 - k;
        if (k >= 1) {
          this.fade = null;
          this.fadeOverlay.visible = false;
          this.fadeOverlay.eventMode = 'auto';
          if (this.pending) {
            const next = this.pending;
            this.pending = null;
            this.transitionTo(next.action, next.opts);
          }
        }
      }
    }
    this.current?._update(dt);
  }

  /** @internal */
  _destroy(): void {
    while (this.stack.length > 0) {
      const s = this.stack.pop();
      if (s) this.unmount(s);
    }
  }

  private transitionTo(action: () => void, opts: TransitionOptions): void {
    if (this.fade) {
      // Queue (latest wins) rather than silently dropping the request —
      // async flows (e.g. a network join resolving) legitimately land
      // mid-fade.
      this.pending = { action, opts };
      return;
    }
    const total = opts.fade ?? (this.current ? 0.3 : 0);
    if (total <= 0) {
      action();
      return;
    }
    this.fade = { phase: 'out', t: 0, duration: total / 2, action };
    this.fadeOverlay.visible = true;
    this.fadeOverlay.alpha = 0;
    // Swallow input while fading so taps can't double-trigger scene changes.
    this.fadeOverlay.eventMode = 'static';
  }

  private mount(scene: Scene): void {
    if (!this.game) throw new Error('SceneManager used before createGame() attached it');
    this.stack.push(scene);
    this.sceneLayer.addChild(scene.stage);
    scene._mount(this.game);
  }

  private unmount(scene: Scene): void {
    scene._unmount();
    this.sceneLayer.removeChild(scene.stage);
    scene.stage.destroy({ children: true });
  }
}
