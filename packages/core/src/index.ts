// @interverse/core — renderer-free game logic.
//
// Everything in here runs identically under the 2D engine (Pixi) and the 3D
// one (three.js), because none of it knows a renderer exists: track
// generation, combat maths, dialogue, saves, netcode authority. The split is
// what makes "the same game, drawn differently" a real sentence — the rules
// live here once, and the engines only disagree about pictures.
//
// @interverse/engine re-exports all of this, so games written against the
// engine barrel never see the seam.

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

export { audio, MUSIC_TRACKS } from './audio/audio.js';
export type { MusicTrackId } from './audio/audio.js';

export { createSave } from './save/save.js';
export type { SaveStore } from './save/save.js';

export { verium } from './economy/wallet.js';

export { tileMapFromRows, solidAt, moveWithCollision } from './world/TileMap.js';
export { Spline } from './world/spline.js';
export type { SplineOptions, SplinePoint } from './world/spline.js';
export type { TileMapData, TileMapObject, TileLegendEntry } from './world/TileMap.js';

export { DialogueRunner } from './dialogue/runner.js';
export type { DialogueData, DialogueNode, DialogueChoice } from './dialogue/runner.js';

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

// 🏃 Runner kit (§4.7) — the endless-runner pieces: a road in perspective,
// three lanes, jump/slide, and a fair track generator.
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

// 🛰 Host authority (§4.11) — who is allowed to decide what in a shared
// world, and how the machines that are not deciding stay smooth.
export {
  BUFFER_STALE_MS, INTERP_DELAY_MS, LOST_AFTER_MS, RECONNECT_DELAYS_MS, SLOW_AFTER_MS,
  SNAP_DISTANCE, SnapshotBuffer, encodeWorld, goneFrom, isFresh, linkState, reconnectDelay,
  roleOf, shouldSnap, simulates, smoothTo,
} from './net/authority.js';
export type { HitRequest, LinkState, MobSnap, NetRole, ShotSnap, WorldSnap } from './net/authority.js';
