/**
 * 🌄 A sky that costs one draw call.
 *
 * A flat clear color reads as a void; a real sky is a vertical gradient —
 * bright at the horizon where the atmosphere is thick, deeper overhead.
 * This is that gradient on the inside of a big sphere, unlit and fog-proof,
 * plus an optional low sun disc for the light to visibly come FROM.
 *
 * Vertex-colored like everything else: the gradient is painted into the
 * sphere's vertices, so there is no texture and no shader of our own.
 */

import {
  BackSide,
  Color,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { paintVertices } from './lowpoly.js';

export interface SkyDomeOptions {
  /** Color at the horizon (and the one to match scene fog to). */
  horizon?: number;
  /** Color straight up. */
  zenith?: number;
  radius?: number;
}

export function skyDome(opts: SkyDomeOptions = {}): Mesh {
  const { horizon = 0x9fb8ad, zenith = 0x5d7f8f, radius = 3200 } = opts;
  const geom = new SphereGeometry(radius, 16, 10);
  const cH = new Color(horizon);
  const cZ = new Color(zenith);
  const mix = new Color();
  paintVertices(geom, (_x, y, _z, set) => {
    // Ease toward the zenith color above the horizon; hold the horizon
    // color below it so the ground line never shows a seam.
    const t = Math.max(0, Math.min(1, y / radius));
    set(mix.copy(cH).lerp(cZ, t * t));
  });
  const sky = new Mesh(
    geom,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false }),
  );
  // Skies do not write depth: everything in the world draws over them.
  (sky.material as MeshBasicMaterial).depthWrite = false;
  sky.renderOrder = -1;
  return sky;
}
