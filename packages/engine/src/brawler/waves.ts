/**
 * 🚧 Wave gates — the shape of a beat-'em-up level.
 *
 * Strip a Castle Crashers stage down and it is one rule repeated: walk right
 * until the game stops you, clear what appears, walk right again. The gate is
 * what turns a long corridor into a series of fights, and it is the reason
 * the genre reads as a series of rooms rather than a jog.
 *
 * So a level here is a list of stops along the x axis, each with a batch of
 * enemies. This file owns the bookkeeping — which stop we are at, whether it
 * is cleared, how far the player may walk — and nothing else. What an enemy
 * IS, and how it is drawn, belongs to the game.
 */

export interface WaveSpec {
  /** Where the gate stands, in world x. The player cannot pass until clear. */
  atX: number;
  /** Opaque enemy descriptors — the game decides what they mean. */
  enemies: readonly unknown[];
  /** Shown when the gate closes ("AMBUSH!"). Optional, and usually worth it. */
  banner?: string;
}

export type WaveState = 'travelling' | 'fighting' | 'done';

export interface WaveProgress {
  state: WaveState;
  /** Index of the wave being fought, or the next one ahead. */
  index: number;
  /** The furthest right the player may currently walk. */
  limitX: number;
  /** Enemies left in the current fight. */
  alive: number;
}

/**
 * Runs a level's fights in order.
 *
 * Written as a plain object with an explicit `update` rather than callbacks
 * into a scene, because the interesting behaviour — a gate that closes at the
 * right moment, and re-opens only when the last enemy is down — is exactly
 * what wants testing without a game attached.
 */
export class WaveRunner {
  private index = 0;
  private state: WaveState = 'travelling';
  private alive = 0;
  private opened = false;

  constructor(
    private readonly waves: readonly WaveSpec[],
    /** The right-hand edge of the level, for after the last wave. */
    private readonly endX: number,
  ) {
    if (!waves.length) this.state = 'done';
  }

  /** How far right the player may walk right now. */
  get limitX(): number {
    if (this.state === 'done') return this.endX;
    const wave = this.waves[this.index];
    return wave ? wave.atX : this.endX;
  }

  get current(): WaveSpec | null {
    return this.state === 'fighting' ? (this.waves[this.index] ?? null) : null;
  }

  get progress(): WaveProgress {
    return { state: this.state, index: this.index, limitX: this.limitX, alive: this.alive };
  }

  get finished(): boolean {
    return this.state === 'done';
  }

  /**
   * Move the level on. Returns the wave to SPAWN this frame, if the player
   * has just walked into a gate — the caller spawns it and reports deaths
   * back through `defeated`.
   */
  update(playerX: number): WaveSpec | null {
    if (this.state !== 'travelling') return null;
    const wave = this.waves[this.index];
    if (!wave) {
      this.state = 'done';
      return null;
    }
    // A gate triggers a little before its line, so the fight starts while
    // there is still room to back up rather than with your nose against it.
    if (playerX < wave.atX - 40) return null;
    this.state = 'fighting';
    this.alive = wave.enemies.length;
    this.opened = false;
    // A wave with nothing in it is a checkpoint, not a fight.
    if (this.alive <= 0) {
      this.clearWave();
      return null;
    }
    return wave;
  }

  /** One of the current wave's enemies went down. */
  defeated(): void {
    if (this.state !== 'fighting') return;
    this.alive = Math.max(0, this.alive - 1);
    if (this.alive === 0) this.clearWave();
  }

  private clearWave(): void {
    this.opened = true;
    this.index++;
    this.state = this.index >= this.waves.length ? 'done' : 'travelling';
  }

  /** True on the frame a gate opens — for a chime and a flash of the arrow. */
  takeOpened(): boolean {
    const was = this.opened;
    this.opened = false;
    return was;
  }
}

/**
 * Spread a wave's enemies across the stage so they do not stack into one
 * sprite. They come from ahead and from behind on purpose: being surrounded
 * is the genre's whole texture, and a wave that only ever arrives from the
 * front is a queue.
 */
export function spawnSpots(
  count: number,
  gateX: number,
  groundTop: number,
  groundBottom: number,
  rand: () => number = Math.random,
): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  const band = groundBottom - groundTop;
  for (let i = 0; i < count; i++) {
    // One in three arrives from behind, and each one stands further out than
    // the last — a strictly increasing step is what guarantees no two ever
    // land on the same spot, however many the wave holds and whatever the
    // random depth happens to be.
    const behind = i % 3 === 2;
    const step = 150 + i * 90;
    spots.push({
      x: gateX + (behind ? -step : step),
      y: groundTop + band * (0.25 + rand() * 0.6),
    });
  }
  return spots;
}
