import { Circle, Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Entity } from '../entity/Entity.js';

export interface VirtualJoystickOptions {
  /** Base radius in design units. Default 100. */
  radius?: number;
  knobRadius?: number;
  color?: number;
  alpha?: number;
  /**
   * Dynamic (floating) mode: instead of a fixed ring, the stick appears
   * wherever the player first presses inside its hit region and follows the
   * thumb from there. Give `hitWidth`/`hitHeight` to size that region (e.g.
   * the whole screen). Great for "slide anywhere to walk".
   */
  dynamic?: boolean;
  hitWidth?: number;
  hitHeight?: number;
}

/**
 * Virtual joystick for RPG/cozy movement (§4.4). Tracks a single pointer by
 * id, so other touches (taps elsewhere) work simultaneously. Read `.value`
 * each update — a direction vector with magnitude 0..1.
 *
 * In `dynamic` mode the ring is hidden until pressed, then springs up under
 * the thumb anywhere in its hit region.
 */
export class VirtualJoystick extends Entity {
  readonly value = { x: 0, y: 0 };
  private readonly radius: number;
  private readonly stick: Entity;
  private readonly knob: Graphics;
  private readonly dynamic: boolean;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;

  constructor(opts: VirtualJoystickOptions = {}) {
    super();
    this.radius = opts.radius ?? 100;
    this.dynamic = opts.dynamic ?? false;
    const knobR = opts.knobRadius ?? 46;
    const color = opts.color ?? 0xffffff;
    const alpha = opts.alpha ?? 0.2;

    // The visible ring lives in its own child so dynamic mode can move it to
    // the press point without disturbing the joystick's own transform.
    this.stick = new Entity();
    const base = new Graphics();
    base.circle(0, 0, this.radius).fill({ color, alpha });
    base.circle(0, 0, this.radius).stroke({ color, alpha: alpha + 0.15, width: 3 });
    this.knob = new Graphics().circle(0, 0, knobR).fill({ color, alpha: 0.5 });
    this.stick.addChild(base, this.knob);
    this.addChild(this.stick);
    if (this.dynamic) this.stick.visible = false;

    if (this.dynamic) {
      // Dynamic mode does NOT capture pointer events itself — call listen(root)
      // with an interactive container (usually the scene stage). Presses bubble
      // up from whatever was under the finger, so taps on world objects and UI
      // still reach them; the stick just rides along.
      this.eventMode = 'none';
    } else {
      this.eventMode = 'static';
      // Generous grab area — thumbs are imprecise.
      this.hitArea = new Circle(0, 0, this.radius * 1.5);
      this.on('pointerdown', this.onDown, this);
      this.on('globalpointermove', this.onMove, this);
      this.on('pointerup', this.onUp, this);
      this.on('pointerupoutside', this.onUp, this);
    }
  }

  /**
   * Dynamic mode: drive the stick from bubbled events on `root` (make it
   * interactive with a hitArea covering the screen). Safe to call once.
   */
  listen(root: Container): void {
    if (!this.dynamic) return;
    root.on('pointerdown', this.onDown, this);
    root.on('globalpointermove', this.onMove, this);
    root.on('pointerup', this.onUp, this);
    root.on('pointerupoutside', this.onUp, this);
  }

  /** Kept for API compatibility; dynamic mode no longer owns a hit region. */
  setHitSize(_w: number, _h: number): void {
    /* no-op — the listen() root defines the touch surface */
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    if (this.dynamic) {
      const p = this.toLocal(e.global);
      this.originX = p.x;
      this.originY = p.y;
      this.stick.position.set(p.x, p.y);
      this.stick.visible = true;
    }
    this.track(e);
  }

  private onMove(e: FederatedPointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.track(e);
  }

  private onUp(e: FederatedPointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.value.x = 0;
    this.value.y = 0;
    this.knob.position.set(0, 0);
    if (this.dynamic) this.stick.visible = false;
  }

  private track(e: FederatedPointerEvent): void {
    const p = this.toLocal(e.global);
    let dx = p.x - (this.dynamic ? this.originX : 0);
    let dy = p.y - (this.dynamic ? this.originY : 0);
    let len = Math.hypot(dx, dy);
    if (this.dynamic && len > this.radius) {
      // Trailing origin: drag the ring along behind the finger so reversing
      // direction responds immediately instead of after crossing the whole
      // ring (much snappier direction changes).
      const excess = len - this.radius;
      this.originX += (dx / len) * excess;
      this.originY += (dy / len) * excess;
      this.stick.position.set(this.originX, this.originY);
      dx = p.x - this.originX;
      dy = p.y - this.originY;
      len = this.radius;
    }
    const clamp = len > this.radius ? this.radius / len : 1;
    const kx = dx * clamp;
    const ky = dy * clamp;
    this.knob.position.set(kx, ky);
    this.value.x = kx / this.radius;
    this.value.y = ky / this.radius;
  }
}
