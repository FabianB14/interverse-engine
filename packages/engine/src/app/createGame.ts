import { Application, Container } from 'pixi.js';

export interface GameConfig {
  /** Design (virtual) resolution width. World coordinates are expressed in this space. */
  width: number;
  /** Design (virtual) resolution height. */
  height: number;
  /** Background color (hex number, e.g. 0x101018). */
  background?: number;
  /** Element to mount the canvas into. Defaults to document.body. */
  mount?: HTMLElement;
  /** Fixed-timestep updates per second. Defaults to 60. */
  fixedFps?: number;
  /**
   * Fixed-timestep simulation step. `dt` is the constant step in seconds.
   * Called zero or more times per rendered frame.
   */
  update?: (dt: number) => void;
  /**
   * Render step. `alpha` in [0,1] is the interpolation factor between the
   * previous and current fixed-update states, for smooth motion.
   */
  render?: (alpha: number) => void;
}

export interface Game {
  /** The underlying PixiJS application. */
  app: Application;
  /**
   * The world container. Children use design-space coordinates
   * (0..width, 0..height); the engine scales/letterboxes it to the screen.
   */
  world: Container;
  /** Design resolution the world is authored against. */
  readonly designWidth: number;
  readonly designHeight: number;
  /** Tear down the ticker, listeners, and canvas. */
  destroy: () => void;
}

/**
 * Boots a PixiJS application with:
 *  - a design-space `world` container that is letterbox-scaled to fit any screen
 *  - DPR-aware, orientation-aware resizing
 *  - a fixed-timestep update loop with interpolated rendering (§4.1)
 */
export async function createGame(config: GameConfig): Promise<Game> {
  const {
    width,
    height,
    background = 0x101018,
    mount = document.body,
    fixedFps = 60,
    update,
    render,
  } = config;

  const app = new Application();
  await app.init({
    background,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    resizeTo: mount === document.body ? window : mount,
  });

  mount.appendChild(app.canvas);

  const world = new Container();
  app.stage.addChild(world);

  const fitWorld = (): void => {
    const screenW = app.renderer.width / app.renderer.resolution;
    const screenH = app.renderer.height / app.renderer.resolution;
    // Contain: scale so the whole design area is visible, then center (letterbox).
    const scale = Math.min(screenW / width, screenH / height);
    world.scale.set(scale);
    world.position.set((screenW - width * scale) / 2, (screenH - height * scale) / 2);
  };

  fitWorld();
  app.renderer.on('resize', fitWorld);

  // Fixed-timestep loop with an accumulator and interpolation alpha.
  const step = 1 / fixedFps;
  const maxFrame = step * 5; // clamp to avoid spiral-of-death after tab stalls
  let accumulator = 0;

  const onTick = (): void => {
    let frame = app.ticker.deltaMS / 1000;
    if (frame > maxFrame) frame = maxFrame;
    accumulator += frame;
    while (accumulator >= step) {
      update?.(step);
      accumulator -= step;
    }
    render?.(accumulator / step);
  };

  app.ticker.add(onTick);

  const destroy = (): void => {
    app.ticker.remove(onTick);
    app.renderer.off('resize', fitWorld);
    app.destroy(true, { children: true });
  };

  return {
    app,
    world,
    designWidth: width,
    designHeight: height,
    destroy,
  };
}
