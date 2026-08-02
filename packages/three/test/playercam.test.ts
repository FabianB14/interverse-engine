import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { PlayerCam } from '../src/playercam.js';

/** Listeners are exercised in the headless playtests; the math is what a
 *  unit test can pin down, so the dom is a stub. */
const fakeDom = (): HTMLElement =>
  ({ addEventListener: () => {}, removeEventListener: () => {} }) as unknown as HTMLElement;

describe('PlayerCam', () => {
  it('W means away-from-camera at any yaw', () => {
    const cam = new PlayerCam({ dom: fakeDom() });
    // Yaw 0 looks toward -Z; pressing forward (inputZ = -1) must move -Z.
    let v = cam.moveVector(0, -1);
    expect(v.x).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
    // Swing 90° left: forward is now -X.
    cam.yaw = Math.PI / 2;
    v = cam.moveVector(0, -1);
    expect(v.x).toBeCloseTo(-1);
    expect(v.z).toBeCloseTo(0);
    // Strafe right stays perpendicular to forward.
    const r = cam.moveVector(1, 0);
    expect(r.x * v.x + r.z * v.z).toBeCloseTo(0);
  });

  it('third person hangs the camera behind the player', () => {
    const cam = new PlayerCam({ dom: fakeDom(), distance: 400, eyeHeight: 100 });
    cam.pitch = 0.3;
    const camera = new PerspectiveCamera();
    cam.update(camera, new Vector3(0, 0, 0));
    // Looking toward -Z, so the camera sits at +Z, above the eyes.
    expect(camera.position.z).toBeGreaterThan(200);
    expect(camera.position.y).toBeGreaterThan(100);
  });

  it('first person puts the lens at the eyes and hides the player', () => {
    const cam = new PlayerCam({ dom: fakeDom(), mode: 'first', eyeHeight: 96 });
    const camera = new PerspectiveCamera();
    cam.update(camera, new Vector3(10, 0, 20));
    expect(camera.position.x).toBeCloseTo(10);
    expect(camera.position.y).toBeCloseTo(96);
    expect(camera.position.z).toBeCloseTo(20);
    expect(cam.hidePlayer).toBe(true);
    cam.setMode('third');
    expect(cam.hidePlayer).toBe(false);
  });

  it('zoom stays within its floor and ceiling', () => {
    const cam = new PlayerCam({ dom: fakeDom(), distance: 420 });
    cam.distance = Math.max(140, Math.min(1200, cam.distance + 100000));
    expect(cam.distance).toBe(1200);
  });
});
