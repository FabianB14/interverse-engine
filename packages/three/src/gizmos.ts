/**
 * 🩻 Collision gizmos — see what the game feels.
 *
 * Every collision model in these games is simple on purpose (bands, radii,
 * reach boxes), and the fastest way to trust one is to LOOK at it against
 * the art. These are wireframe ghosts for exactly that: toggled on with a
 * key, updated from the same numbers the hit tests read — so what you see
 * is what collides, by construction.
 *
 * Depth-test off and rendered last: a hitbox that hides inside the mesh it
 * describes is a hitbox you cannot check.
 */

import { BoxGeometry, Mesh, MeshBasicMaterial, RingGeometry } from 'three';

function ghostMat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
}

/** A wireframe box — for vertical bands and reach envelopes. Scale it per
 *  frame rather than rebuilding: it is a unit box around the origin. */
export function wireBox(color = 0xff6f91): Mesh {
  const m = new Mesh(new BoxGeometry(1, 1, 1), ghostMat(color));
  m.renderOrder = 999;
  return m;
}

/** A flat wireframe ring on the ground — for radii (contact, sweeps). */
export function wireRing(radius: number, color = 0x8affc1): Mesh {
  const m = new Mesh(new RingGeometry(radius * 0.96, radius, 32), ghostMat(color));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 999;
  return m;
}
