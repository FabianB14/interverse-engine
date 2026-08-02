/**
 * @interverse/three — the Interverse Engine's 3D renderer.
 *
 * A sibling of @interverse/engine, not a replacement: the 2D engine keeps
 * running every shipped game, and this package renders new 3D ones. Game
 * logic that lives in renderer-free modules (runner/*, brawler/*, net/*)
 * works under either.
 */
export { FrameStats, createGame3 } from './createGame3.js';
export type { Game3, Game3Config } from './createGame3.js';
export { lightRig } from './lights.js';
export type { LightRig, LightRigOptions } from './lights.js';
export {
  jitterVertices,
  lowPolyGround,
  lowPolyMaterial,
  lowPolyTree,
  paintFacets,
  paintVertices,
  rollingBlob3,
  scatter,
  seededRand,
} from './lowpoly.js';
export type {
  Blob3Options,
  GroundOptions,
  RollingBlob3,
  TreeOptions,
} from './lowpoly.js';
