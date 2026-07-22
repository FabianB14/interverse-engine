import { Circle, Graphics, Rectangle } from 'pixi.js';
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

    this.eventMode = 'static';
    if (this.dynamic) {
      // A big rectangular catch area centered on this entity's origin.
      const w = opts.hitWidth ?? 720;
      const h = opts.hitHeight ?? 1280;
      this.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
    } else {
      // Generous grab area — thumbs are imprecise.
      this.hitArea = new Circle(0, 0, this.radius * 1.5);
    }
    this.on('pointerdown', this.onDown, this);
    this.on('globalpointermove', this.onMove, this);
    this.on('pointerup', this.onUp, this);
    this.on('pointerupoutside', this.onUp, this);
  }

  /** Resize the dynamic hit region (e.g. on viewport resize). */
  setHitSize(w: number, h: number): void {
    if (this.dynamic) this.hitArea = new Rectangle(-w / 2, -h / 2, w, h);
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
    // Measure from the fixed origin (0,0) normally, or the press point in
    // dynamic mode.
    const dx = p.x - (this.dynamic ? this.originX : 0);
    const dy = p.y - (this.dynamic ? this.originY : 0);
    const len = Math.hypot(dx, dy);
    const clamp = len > this.radius ? this.radius / len : 1;
    const kx = dx * clamp;
    const ky = dy * clamp;
    this.knob.position.set(kx, ky);
    this.value.x = kx / this.radius;
    this.value.y = ky / this.radius;
  }
}
