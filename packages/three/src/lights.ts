/**
 * 💡 The light rig.
 *
 * Ranked by visual impact per millisecond of GPU, lighting is second only to
 * tone mapping — and the failure mode it prevents is specific: a scene lit by
 * one flat ambient light has no shading gradient, so every surface reads as
 * the same cardboard whatever its shape.
 *
 * The rig is two lights, which is deliberately few:
 *
 *   - A HEMISPHERE light for fill. Sky color from above, ground bounce from
 *     below — the cheapest possible approximation of a sky, and it gives
 *     upward- and downward-facing surfaces different colors, which is most
 *     of what "being outdoors" looks like.
 *   - One DIRECTIONAL key with a shadow camera pulled TIGHT around the play
 *     area. One tight shadow map beats any number of loose ones: shadow
 *     resolution is a budget spent over the camera's box, so a box that
 *     covers exactly the road spends all of it where the player looks.
 */

import { DirectionalLight, HemisphereLight, type Object3D, Vector3 } from 'three';

export interface LightRigOptions {
  /** Sky fill color (from above). */
  sky?: number;
  /** Ground bounce color (from below). */
  ground?: number;
  /** Key light color. */
  sun?: number;
  /** Key light strength. */
  intensity?: number;
  /** Direction the key light comes FROM, normalized internally. */
  from?: { x: number; y: number; z: number };
  /** Half-size of the square the shadow camera covers, in world units.
   *  Keep it tight: this is the whole shadow budget. */
  shadowArea?: number;
  /** Shadow map resolution per side. 1024 is the mid-range phone budget. */
  shadowMap?: number;
}

export interface LightRig {
  hemi: HemisphereLight;
  key: DirectionalLight;
  /** Re-center the rig on a moving target (the player). The shadow camera
   *  follows in whole-unit steps so the shadow edge does not shimmer. */
  follow: (target: Vector3) => void;
}

export function lightRig(parent: Object3D, opts: LightRigOptions = {}): LightRig {
  const {
    sky = 0xbdd7e0,
    ground = 0x3a4a3a,
    sun = 0xfff2d8,
    intensity = 2.2,
    from = { x: 0.6, y: 1, z: 0.35 },
    shadowArea = 260,
    shadowMap = 1024,
  } = opts;

  const hemi = new HemisphereLight(sky, ground, 0.9);
  parent.add(hemi);

  const key = new DirectionalLight(sun, intensity);
  const dir = new Vector3(from.x, from.y, from.z).normalize();
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMap, shadowMap);
  const cam = key.shadow.camera;
  cam.left = -shadowArea;
  cam.right = shadowArea;
  cam.top = shadowArea;
  cam.bottom = -shadowArea;
  cam.near = 1;
  cam.far = shadowArea * 6;
  // A whisper of bias, or every surface acne-stripes itself at low sun angles.
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.5;
  parent.add(key, key.target);

  const distance = shadowArea * 2.5;
  const follow = (target: Vector3): void => {
    // Snap to whole units: a shadow camera that slides continuously
    // resamples its map every frame and the shadow edges crawl.
    const tx = Math.round(target.x);
    const tz = Math.round(target.z);
    key.target.position.set(tx, 0, tz);
    key.position.set(tx + dir.x * distance, dir.y * distance, tz + dir.z * distance);
  };
  follow(new Vector3());

  return { hemi, key, follow };
}
