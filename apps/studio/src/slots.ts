/**
 * 💾 Save slots — three separate games in progress, not one.
 *
 * Until now a project had exactly one save file, so "New Game" meant
 * destroying the only run anyone had. Worse, the file recorded no place: it
 * knew you had played, not where you were, so ▶ CONTINUE dropped you back at
 * the start level with your coins and nothing else. For a game with levels
 * that is not a continue at all.
 *
 * A slot therefore stores *where*, not just *what*: the level you were in,
 * the levels you have finished, and enough to describe the run in one line
 * on the title screen.
 *
 * Everything here is pure and works on plain objects, because the parts that
 * go wrong are the boring ones — a slot summary that lies about progress,
 * or a corrupt file that takes the title screen down with it.
 */

export const SLOT_COUNT = 3;

export interface SlotInfo {
  /** 1-based, matching what the title screen calls it. */
  slot: number;
  /** An untouched slot offers "New game" and nothing else. */
  used: boolean;
  /** The level to resume in. Empty means "wherever the game starts". */
  level: string;
  /** Levels finished at least once — the shape progression is built from. */
  completed: string[];
  coins: number;
  /** Seconds of play, so a slot can say how much is invested in it. */
  playedSecs: number;
  /** ms epoch, for "which of these is the most recent run". */
  updated: number;
}

export function emptySlot(slot: number): SlotInfo {
  return { slot, used: false, level: '', completed: [], coins: 0, playedSecs: 0, updated: 0 };
}

/** Where one slot's game data lives. Slot 1 keeps the ORIGINAL key so a
 *  project saved before slots existed is already slot 1's game in progress —
 *  nobody loses a run to an upgrade. */
export function slotKey(slug: string, slot: number): string {
  return slot <= 1 ? `studio-game-${slug}` : `studio-game-${slug}-s${slot}`;
}

/** Where the list of slots itself lives. */
export function slotIndexKey(slug: string): string {
  return `studio-slots-${slug}`;
}

/**
 * Read the slot list back, surviving anything. A save file is the one piece
 * of state an author cannot re-create, so a damaged index must degrade to
 * "no slots" rather than throwing on the title screen and locking them out
 * of their own game.
 */
export function normalizeSlots(raw: unknown): SlotInfo[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const n = i + 1;
    const found = list.find((s): s is Record<string, unknown> => !!s && typeof s === 'object' && Number((s as { slot?: unknown }).slot) === n);
    if (!found) return emptySlot(n);
    const completed = Array.isArray(found.completed)
      ? found.completed.filter((c): c is string => typeof c === 'string' && !!c)
      : [];
    const level = typeof found.level === 'string' ? found.level : '';
    return {
      slot: n,
      // "Used" is derived, never trusted: a slot with a level or any progress
      // in it IS a run, whatever a hand-edited flag claims.
      used: !!found.used || !!level || completed.length > 0,
      level,
      completed: [...new Set(completed)],
      coins: num(found.coins),
      playedSecs: Math.max(0, num(found.playedSecs)),
      updated: Math.max(0, num(found.updated)),
    };
  });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Record arriving in a level: it becomes where CONTINUE resumes. */
export function enterLevel(info: SlotInfo, level: string, now: number): SlotInfo {
  if (!level) return info;
  return { ...info, used: true, level, updated: now };
}

/** Record finishing a level. Finishing one you have already finished is not
 *  progress, so the list is a set. */
export function completeLevel(info: SlotInfo, level: string, now: number): SlotInfo {
  if (!level || info.completed.includes(level)) return { ...info, updated: now };
  return { ...info, used: true, completed: [...info.completed, level], updated: now };
}

/**
 * Which levels a player may jump to. Derived from what they actually did
 * rather than stored, so it cannot drift out of step — and so re-ordering
 * levels in the editor does the sensible thing.
 *
 * A level is open if it is the first one, if they have finished it, if they
 * have finished the one before it, or if it is where they are standing right
 * now. The last two clauses matter more than they look: the first level of a
 * real game is usually a MENU, which nobody ever "finishes", so a strict
 * finished-in-order rule locks the whole game behind a title screen. What it
 * still refuses is a jump into the middle: a level you have not reached, not
 * finished, and whose predecessor you have not finished, stays shut.
 */
export function unlockedLevels(info: SlotInfo, all: readonly string[]): string[] {
  return all.filter(
    (name, i) =>
      i === 0 ||
      info.completed.includes(name) ||
      info.completed.includes(all[i - 1]!) ||
      name === info.level,
  );
}

export function isUnlocked(info: SlotInfo, all: readonly string[], level: string): boolean {
  return unlockedLevels(info, all).includes(level);
}

/** "4m" / "1h 20m" / "45s" — short enough to sit on a slot button. */
export function formatPlayed(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The one line under a slot's button. */
export function summarize(info: SlotInfo): string {
  if (!info.used) return 'Empty';
  const bits = [info.level || 'Start'];
  if (info.completed.length) bits.push(`${info.completed.length} done`);
  if (info.coins) bits.push(`${info.coins} 🪙`);
  bits.push(formatPlayed(info.playedSecs));
  return bits.join(' · ');
}

/** The slot a "just let me play" button should use: the most recent run if
 *  there is one, otherwise the first empty one. */
export function suggestSlot(slots: readonly SlotInfo[]): number {
  const used = slots.filter((s) => s.used);
  if (used.length) return used.reduce((a, b) => (b.updated > a.updated ? b : a)).slot;
  return slots.find((s) => !s.used)?.slot ?? 1;
}

/** Replace one slot in the list, leaving the others alone. */
export function withSlot(slots: readonly SlotInfo[], info: SlotInfo): SlotInfo[] {
  return slots.map((s) => (s.slot === info.slot ? info : s));
}
