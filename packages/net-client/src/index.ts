// @interverse/net — room/session client (spec §5.3).
// Phase 3 ships host/join/roster/messaging. Lobby sync primitives
// (ready-up, countdown, score table) land with the first party game.

export { host, join, Session } from './session.js';
export type { NetOptions, PlayerInfo } from './session.js';
export { makeSyncCode, syncPull, syncPush } from './sync.js';
