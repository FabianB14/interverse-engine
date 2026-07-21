import { Circle, Graphics } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { Entity } from '../entity/Entity.js';

export interface VirtualJoystickOptions {
  /** Base radius in design units. Default 100. */
  radius?: number;
  knobRadius?: number;
  color?: number;
  alpha?: number;
}

/**
 * Virtual joystick for RPG/cozy movement (§4.4). Tracks a single pointer by
 * id, so other touches (taps elsewhere) work simultaneously. Read `.value`
 * each update — a direction vector with magnitude 0..1.
 */
export class VirtualJoystick extends Entity {
  readonly value = { x: 0, y: 0 };
  private readonly radius: number;
  private readonly knob: Graphics;
  private pointerId: number | null = null;

  constructor(opts: VirtualJoystickOptions = {}) {
    super();
    this.radius = opts.radius ?? 100;
    const knobR = opts.knobRadius ?? 46;
    const color = opts.color ?? 0xffffff;
    const alpha = opts.alpha ?? 0.2;

    const base = new Graphics();
    base.circle(0, 0, this.radius).fill({ color, alpha });
    base.circle(0, 0, this.radius).stroke({ color, alpha: alpha + 0.15, width: 3 });
    this.knob = new Graphics().circle(0, 0, knobR).fill({ color, alpha: 0.5 });
    this.addChild(base, this.knob);

    this.eventMode = 'static';
    // Generous grab area — thumbs are imprecise.
    this.hitArea = new Circle(0, 0, this.radius * 1.5);
    this.on('pointerdown', this.onDown, this);
    this.on('globalpointermove', this.onMove, this);
    this.on('pointerup', this.onUp, this);
    this.on('pointerupoutside', this.onUp, this);
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
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
  }

  private track(e: FederatedPointerEvent): void {
    const p = this.toLocal(e.global);
    const len = Math.hypot(p.x, p.y);
    const clamp = len > this.radius ? this.radius / len : 1;
    const kx = p.x * clamp;
    const ky = p.y * clamp;
    this.knob.position.set(kx, ky);
    this.value.x = kx / this.radius;
    this.value.y = ky / this.radius;
  }
}
