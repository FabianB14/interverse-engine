/**
 * ↶ ↷ Undo / redo.
 *
 * A game is JSON, so history is a stack of snapshots rather than a set of
 * inverse operations. That is far more memory but immune to a whole class
 * of bug: there is no way for an "undo" to be an incomplete mirror of the
 * edit it reverses, which is how hand-written undo goes wrong.
 *
 * Two things make snapshots practical here:
 *  - COALESCING, but only for CONTINUOUS edits. Dragging an actor fires a
 *    change every pointermove and typing a name fires one per keystroke, so
 *    those collapse into one entry — undo steps back a drag, not a pixel.
 *    Discrete actions (adding an actor, deleting one, loading a project) do
 *    NOT collapse: clicking "add" twice is two things you did, and one undo
 *    should take back one of them.
 *  - A BYTE BUDGET as well as a count. Imported art lives in the project, so
 *    a 2 MB project times 60 entries would be 120 MB of tab memory.
 */

/** Edits that stream: a drag, a slider, a text field. Everything else is a
 *  discrete action and gets its own undo step. */
export const CONTINUOUS_EDITS: readonly string[] = ['move', 'edit actor', 'paint', 'HUD layout', 'rename', 'edit'];

export function coalesces(label: string): boolean {
  return CONTINUOUS_EDITS.includes(label);
}

export interface HistoryEntry {
  json: string;
  /** What produced it, shown on the button and used for coalescing. */
  label: string;
  at: number;
}

export interface HistoryOpts {
  /** Edits with the same label within this many ms collapse into one. */
  coalesceMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  /** Injected so tests are not at the mercy of a real clock. */
  now?: () => number;
}

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly coalesceMs: number;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  /** True while undo/redo is applying, so the resulting change is ignored. */
  private applying = false;

  constructor(opts: HistoryOpts = {}) {
    this.coalesceMs = opts.coalesceMs ?? 600;
    this.maxEntries = opts.maxEntries ?? 60;
    this.maxBytes = opts.maxBytes ?? 24 * 1024 * 1024;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Seed the baseline — the state before any edit. */
  reset(json: string): void {
    this.past = [{ json, label: 'open', at: this.now() }];
    this.future = [];
  }

  get isApplying(): boolean {
    return this.applying;
  }

  /** Record a new state. Returns false when it was folded into the previous
   *  entry (a continuing drag) or ignored (no actual change). */
  record(json: string, label: string): boolean {
    if (this.applying) return false;
    const top = this.past[this.past.length - 1];
    if (top && top.json === json) return false; // nothing actually changed
    // Any new edit invalidates the redo branch.
    this.future = [];
    if (top && top.label === label && coalesces(label) && this.now() - top.at < this.coalesceMs) {
      top.json = json;
      top.at = this.now();
      return false;
    }
    this.past.push({ json, label, at: this.now() });
    this.trim();
    return true;
  }

  private trim(): void {
    while (this.past.length > this.maxEntries) this.past.shift();
    let bytes = this.past.reduce((n, e) => n + e.json.length, 0);
    // Always keep the current state plus one step back, however large.
    while (bytes > this.maxBytes && this.past.length > 2) {
      bytes -= this.past.shift()!.json.length;
    }
  }

  canUndo(): boolean {
    return this.past.length > 1;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What the next undo would reverse — for the button's tooltip. */
  undoLabel(): string {
    return this.canUndo() ? this.past[this.past.length - 1]!.label : '';
  }

  redoLabel(): string {
    return this.canRedo() ? this.future[this.future.length - 1]!.label : '';
  }

  /** Step back. Returns the JSON to restore, or null at the beginning. */
  undo(): string | null {
    if (!this.canUndo()) return null;
    this.future.push(this.past.pop()!);
    return this.past[this.past.length - 1]!.json;
  }

  redo(): string | null {
    if (!this.canRedo()) return null;
    const entry = this.future.pop()!;
    this.past.push(entry);
    return entry.json;
  }

  /** Run a restore without it being recorded as a fresh edit. */
  apply(fn: () => void): void {
    this.applying = true;
    try {
      fn();
    } finally {
      this.applying = false;
    }
  }

  /** For the debug hooks and tests. */
  depth(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }
}

/** Should this keystroke drive editor undo, or the focused text field's own?
 *  Stealing Ctrl+Z from a textarea would make the Code window unusable. */
export function isEditorUndoTarget(el: Element | null): boolean {
  if (!el) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return false;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Checkboxes and colour swatches have no text history of their own.
    return ['checkbox', 'radio', 'range', 'color', 'button'].includes(type);
  }
  return !(el as HTMLElement).isContentEditable;
}
