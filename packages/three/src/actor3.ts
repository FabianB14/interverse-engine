/**
 * 🎭 Actor3 — a thing in the world, with all its slots filled in one place.
 *
 * Every actor a game drops in wants the same four sockets, so they are the
 * contract rather than four ad-hoc fields per game:
 *
 *   - a MODEL slot: an imported .glb, or a procedural fallback while it
 *     loads (and forever, if there is no file — models are optional, the
 *     house style is code-built).
 *   - ANIMATIONS, for characters and NPCs: the clips that came with the
 *     model, played by name through one mixer. `play('walk')` cross-fades,
 *     because a hard cut between clips is the single most amateur-looking
 *     frame a character can have.
 *   - an SFX slot and a VFX slot: named events mapped to sounds and
 *     effects. Gameplay code calls `emit('hit')` and does not know or care
 *     what that looks or sounds like — which is what lets a game re-skin
 *     an actor without touching the code that fights it.
 *
 * The engine does not guess what a "hit" sounds like; the slots are the
 * game's to fill. What the engine owns is the WIRING: one emit, both
 * channels, every time, so sound and picture can never drift apart.
 */

import { AnimationMixer, Group, LoopRepeat, Vector3 } from 'three';
import type { AnimationAction, Object3D } from 'three';
import { loadModelWithClips } from './models.js';

export interface Actor3Options {
  /** URL of a .glb to load into the model slot. */
  model?: string;
  /** Scale the model to this height (world units). */
  height?: number;
  /** Procedural body: shown until the model arrives, or as the permanent
   *  look if no model is given. */
  fallback?: () => Object3D;
  /** Clip to start playing as soon as the model lands (e.g. 'idle'). */
  autoPlay?: string;
  /** Named sounds: emit('hit') fires sfx.hit. */
  sfx?: Record<string, () => void>;
  /** Named effects: emit('hit') also fires vfx.hit with the actor's feet
   *  position, so effects land where the actor is, not where it spawned. */
  vfx?: Record<string, (at: Vector3) => void>;
}

export class Actor3 {
  /** Add this to the scene; position/rotate it like any Object3D. */
  readonly view = new Group();

  private fallbackBody: Object3D | null = null;
  private mixer: AnimationMixer | null = null;
  private actions = new Map<string, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentName = '';
  private readonly sfx: Record<string, () => void>;
  private readonly vfx: Record<string, (at: Vector3) => void>;
  private counts = new Map<string, number>();
  private loaded = false;

  constructor(opts: Actor3Options = {}) {
    this.sfx = opts.sfx ?? {};
    this.vfx = opts.vfx ?? {};
    if (opts.fallback) {
      this.fallbackBody = opts.fallback();
      this.view.add(this.fallbackBody);
    }
    if (opts.model) {
      void loadModelWithClips(opts.model, opts.height !== undefined ? { height: opts.height } : {})
        .then(({ view, clips }) => {
          if (this.fallbackBody) {
            this.view.remove(this.fallbackBody);
            this.fallbackBody = null;
          }
          this.view.add(view);
          this.mixer = new AnimationMixer(view);
          for (const clip of clips) {
            this.actions.set(clip.name, this.mixer.clipAction(clip));
          }
          this.loaded = true;
          if (opts.autoPlay) this.play(opts.autoPlay);
        })
        .catch(() => {
          // The fallback body simply stays — a lost model is a look, not
          // a missing actor.
        });
    }
  }

  /** True once the model slot is filled (never, if there was no model). */
  get modelLoaded(): boolean {
    return this.loaded;
  }

  /** The clip names available to play — what the FILE brought. */
  get clips(): string[] {
    return [...this.actions.keys()];
  }

  /** What is playing right now ('' before anything is). */
  get playing(): string {
    return this.currentName;
  }

  /**
   * Play a named clip, cross-fading from whatever runs now. Asking for the
   * clip already playing is a no-op, so callers can set state every frame
   * ('walk' while moving) without restarting the animation each step.
   */
  play(name: string, fadeSecs = 0.2): boolean {
    if (name === this.currentName) return true;
    const next = this.actions.get(name);
    if (!next) return false;
    next.reset();
    next.setLoop(LoopRepeat, Infinity);
    next.play();
    if (this.current) this.current.crossFadeTo(next, fadeSecs, false);
    this.current = next;
    this.currentName = name;
    return true;
  }

  /** Fire an event into both slots: the sound plays, the effect lands at
   *  the actor's feet. Unknown events are silently fine — a golem with no
   *  'taunt' sound just doesn't taunt audibly. */
  emit(event: string): void {
    this.counts.set(event, (this.counts.get(event) ?? 0) + 1);
    this.sfx[event]?.();
    this.vfx[event]?.(this.view.getWorldPosition(new Vector3()));
  }

  /** How many times an event has fired — for tests and analytics, so a
   *  playtest can assert "the hit actually made a noise happen". */
  emitted(event: string): number {
    return this.counts.get(event) ?? 0;
  }

  /** Advance animations. Call from the game's fixed update. */
  update(dt: number): void {
    this.mixer?.update(dt);
  }

  /** Time (secs) the current clip has played — proof motion is happening. */
  get clipTime(): number {
    return this.current?.time ?? 0;
  }
}
