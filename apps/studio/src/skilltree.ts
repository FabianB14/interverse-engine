/**
 * 🌳 Skill tree model — branches, tiers, multi-rank cells.
 *
 * Modelled on the Borderlands character sheet: several named BRANCHES side
 * by side, each a grid of TIERS, each cell investable up to maxRank (the
 * "1/5" badge), and later tiers gated on points already spent *in that
 * branch*. That per-branch gate is the rule that makes a build a choice —
 * spreading points thin never opens the deep skills.
 *
 * Kept pure and pixi-free so the gating rules are unit-testable; skills.ts
 * owns the drawing.
 */

export interface SkillNode {
  id: string;
  name: string;
  emoji: string;
  /** Points per rank. */
  cost: number;
  /** How many times it can be invested in (the N in "2/N"). */
  maxRank: number;
  /** Row within its branch. Tier 0 is always open. */
  tier: number;
  /** Node ids that must have at least one rank first. */
  requires?: string[];
  blurb?: string;
}

export interface SkillBranch {
  id: string;
  name: string;
  /** Accent colour for the header bar and invested cells. */
  color: number;
  /** The big hex at the top — a branch's identity skill. */
  action?: SkillNode;
  nodes: SkillNode[];
}

export interface SkillTreeDef {
  title?: string;
  points: number;
  branches: SkillBranch[];
  /** Points spent in a branch to open each next tier (Borderlands: 5). */
  pointsPerTier: number;
}

/** Palette for branches an author did not colour. */
export const BRANCH_COLORS = [0xff6b6b, 0x6bc7ff, 0xffd166, 0x8affc1, 0xc77dff] as const;

/** Why an investment is refused — the render turns these into cell states. */
export type InvestBlock = 'ok' | 'maxed' | 'noPoints' | 'needsTier' | 'needsRequires';

interface LegacyNode {
  id: string;
  name?: string;
  emoji?: string;
  cost?: number;
  maxRank?: number;
  tier?: number;
  requires?: string[];
  blurb?: string;
}

/** Longest requires-chain, used as the tier when an author gives none. This
 *  is how every pre-branch tree keeps laying out exactly as it did. */
export function depthOf(node: LegacyNode, all: LegacyNode[], seen = new Set<string>()): number {
  const reqs = node.requires ?? [];
  if (!reqs.length || seen.has(node.id)) return 0;
  seen.add(node.id);
  return (
    1 +
    Math.max(
      0,
      ...reqs.map((r) => {
        const p = all.find((n) => n.id === r);
        return p ? depthOf(p, all, seen) : 0;
      }),
    )
  );
}

/**
 * Accept both shapes: the new `{branches}` form and the original
 * `{title, points, nodes}` one, which every existing template and published
 * game still passes. Legacy trees become a single implicit branch with
 * single-rank cells and no tier gate, so they render and behave exactly as
 * before.
 */
export function normalizeSkillTree(input: unknown): SkillTreeDef {
  const raw = (input ?? {}) as Partial<SkillTreeDef> & { nodes?: LegacyNode[] };
  const points = Math.max(0, Number(raw.points) || 0);
  const title = typeof raw.title === 'string' ? raw.title : 'SKILLS';

  const node = (n: LegacyNode, fallbackTier: number): SkillNode => ({
    id: String(n.id),
    name: n.name ?? String(n.id),
    emoji: n.emoji ?? '✦',
    cost: Math.max(1, Number(n.cost) || 1),
    maxRank: Math.max(1, Number(n.maxRank) || 1),
    tier: Number.isFinite(n.tier) ? Math.max(0, Number(n.tier)) : fallbackTier,
    ...(n.requires?.length ? { requires: n.requires.map(String) } : {}),
    ...(n.blurb ? { blurb: n.blurb } : {}),
  });

  let branches: SkillBranch[];
  if (Array.isArray(raw.branches) && raw.branches.length) {
    branches = raw.branches
      .filter((b): b is SkillBranch => !!b && typeof b === 'object' && Array.isArray(b.nodes))
      .map((b, i) => {
        const list = b.nodes as unknown as LegacyNode[];
        return {
          id: String(b.id ?? `branch-${i}`),
          name: b.name ?? `Branch ${i + 1}`,
          color: Number.isFinite(b.color) ? b.color : BRANCH_COLORS[i % BRANCH_COLORS.length]!,
          ...(b.action ? { action: node(b.action as unknown as LegacyNode, 0) } : {}),
          nodes: list.map((n) => node(n, depthOf(n, list))),
        };
      });
  } else {
    // Legacy: one branch, tiers from the requires-chain, no tier gate.
    const list = (raw.nodes ?? []).filter((n): n is LegacyNode => !!n && typeof n === 'object' && !!n.id);
    branches = [
      {
        id: 'skills',
        name: title,
        color: BRANCH_COLORS[4]!,
        nodes: list.map((n) => node(n, depthOf(n, list))),
      },
    ];
  }

  const perTier = Number(raw.pointsPerTier);
  return {
    title,
    points,
    branches,
    // A legacy tree must not suddenly gate: its nodes already gate through
    // `requires`, and adding a point wall would lock existing saves out.
    pointsPerTier: Number.isFinite(perTier) ? Math.max(0, perTier) : Array.isArray(raw.branches) ? 5 : 0,
  };
}

/** Investment state, separate from the def so a respec is just a reset. */
export class SkillState {
  private ranks = new Map<string, number>();
  private pts = 0;

  constructor(private def: SkillTreeDef) {
    this.pts = def.points;
  }

  setDef(def: SkillTreeDef): void {
    this.def = def;
  }

  get points(): number {
    return this.pts;
  }

  addPoints(n: number): void {
    this.pts = Math.max(0, this.pts + n);
  }

  rankOf(id: string): number {
    return this.ranks.get(id) ?? 0;
  }

  isUnlocked(id: string): boolean {
    return this.rankOf(id) > 0;
  }

  unlockedIds(): string[] {
    return [...this.ranks.entries()].filter(([, r]) => r > 0).map(([id]) => id);
  }

  private branchOf(id: string): SkillBranch | undefined {
    return this.def.branches.find((b) => b.nodes.some((n) => n.id === id) || b.action?.id === id);
  }

  private nodeOf(id: string): SkillNode | undefined {
    for (const b of this.def.branches) {
      if (b.action?.id === id) return b.action;
      const n = b.nodes.find((x) => x.id === id);
      if (n) return n;
    }
    return undefined;
  }

  /** Points spent inside one branch — what the tier gate measures. */
  spentIn(branchId: string): number {
    const b = this.def.branches.find((x) => x.id === branchId);
    if (!b) return 0;
    let total = 0;
    for (const n of [...(b.action ? [b.action] : []), ...b.nodes]) total += this.rankOf(n.id) * n.cost;
    return total;
  }

  totalSpent(): number {
    return this.def.branches.reduce((sum, b) => sum + this.spentIn(b.id), 0);
  }

  /** Points needed in this branch before a tier opens. */
  tierGate(tier: number): number {
    return tier * this.def.pointsPerTier;
  }

  canInvest(id: string): InvestBlock {
    const n = this.nodeOf(id);
    if (!n) return 'needsRequires';
    if (this.rankOf(id) >= n.maxRank) return 'maxed';
    for (const r of n.requires ?? []) if (!this.isUnlocked(r)) return 'needsRequires';
    const b = this.branchOf(id);
    if (b && this.spentIn(b.id) < this.tierGate(n.tier)) return 'needsTier';
    if (this.pts < n.cost) return 'noPoints';
    return 'ok';
  }

  invest(id: string): boolean {
    if (this.canInvest(id) !== 'ok') return false;
    const n = this.nodeOf(id)!;
    this.pts -= n.cost;
    this.ranks.set(id, this.rankOf(id) + 1);
    return true;
  }

  /** Give every spent point back — cheap, and kids retry constantly. */
  respec(): number {
    const back = this.totalSpent();
    this.ranks.clear();
    this.pts += back;
    return back;
  }

  save(): { points: number; ranks: [string, number][] } {
    return { points: this.pts, ranks: [...this.ranks.entries()] };
  }

  /** Restore, clamping to the CURRENT def — an author who lowers a maxRank
   *  or deletes a node must not strand a player's points. */
  load(saved: unknown): void {
    const s = (saved ?? {}) as { points?: number; ranks?: [string, number][]; unlocked?: string[] };
    this.ranks.clear();
    let refund = 0;
    // v1 saves stored a flat unlocked-id list with no ranks.
    const pairs: [string, number][] = Array.isArray(s.ranks)
      ? s.ranks
      : Array.isArray(s.unlocked)
        ? s.unlocked.map((id) => [id, 1] as [string, number])
        : [];
    for (const [id, rank] of pairs) {
      const n = this.nodeOf(id);
      if (!n || !Number.isFinite(rank) || rank <= 0) continue;
      const kept = Math.min(Math.floor(rank), n.maxRank);
      if (kept > 0) this.ranks.set(id, kept);
      refund += (Math.floor(rank) - kept) * n.cost;
    }
    this.pts = Math.max(0, (Number.isFinite(s.points) ? Number(s.points) : this.def.points) + refund);
  }
}

/** Highest tier index present, so the renderer knows how many rows to draw. */
export function tierCount(b: SkillBranch): number {
  return b.nodes.reduce((max, n) => Math.max(max, n.tier), 0) + 1;
}
