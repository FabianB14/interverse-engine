// @interverse/engine — public API barrel.
// Phase 0 seeds: the app shell (§4.1) and the code-drawn vector art system (§4.5).

export { createGame } from './app/createGame.js';
export type { Game, GameConfig } from './app/createGame.js';

export { drawBlob, blobPoints } from './art/blob.js';
export type { BlobOptions } from './art/blob.js';
