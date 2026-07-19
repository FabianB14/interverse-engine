// @interverse/engine — public API barrel.
// Phase 1: app shell (§4.1), scenes (§4.2), entities/behaviors (§4.3),
// tap input (§4.4), vector art + palettes + juice (§4.5), audio (§4.8),
// save (§4.9).

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

export { drawBlob, blobPoints } from './art/blob.js';
export type { BlobOptions } from './art/blob.js';
export { blobCharacter } from './art/character.js';
export type { BlobCharacter, BlobCharacterOptions } from './art/character.js';
export { palettes, partyPop, cozyAutumn, darken, pickColor } from './art/palettes.js';
export type { Palette } from './art/palettes.js';
export { popIn, squash } from './art/juice.js';

export { audio } from './audio/audio.js';

export { createSave } from './save/save.js';
export type { SaveStore } from './save/save.js';
