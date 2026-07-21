import type { Container } from 'pixi.js';

export interface CameraOptions {
  /** Target can drift this far from center before the camera moves. */
  deadzoneWidth?: number;
  deadzoneHeight?: number;
}

/**
 * Camera (§4.6): follows a target with an optional deadzone, clamps to
 * world bounds, and supports screen shake. It works by positioning a world
 * container (e.g. your map layer) so the camera point sits at view center.
 */
export class Camera {
  x: number;
  y: number;
  private followTarget: { x: number; y: number } | null = null;
  private bounds: { x: number; y: number; width: number; height: number } | null = null;
  private readonly dzW: number;
  private readonly dzH: number;
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeDur = 0;

  constructor(
    private readonly target: Container,
    private readonly viewWidth: number,
    private readonly viewHeight: number,
    opts: CameraOptions = {},
  ) {
    this.x = viewWidth / 2;
    this.y = viewHeight / 2;
    this.dzW = opts.deadzoneWidth ?? 0;
    this.dzH = opts.deadzoneHeight ?? 0;
  }

  /** Follow an object with x/y (e.g. an Entity). Snaps on first call. */
  follow(target: { x: number; y: number }): void {
    this.followTarget = target;
    this.x = target.x;
    this.y = target.y;
  }

  /** Clamp the camera so it never shows outside this world rectangle. */
  setBounds(x: number, y: number, width: number, height: number): void {
    this.bounds = { x, y, width, height };
  }

  /** Kick a decaying screen shake. */
  shake(amplitude = 12, duration = 0.3): void {
    this.shakeAmp = amplitude;
    this.shakeDur = duration;
    this.shakeLeft = duration;
  }

  update(dt: number): void {
    const t = this.followTarget;
    if (t) {
      const hw = this.dzW / 2;
      const hh = this.dzH / 2;
      if (t.x > this.x + hw) this.x = t.x - hw;
      if (t.x < this.x - hw) this.x = t.x + hw;
      if (t.y > this.y + hh) this.y = t.y - hh;
      if (t.y < this.y - hh) this.y = t.y + hh;
    }

    const b = this.bounds;
    if (b) {
      const minX = b.x + this.viewWidth / 2;
      const maxX = b.x + b.width - this.viewWidth / 2;
      const minY = b.y + this.viewHeight / 2;
      const maxY = b.y + b.height - this.viewHeight / 2;
      this.x = maxX < minX ? b.x + b.width / 2 : Math.min(maxX, Math.max(minX, this.x));
      this.y = maxY < minY ? b.y + b.height / 2 : Math.min(maxY, Math.max(minY, this.y));
    }

    let sx = 0;
    let sy = 0;
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const falloff = Math.max(0, this.shakeLeft / this.shakeDur);
      sx = (Math.random() * 2 - 1) * this.shakeAmp * falloff;
      sy = (Math.random() * 2 - 1) * this.shakeAmp * falloff;
    }

    this.target.position.set(
      Math.round(this.viewWidth / 2 - this.x + sx),
      Math.round(this.viewHeight / 2 - this.y + sy),
    );
  }
}
