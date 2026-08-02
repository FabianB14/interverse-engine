/**
 * 📉 Quality that answers to the frame clock, not the device name.
 *
 * Device sniffing is a losing game — there are thousands of phones and the
 * same model throttles differently hot, plugged in, or five browser tabs
 * deep. The only number that is always true is the one FrameStats already
 * measures: what a frame actually costs, here, right now.
 *
 * So quality is a ladder, and the frame clock climbs it:
 *
 *   tier 0 — full resolution, shadows on
 *   tier 1 — 80% resolution, shadows on
 *   tier 2 — 65% resolution, shadows on
 *   tier 3 — 50% resolution, shadows OFF
 *
 * Resolution first, shadows last: on a fill-rate-bound phone GPU, pixels
 * are the money and the eye forgives a soft image far sooner than a
 * vanished shadow. Shadows only go at the floor, because a game that has
 * to get there is fighting for its life.
 *
 * The ladder is deliberately sticky. Dropping is fast (a run of slow
 * frames hurts NOW); climbing back is slow and only after a long clean
 * streak, because oscillating between tiers is worse than sitting one tier
 * low — resolution changes the player notices are resolution changes that
 * happen often.
 */

import type { Game3 } from './createGame3.js';

export interface AutoQualityOptions {
  /** Target frame budget in ms. 60fps is 16.7 — leave headroom under it. */
  budgetMs?: number;
  /** Consecutive over-budget checks before dropping a tier. */
  dropAfter?: number;
  /** Consecutive comfortably-under-budget checks before climbing one. */
  climbAfter?: number;
  /** How often to check, in seconds. */
  intervalSecs?: number;
}

export interface AutoQuality {
  /** Current tier, 0 (full) to 3 (floor). */
  readonly tier: number;
  /**
   * Call once per update. Checks are paced by the WALL clock internally,
   * not by the dt you pass — under heavy load the fixed-step accumulator
   * clamps and game time runs slower than real time, which is exactly when
   * quality most needs to act. A ladder paced in game seconds goes slowest
   * when the game is slowest, which is the tool failing its one job.
   */
  update(dt?: number): void;
  /** Pin a tier (e.g. from a settings screen); null resumes auto. */
  pin(tier: number | null): void;
}

const TIERS = [
  { scale: 1.0, shadows: true },
  { scale: 0.8, shadows: true },
  { scale: 0.65, shadows: true },
  { scale: 0.5, shadows: false },
] as const;

export function autoQuality(game: Game3, opts: AutoQualityOptions = {}): AutoQuality {
  const { budgetMs = 15, dropAfter = 2, climbAfter = 8, intervalSecs = 1 } = opts;
  const baseRatio = game.renderer.getPixelRatio();
  let tier = 0;
  let pinned: number | null = null;
  let slow = 0;
  let clean = 0;
  let nextCheck = performance.now() + intervalSecs * 1000;

  const apply = (t: number): void => {
    tier = Math.max(0, Math.min(TIERS.length - 1, t));
    const q = TIERS[tier]!;
    game.renderer.setPixelRatio(baseRatio * q.scale);
    game.renderer.shadowMap.enabled = q.shadows;
    // Materials compile their shadow code in; flipping the map on or off
    // without this leaves every material rendering yesterday's decision.
    game.scene.traverse((o) => {
      const mat = (o as { material?: { needsUpdate: boolean } }).material;
      if (mat) mat.needsUpdate = true;
    });
    // Re-fit the canvas at the new ratio.
    window.dispatchEvent(new Event('resize'));
  };

  return {
    get tier() {
      return tier;
    },
    pin(t: number | null) {
      pinned = t;
      if (t !== null) apply(t);
    },
    update() {
      if (pinned !== null) return;
      const now = performance.now();
      if (now < nextCheck) return;
      nextCheck = now + intervalSecs * 1000;
      const ms = game.stats.frameMs;
      if (ms <= 0) return;
      if (ms > budgetMs) {
        slow++;
        clean = 0;
        if (slow >= dropAfter && tier < TIERS.length - 1) {
          apply(tier + 1);
          slow = 0;
        }
      } else if (ms < budgetMs * 0.7) {
        clean++;
        slow = 0;
        if (clean >= climbAfter && tier > 0) {
          apply(tier - 1);
          clean = 0;
        }
      } else {
        // In the comfort band: not slow, not fast enough to climb. Sit.
        slow = 0;
        clean = 0;
      }
    },
  };
}
