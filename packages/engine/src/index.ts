// @interverse/engine — public API barrel.
// Phase 1: app shell (§4.1), scenes (§4.2), entities/behaviors (§4.3),
// tap input (§4.4), vector art + palettes + juice (§4.5), audio (§4.8),
// save (§4.9).
// Phase 2: tilemaps + camera (§4.6), virtual joystick (§4.4), dialogue (§4.7).

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

export { tileMapFromRows, solidAt, moveWithCollision } from './world/TileMap.js';
export type { TileMapData, TileMapObject, TileLegendEntry } from './world/TileMap.js';
export { buildTileMapView, neighborMask } from './world/TileMapView.js';
export type { TilePainter } from './world/TileMapView.js';
export { Camera } from './world/Camera.js';
export type { CameraOptions } from './world/Camera.js';

export { DialogueRunner } from './dialogue/runner.js';
export type { DialogueData, DialogueNode, DialogueChoice } from './dialogue/runner.js';

export { drawBlob, blobPoints } from './art/blob.js';
export type { BlobOptions } from './art/blob.js';
export { blobCharacter } from './art/character.js';
export type { BlobCharacter, BlobCharacterOptions } from './art/character.js';
export {
  palettes,
  partyPop,
  cozyAutumn,
  forestDeep,
  darken,
  lighten,
  pickColor,
} from './art/palettes.js';
export type { Palette } from './art/palettes.js';
export { popIn, squash } from './art/juice.js';
export { burst, stepParticle, VFX_PRESETS } from './art/particles.js';
export type { VfxPreset } from './art/particles.js';

export { audio, MUSIC_TRACKS } from './audio/audio.js';
export type { MusicTrackId } from './audio/audio.js';

export { createSave } from './save/save.js';
export type { SaveStore } from './save/save.js';

export { verium } from './economy/wallet.js';

// 🥊 Brawler kit (§4.6) — the 2.5D beat-'em-up pieces: a ground plane with
// depth, hits that feel like hits, wave gates, and a playable roster.
export {
  HORIZON_Y, GROUND_BOTTOM_Y, DEPTH_MIN_SCALE, LANE_TOLERANCE,
  depthScale, depthZ, clampToGround, onGround, inSameLane, meleeConnects, airOffset,
} from './brawler/depth.js';
export {
  COMBO_WINDOW, DEFAULT_COMBO, IFRAME_SECS, KNOCK_DRAG, MIN_TELEGRAPH,
  Combo, HitStop, Invulnerable, Telegraph, decayKnock, hitStopFor, knockbackFrom,
} from './brawler/combat.js';
export type { ComboStep, Knock } from './brawler/combat.js';
export { WaveRunner, spawnSpots } from './brawler/waves.js';
export type { WaveSpec, WaveState, WaveProgress } from './brawler/waves.js';
export {
  BASE_HEARTS, BASE_REACH, BASE_SPEED, BRAWLER_CLASSES, NO_UPGRADES,
  brawlerClass, levelFromXp, playerTint, statsFor, xpForLevel, xpToReach,
} from './brawler/roster.js';
export type { BrawlerClass, Stats, Upgrades } from './brawler/roster.js';
export {
  PARTY_TETHER, REVIVE_HEARTS, REVIVE_RANGE, REVIVE_SECS,
  emptyMember, inReviveRange, partyCenter, partyHpScale, partyLimit, partyWiped,
  pickTarget, reviveProgress, standing, tetheredX,
} from './brawler/coop.js';
export type { PartyMember } from './brawler/coop.js';

// 🏃 Runner kit (§4.7) — the endless-runner pieces: a road drawn in
// perspective, three lanes, jump/slide, swipes, and a fair track generator.
export {
  DEFAULT_PROJECTION, DRAW_DISTANCE, bendAt, depthIndex, depthOf, fogAlpha, project,
  projectPath, visible,
} from './runner/perspective.js';
export type { Projected, Projection } from './runner/perspective.js';
export { TURN_ARC, cornerDone, cornerSpace, yawFor } from './runner/corner.js';
export type { CornerFrame } from './runner/corner.js';
export { LANE_COUNT, LANE_SNAP_SECS, LANE_WIDTH, LaneRider, clampLane, laneX } from './runner/lanes.js';
export {
  BUFFER_SECS, FAST_FALL, JUMP_HEIGHT, JUMP_SECS, SLIDE_SECS, RunnerMoves, speedAt,
} from './runner/moves.js';
export type { MoveState } from './runner/moves.js';
export {
  CORNER_CLEAR_AFTER_SECS, CORNER_CLEAR_BEFORE_SECS, HAZARD_RULES, HAZARD_SHAPES, HAZARD_WEIGHTS,
  HIT_DEPTH, JUMP_PEAK, OPENING_DENSITY_SCALE, REACTION_SECS, ROW_GAP_BASE, ROW_GAP_PER_SPEED,
  RUN_HEIGHT, SLIDE_HEIGHT, TrackBuilder, WARMUP_DISTANCE, collides, cornerClear, densityAt,
  fairDistance, playerBand, rowGap, survives, survivesBand,
} from './runner/track.js';
export type {
  Band, ClearSpan, Hazard, HazardKind, HazardShape, Pickup, TrackOptions,
} from './runner/track.js';
export { SWIPE_THRESHOLD, Swipe, swipeDir } from './input/swipe.js';
export type { SwipeDir, SwipeOptions } from './input/swipe.js';
export { rollingBlob, wrapAngle } from './art/roller.js';
export type { RollingBlob, RollingBlobOptions } from './art/roller.js';

// 🛰 Host authority (§4.11) — who is allowed to decide what in a shared
// world, and how the machines that are not deciding stay smooth.
export {
  BUFFER_STALE_MS, INTERP_DELAY_MS, LOST_AFTER_MS, RECONNECT_DELAYS_MS, SLOW_AFTER_MS,
  SNAP_DISTANCE, SnapshotBuffer, encodeWorld, goneFrom, isFresh, linkState, reconnectDelay,
  roleOf, shouldSnap, simulates, smoothTo,
} from './net/authority.js';
export type { HitRequest, LinkState, MobSnap, NetRole, ShotSnap, WorldSnap } from './net/authority.js';
