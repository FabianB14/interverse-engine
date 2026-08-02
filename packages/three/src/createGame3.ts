/**
 * 🎥 Boots a three.js game the way createGame boots a Pixi one.
 *
 * Same contract on purpose: a fixed 60Hz update with interpolated render, a
 * design-space viewport, DPR-aware resizing, and a destroy that actually
 * destroys. A game written against this loop thinks about the world exactly
 * the way the 2D games do — only the drawing is different.
 *
 * The renderer ships configured, not configurable. Tone mapping, shadow
 * type and color space are the difference between "hobby WebGL" and a game,
 * and they are package decisions rather than per-game ones:
 *
 *   - ACES filmic tone mapping. Untonemapped WebGL clips highlights straight
 *     to white and is the single biggest reason amateur 3D looks amateur.
 *   - Soft shadow maps. Contact shadows are what make an object sit IN the
 *     world instead of floating over it.
 *   - sRGB output. Colors authored in the palettes arrive on screen as the
 *     palette meant them.
 */

import {
  ACESFilmicToneMapping,
  Color,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export interface Game3Config {
  /** Design height in world units — the vertical extent framed at any aspect. */
  designHeight?: number;
  /** Background / clear color. */
  background?: number;
  /** Element to mount the canvas into. Defaults to document.body. */
  mount?: HTMLElement;
  /** Fixed-timestep updates per second. Defaults to 60. */
  fixedFps?: number;
  /** Vertical field of view, degrees. */
  fov?: number;
  /** Fixed-timestep hook — all game logic goes here. */
  update?: (dt: number) => void;
  /** Render hook, called once per frame before draw. `alpha` in [0,1] is the
   *  interpolation factor between fixed steps. */
  render?: (alpha: number) => void;
}

export interface Game3 {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Visible aspect ratio right now (updates on rotate/resize). */
  readonly aspect: number;
  /** Rolling render stats — see FrameStats. */
  stats: FrameStats;
  /**
   * Replace how the frame is presented. Null means the default
   * `renderer.render(scene, camera)`; a game that post-processes sets this
   * to its composer's render so the loop stays the loop and only the last
   * draw changes hands.
   */
  draw: (() => void) | null;
  destroy: () => void;
}

/**
 * A rolling measurement of what frames actually cost.
 *
 * This exists because "is it fast enough" must be a number the game can read
 * at runtime, not a guess made on a dev machine: the quality tier that keeps
 * mid-range phones at 60fps has to be chosen from MEASURED frame time on the
 * phone in the player's hand.
 */
export class FrameStats {
  /** Average ms between frames over the sample window. */
  frameMs = 0;
  fps = 0;
  private last = 0;
  private samples: number[] = [];

  /** Feed one frame timestamp (performance.now()). */
  tick(now: number): void {
    if (this.last > 0) {
      this.samples.push(now - this.last);
      if (this.samples.length > 60) this.samples.shift();
      const sum = this.samples.reduce((a, b) => a + b, 0);
      this.frameMs = sum / this.samples.length;
      this.fps = this.frameMs > 0 ? 1000 / this.frameMs : 0;
    }
    this.last = now;
  }
}

export function createGame3(config: Game3Config = {}): Game3 {
  const {
    background = 0x101018,
    mount = document.body,
    fixedFps = 60,
    fov = 50,
    update,
    render,
  } = config;

  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new Scene();
  scene.background = new Color(background);

  const camera = new PerspectiveCamera(fov, 1, 0.5, 4000);

  const fit = (): void => {
    const w = mount === document.body ? window.innerWidth : mount.clientWidth;
    const h = mount === document.body ? window.innerHeight : mount.clientHeight;
    renderer.setSize(w, h);
    // Vertical FOV is fixed, so the design height is always framed and a
    // wider screen simply sees more world to the sides — the 3D version of
    // the adaptive viewport, and the right default for a phone game that
    // may be held either way.
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  fit();
  window.addEventListener('resize', fit);

  // The same accumulator loop as the 2D engine, for the same reasons:
  // game logic at a constant step is logic that behaves the same on a
  // 120Hz desktop and a struggling phone.
  const step = 1 / fixedFps;
  const maxFrame = step * 5;
  let accumulator = 0;
  let lastTime = 0;
  let raf = 0;
  const stats = new FrameStats();

  // Draw stats accumulate across a whole frame — a post-processed frame is
  // several render passes, and auto-reset would leave info holding only the
  // last one (the output quad: 1 call, 1 triangle, and a very wrong
  // conclusion about the scene).
  renderer.info.autoReset = false;

  const onFrame = (now: number): void => {
    raf = requestAnimationFrame(onFrame);
    stats.tick(now);
    let frame = lastTime > 0 ? (now - lastTime) / 1000 : step;
    lastTime = now;
    if (frame > maxFrame) frame = maxFrame;
    accumulator += frame;
    while (accumulator >= step) {
      update?.(step);
      accumulator -= step;
    }
    render?.(accumulator / step);
    renderer.info.reset();
    if (game.draw) game.draw();
    else renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(onFrame);

  const game: Game3 = {
    renderer,
    scene,
    camera,
    get aspect() {
      return camera.aspect;
    },
    stats,
    draw: null,
    destroy: () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return game;
}
