// @interverse/engine — public API barrel.
// Phase 1: app shell (§4.1), scenes (§4.2), entities/behaviors (§4.3),
// tap input (§4.4), vector art + palettes + juice (§4.5), audio (§4.8),
// save (§4.9).
// Phase 2: tilemaps + camera (§4.6), virtual joystick (§4.4), dialogue (§4.7).
//
// The renderer-free half of the engine — track generation, combat maths,
// dialogue, saves, authority — lives in @interverse/core and is re-exported
// here wholesale, so a game written against this barrel never sees the
// seam. The 3D engine (@interverse/three) shares that half; only the
// modules below, the ones that draw or touch Pixi display objects, are
// exclusive to this package.

export * from '@interverse/core';

export { createGame } from './app/createGame.js';
export type { Game, GameConfig } from './app/createGame.js';

export { Scene } from './scene/Scene.js';
export { SceneManager } from './scene/SceneManager.js';
export type { TransitionOptions } from './scene/SceneManager.js';

export { Entity } from './entity/Entity.js';
export type { Behavior } from './entity/Entity.js';
export { Velocity, Timer, Tween, Wobble, easings } from './entity/behaviors.js';
export type { Ease, TweenOptions, WobbleOptions } from './entity/behaviors.js';

export { makeTappable } from './input/tap.js';
export type { TapOptions } from './input/tap.js';
export { VirtualJoystick } from './input/VirtualJoystick.js';
export type { VirtualJoystickOptions } from './input/VirtualJoystick.js';
export { SWIPE_THRESHOLD, Swipe, swipeDir } from './input/swipe.js';
export type { SwipeDir, SwipeOptions } from './input/swipe.js';

export { buildTileMapView, neighborMask } from './world/TileMapView.js';
export type { TilePainter } from './world/TileMapView.js';
export { Camera } from './world/Camera.js';
export type { CameraOptions } from './world/Camera.js';

export { drawBlob, blobPoints } from './art/blob.js';
export type { BlobOptions } from './art/blob.js';
export { blobCharacter } from './art/character.js';
export type { BlobCharacter, BlobCharacterOptions } from './art/character.js';
export { popIn, squash } from './art/juice.js';
export { burst, stepParticle, VFX_PRESETS } from './art/particles.js';
export type { VfxPreset } from './art/particles.js';
export { rollingBlob, wrapAngle } from './art/roller.js';
export type { RollingBlob, RollingBlobOptions } from './art/roller.js';
