/**
 * 🤸 Jump and slide.
 *
 * Two moves, one at a time, and the entire feel of a runner lives in the
 * three or four frames around each transition. The rules here exist because
 * of how the input actually arrives on a phone:
 *
 *   - A swipe that lands just before you touch down is BUFFERED, not
 *     dropped. Players swipe early; a runner that ignores an early swipe
 *     reads as "it didn't register my input", which is the one complaint
 *     nobody forgives.
 *   - Swiping down mid-air is a FAST FALL into a slide, not a refusal. The
 *     player asked to get low; the game's job is to get them low.
 *   - Jumping out of a slide is legal at any point, because being stuck in
 *     an animation while a wall arrives is not a difficulty, it is a bug.
 */

export type MoveState = 'run' | 'jump' | 'slide';

/** Peak height of a jump, in design units above the road. */
export const JUMP_HEIGHT = 180;

/**
 * How long a jump lasts, start to landing.
 *
 * Short, and deliberately so: at running speed a long jump covers so much
 * road that it clears the obstacle AFTER the one you jumped for, which turns
 * a dodge into a coin flip. The airtime has to stay inside one gap.
 */
export const JUMP_SECS = 0.52;

/** How long you stay low. Long enough to clear a barrier, short enough that
 *  spamming it is not a way to ignore the jump obstacles. */
export const SLIDE_SECS = 0.44;

/** How early a swipe still counts. One-fifth of a second is about the gap
 *  between "I meant to do that" and "why did nothing happen". */
export const BUFFER_SECS = 0.2;

/** How fast a mid-air fast-fall drops you, as a multiple of normal fall. */
export const FAST_FALL = 3.2;

export class RunnerMoves {
  state: MoveState = 'run';
  /** Height above the road, in design units. */
  height = 0;
  /** 0 upright, 1 fully flattened — drive a squash with this. */
  crouch = 0;

  private t = 0;
  private buffered: 'jump' | 'slide' | null = null;
  private bufferAge = 0;
  private falling = false;

  get airborne(): boolean {
    return this.state === 'jump';
  }

  get sliding(): boolean {
    return this.state === 'slide';
  }

  /** Ask to jump. Legal from the ground or out of a slide; in mid-air it is
   *  remembered in case you land in time for it to still be what you meant. */
  jump(): void {
    if (this.state === 'jump') {
      this.buffered = 'jump';
      this.bufferAge = 0;
      return;
    }
    this.state = 'jump';
    this.t = 0;
    this.falling = false;
    this.crouch = 0;
  }

  /** Ask to slide. In mid-air this becomes a fast fall — the player asked to
   *  get low, so getting low is the answer, just not instantly. */
  slide(): void {
    if (this.state === 'jump') {
      this.falling = true;
      this.buffered = 'slide';
      this.bufferAge = 0;
      return;
    }
    this.state = 'slide';
    this.t = 0;
    this.falling = false;
  }

  update(dt: number): void {
    if (this.buffered) {
      this.bufferAge += dt;
      if (this.bufferAge > BUFFER_SECS) this.buffered = null;
    }
    if (this.state === 'jump') this.tickJump(dt);
    else if (this.state === 'slide') this.tickSlide(dt);
    else this.crouch = Math.max(0, this.crouch - dt * 6);
  }

  private tickJump(dt: number): void {
    this.t += dt * (this.falling ? FAST_FALL : 1);
    const p = this.t / JUMP_SECS;
    if (p >= 1) {
      this.land();
      return;
    }
    // A plain parabola: fastest at the start, hangs at the top. Anything
    // fancier stops matching the shadow on the road, and the shadow is what
    // the player actually aims with.
    this.height = JUMP_HEIGHT * 4 * p * (1 - p);
    this.crouch = 0;
  }

  private tickSlide(dt: number): void {
    this.t += dt;
    this.height = 0;
    // Flatten fast, come back up slowly — the recovery is the part the
    // player has to read to know when they can jump again.
    this.crouch = this.t < SLIDE_SECS * 0.25 ? this.t / (SLIDE_SECS * 0.25) : 1;
    if (this.t >= SLIDE_SECS) {
      this.state = 'run';
      this.t = 0;
      this.crouch = 1;
      this.consumeBuffer();
    }
  }

  private land(): void {
    this.height = 0;
    this.state = 'run';
    this.t = 0;
    this.falling = false;
    this.consumeBuffer();
  }

  private consumeBuffer(): void {
    const next = this.buffered;
    this.buffered = null;
    if (next === 'jump') this.jump();
    else if (next === 'slide') this.slide();
  }

  /** Back to a clean run — for a restart, never mid-game. */
  reset(): void {
    this.state = 'run';
    this.height = 0;
    this.crouch = 0;
    this.t = 0;
    this.buffered = null;
    this.falling = false;
  }
}

/**
 * How fast the world comes at you, after running `distance`.
 *
 * Ramps toward a cap rather than growing forever: an endless runner that
 * accelerates without limit ends every run the same way, at the speed where
 * reaction time runs out, which makes the last few seconds identical for a
 * beginner and an expert. A cap means skill decides the score instead.
 */
export function speedAt(distance: number, base = 1020, cap = 2600, ramp = 7000): number {
  return base + (cap - base) * (1 - Math.exp(-distance / ramp));
}
