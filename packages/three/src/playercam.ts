/**
 * 🎥 PlayerCam — the two cameras every 3D game eventually asks for.
 *
 * 'third' is an over-the-shoulder chase camera: drag to swing around the
 * player, wheel (or pinch-drag vertical) to zoom, and the game reads
 * `forward()`/`right()` so W always means "away from the camera" — the
 * modern-console contract. 'first' puts the lens at the player's eyes and
 * the same drag looks around; the player's own body should be hidden by
 * the game while this mode is active (`hidePlayer` says when).
 *
 * The camera is math plus listeners, not a scene object: call `update()`
 * once per frame with the point being followed and it writes the camera.
 * Modes switch live via `setMode`, keeping yaw so the world never snaps.
 */

import { PerspectiveCamera, Vector3 } from 'three';

export type PlayerCamMode = 'third' | 'first';

export interface PlayerCamOptions {
  /** The element that owns drag-look and wheel-zoom (the renderer's canvas). */
  dom: HTMLElement;
  mode?: PlayerCamMode;
  /** Third person: distance behind the player (design units). */
  distance?: number;
  /** Eye height above the followed point, used by BOTH modes. */
  eyeHeight?: number;
  /** Radians below/above horizontal the view may pitch. */
  minPitch?: number;
  maxPitch?: number;
}

export class PlayerCam {
  mode: PlayerCamMode;
  /** Radians around Y. 0 looks toward -Z, matching three's convention. */
  yaw = 0;
  /** Radians above (-) / below (+) the horizon of the LOOK direction. */
  pitch = 0.32;
  distance: number;
  eyeHeight: number;
  private readonly minPitch: number;
  private readonly maxPitch: number;
  private readonly dom: HTMLElement;
  private last: { x: number; y: number } | null = null;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: () => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly look = new Vector3();

  constructor(opts: PlayerCamOptions) {
    this.dom = opts.dom;
    this.mode = opts.mode ?? 'third';
    this.distance = opts.distance ?? 420;
    this.eyeHeight = opts.eyeHeight ?? 96;
    this.minPitch = opts.minPitch ?? -0.6;
    this.maxPitch = opts.maxPitch ?? 1.1;
    this.onDown = (e) => {
      this.last = { x: e.clientX, y: e.clientY };
    };
    this.onMove = (e) => {
      // Pointer lock (desktop mouse-look): the cursor is captured, clientX
      // freezes, and movementX/Y carry the deltas — no drag required.
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0024;
        this.pitch = Math.max(
          this.minPitch,
          Math.min(this.maxPitch, this.pitch + e.movementY * 0.002),
        );
        return;
      }
      if (!this.last) return;
      this.yaw -= (e.clientX - this.last.x) * 0.005;
      this.pitch = Math.max(
        this.minPitch,
        Math.min(this.maxPitch, this.pitch + (e.clientY - this.last.y) * 0.004),
      );
      this.last = { x: e.clientX, y: e.clientY };
    };
    this.onUp = () => {
      this.last = null;
    };
    this.onWheel = (e) => {
      if (this.mode === 'third') {
        this.distance = Math.max(140, Math.min(1200, this.distance + e.deltaY * 0.9));
      }
    };
    this.dom.addEventListener('pointerdown', this.onDown);
    this.dom.addEventListener('pointermove', this.onMove);
    this.dom.addEventListener('pointerup', this.onUp);
    this.dom.addEventListener('pointercancel', this.onUp);
    this.dom.addEventListener('wheel', this.onWheel, { passive: true });
  }

  setMode(mode: PlayerCamMode): void {
    this.mode = mode;
  }

  /** True while the player's own body should not be drawn. */
  get hidePlayer(): boolean {
    return this.mode === 'first';
  }

  /** Unit XZ vector the camera looks along — "forward" for movement. */
  forward(): { x: number; z: number } {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  /** Unit XZ vector to the camera's right — "strafe" for movement. */
  right(): { x: number; z: number } {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Turn pad/keys input (x right, z back — screen space) into a world-XZ
   *  move direction relative to where the camera faces. */
  moveVector(inputX: number, inputZ: number): { x: number; z: number } {
    const f = this.forward();
    const r = this.right();
    const x = r.x * inputX - f.x * inputZ;
    const z = r.z * inputX - f.z * inputZ;
    const len = Math.hypot(x, z);
    if (len < 1e-6) return { x: 0, z: 0 };
    return { x: x / len, z: z / len };
  }

  /** Write the camera for this frame. `target` is the player's FEET. */
  update(camera: PerspectiveCamera, target: Vector3): void {
    const eyeX = target.x;
    const eyeY = target.y + this.eyeHeight;
    const eyeZ = target.z;
    const cp = Math.cos(this.pitch);
    const lookX = -Math.sin(this.yaw) * cp;
    const lookY = -Math.sin(this.pitch);
    const lookZ = -Math.cos(this.yaw) * cp;
    if (this.mode === 'first') {
      camera.position.set(eyeX, eyeY, eyeZ);
      this.look.set(eyeX + lookX * 100, eyeY + lookY * 100, eyeZ + lookZ * 100);
      camera.lookAt(this.look);
      return;
    }
    // Third person: hang the camera BACK along the look ray, floored so a
    // fully level pitch still keeps it above the player's shoulders.
    camera.position.set(
      eyeX - lookX * this.distance,
      Math.max(eyeY - lookY * this.distance, target.y + 60),
      eyeZ - lookZ * this.distance,
    );
    this.look.set(eyeX + lookX * 60, eyeY + lookY * 60, eyeZ + lookZ * 60);
    camera.lookAt(this.look);
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onDown);
    this.dom.removeEventListener('pointermove', this.onMove);
    this.dom.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('pointercancel', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
  }
}
