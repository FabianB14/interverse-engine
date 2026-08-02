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
export { Actor3 } from './actor3.js';
export type { Actor3Options } from './actor3.js';
export { clearModelCache, fitTransform, loadModel, loadModelWithClips } from './models.js';
export type { LoadModelOptions, LoadedModel } from './models.js';
export { wireBox, wireRing } from './gizmos.js';
export { autoQuality } from './quality.js';
export type { AutoQuality, AutoQualityOptions } from './quality.js';
export { skyDome } from './sky.js';
export type { SkyDomeOptions } from './sky.js';
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
