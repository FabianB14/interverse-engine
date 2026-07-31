/**
 * 🌳 Skill tree rendering — the Borderlands character sheet, in-engine.
 *
 * Branch columns with coloured header bars, a hex ACTION skill at the top
 * of each, then a grid of square cells in tiers, each showing a rank badge
 * ("1/5") and wired to its prerequisites. Later tiers stay locked until
 * enough points are spent in that branch.
 *
 * Layout is responsive because the design space is portrait 720 wide and
 * three columns do not fit: portrait shows ONE branch with a switcher
 * across the top; a landscape/2.5D window (≥1100) shows them side by side.
 * Every tappable thing stays ≥84 design units.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Entity, createSave, darken, lighten } from '@interverse/engine';
import type { Scene } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { drawIcon, isIconId } from './icons.js';
import { SkillState, normalizeSkillTree, tierCount } from './skilltree.js';
import type { InvestBlock, SkillBranch, SkillNode, SkillTreeDef } from './skilltree.js';

export type { SkillNode, SkillBranch, SkillTreeDef } from './skilltree.js';

const CELL = 92;
const CELL_GAP = 16;
const ROW_H = CELL + 34;
const COL_W = CELL * 3 + CELL_GAP * 2 + 24;

/** Cell colours per state — invested cells take the branch accent. */
function cellFill(state: InvestBlock, rank: number, accent: number): { fill: number; text: number } {
  if (rank > 0) return { fill: accent, text: darken(accent, 0.78) };
  if (state === 'ok') return { fill: 0x3b3457, text: 0xe6e4f0 };
  return { fill: 0x241f36, text: 0x6b6688 };
}

export class SkillTree {
  private def: SkillTreeDef = { points: 0, branches: [], pointsPerTier: 0 };
  private state = new SkillState(this.def);
  private root: Entity | null = null;
  private unlockCbs: ((id: string) => void)[] = [];
  private save = createSave('studio-skills');
  /** Portrait shows one branch at a time. */
  private branchIndex = 0;
  /** Shrink-to-fit factor from the last redraw (1 = nothing was scaled). */
  private lastFit = 1;

  constructor(
    private readonly scene: Scene,
    private readonly projectName: string,
    private readonly viewWidth: () => number = () => 720,
    private readonly viewHeight: () => number = () => 1280,
  ) {}

  private get saveKey(): string {
    return `${this.projectName}`;
  }

  define(def: unknown): void {
    this.def = normalizeSkillTree(def);
    this.state = new SkillState(this.def);
    this.state.load(this.save.get<unknown>(this.saveKey, null));
    this.redraw();
  }

  private persist(): void {
    this.save.set(this.saveKey, this.state.save());
  }

  addPoints(n: number): void {
    this.state.addPoints(n);
    this.persist();
    this.redraw();
  }

  getPoints(): number {
    return this.state.points;
  }

  isUnlocked(id: string): boolean {
    return this.state.isUnlocked(id);
  }

  rankOf(id: string): number {
    return this.state.rankOf(id);
  }

  unlockedIds(): string[] {
    return this.state.unlockedIds();
  }

  branchCount(): number {
    return this.def.branches.length;
  }

  spentIn(branchId: string): number {
    return this.state.spentIn(branchId);
  }

  canInvest(id: string): InvestBlock {
    return this.state.canInvest(id);
  }

  nodeCount(): number {
    return this.def.branches.reduce((n, b) => n + b.nodes.length + (b.action ? 1 : 0), 0);
  }

  onUnlock(cb: (id: string) => void): void {
    this.unlockCbs.push(cb);
  }

  /** Invest one rank. Kept named `unlock` as well for older scripts. */
  invest(id: string): boolean {
    if (!this.state.invest(id)) return false;
    this.persist();
    for (const cb of this.unlockCbs) cb(id);
    this.redraw();
    return true;
  }

  unlock(id: string): boolean {
    return this.invest(id);
  }

  respec(): number {
    const back = this.state.respec();
    this.persist();
    this.redraw();
    return back;
  }

  get isOpen(): boolean {
    return !!this.root;
  }

  open(): void {
    if (this.root) return;
    this.root = new Entity();
    this.scene.add(this.root);
    this.redraw();
  }

  close(): void {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root = null;
  }

  /** Which layout the current viewport gets — asserted by the tests. */
  layout(): { mode: 'columns' | 'single'; cols: number; cell: number; fit: number } {
    const wide = this.viewWidth() >= 1100 && this.def.branches.length > 1;
    return {
      mode: wide ? 'columns' : 'single',
      cols: wide ? this.def.branches.length : 1,
      cell: Math.round(CELL * this.lastFit),
      fit: this.lastFit,
    };
  }

  private redraw(): void {
    if (!this.root) return;
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
    const { mode } = this.layout();
    const shown = mode === 'columns' ? this.def.branches : this.def.branches.slice(this.branchIndex, this.branchIndex + 1);
    const rows = Math.max(1, ...shown.map(tierCount));

    // Header band has to clear the title AND the points line above the
    // branch bars; the body has to fit the action-skill row on top of the
    // tier grid, or the deepest tier spills out through the panel floor.
    const actionRows = shown.some((b) => b.action) ? 1 : 0;
    const headerH = mode === 'columns' ? 150 : 200;
    const W = Math.min(this.viewWidth() - 24, COL_W * shown.length + 28);
    const H = headerH + (rows + actionRows) * ROW_H + 116;

    const panel = new Graphics()
      .roundRect(0, 0, W, H, 20)
      .fill({ color: 0x14111f, alpha: 0.98 })
      .roundRect(0, 0, W, H, 20)
      .stroke({ color: 0x3a3550, width: 3 });
    this.root.addChild(panel);
    // A three-branch tree is taller than a rotated phone's 720-unit window,
    // so shrink to fit rather than letting the title and CLOSE button fall
    // off the top and bottom of the screen.
    const fit = Math.min(1, (this.viewWidth() - 20) / W, (this.viewHeight() - 20) / H);
    this.root.scale.set(fit);
    this.lastFit = fit;
    this.root.position.set(
      Math.max(10, (this.viewWidth() - W * fit) / 2),
      Math.max(10, (this.viewHeight() - H * fit) / 2),
    );

    this.root.addChild(
      label(this.def.title ?? 'SKILLS', W / 2, 30, { size: 30, color: 0xe6e4f0, bold: true }),
    );
    this.root.addChild(
      label(`✦ ${this.state.points} points to spend`, W / 2, 62, { size: 21, color: 0xffd166, bold: true }),
    );

    // Portrait: a row of branch buttons standing in for side-by-side columns.
    if (mode === 'single' && this.def.branches.length > 1) {
      const bw = Math.min(198, (W - 28) / this.def.branches.length);
      this.def.branches.forEach((b, i) => {
        const on = i === this.branchIndex;
        const btn = new UIButton(b.name, {
          width: bw - 8,
          height: 56,
          fontSize: 17,
          fill: on ? b.color : 0x2a2740,
          textColor: on ? darken(b.color, 0.8) : 0x9a97b8,
          onTap: () => {
            this.branchIndex = i;
            this.redraw();
          },
        });
        btn.position.set(14 + bw * i + bw / 2 - 4, 124);
        this.root!.addChild(btn);
      });
    }

    shown.forEach((branch, ci) => {
      const x0 = 14 + ci * COL_W;
      this.drawBranch(branch, x0, headerH, mode === 'columns');
    });

    const close = new UIButton('CLOSE', {
      width: 172,
      height: 60,
      fontSize: 22,
      fill: 0x2a3a4a,
      textColor: 0xe6e4f0,
      onTap: () => this.close(),
    });
    close.position.set(W / 2 - 96, H - 44);
    this.root.addChild(close);

    const reset = new UIButton('↺ RESPEC', {
      width: 172,
      height: 60,
      fontSize: 20,
      fill: 0x4a2a3a,
      textColor: 0xffc9d2,
      onTap: () => this.respec(),
    });
    reset.position.set(W / 2 + 96, H - 44);
    this.root.addChild(reset);
  }

  private drawBranch(branch: SkillBranch, x0: number, y0: number, showHeader: boolean): void {
    const root = this.root!;
    const spent = this.state.spentIn(branch.id);
    const midX = x0 + COL_W / 2 - 12;

    if (showHeader) {
      const bar = new Graphics()
        .roundRect(x0, y0 - 62, COL_W - 20, 42, 10)
        .fill({ color: branch.color, alpha: 0.9 });
      root.addChild(bar);
      root.addChild(label(branch.name, midX, y0 - 41, { size: 19, color: darken(branch.color, 0.8), bold: true }));
    }
    root.addChild(label(`${spent} spent`, midX, y0 - 12, { size: 15, color: 0x9a97b8 }));

    // The identity skill: a hex above the grid.
    if (branch.action) {
      this.drawCell(branch.action, branch, midX, y0 + 2, true);
    }

    const gridTop = y0 + (branch.action ? ROW_H : 0);
    const byTier = new Map<number, SkillNode[]>();
    for (const n of branch.nodes) byTier.set(n.tier, [...(byTier.get(n.tier) ?? []), n]);

    // Prerequisite lines first so cells sit on top of them.
    const pos = new Map<string, { x: number; y: number }>();
    for (const [tier, nodes] of byTier) {
      nodes.forEach((n, i) => {
        const perRow = Math.min(3, nodes.length);
        const spread = (CELL + CELL_GAP) * (perRow - 1);
        pos.set(n.id, { x: midX - spread / 2 + (CELL + CELL_GAP) * (i % perRow), y: gridTop + tier * ROW_H + CELL / 2 });
      });
    }
    const lines = new Graphics();
    for (const n of branch.nodes) {
      for (const r of n.requires ?? []) {
        const a = pos.get(r);
        const b = pos.get(n.id);
        if (a && b) {
          lines
            .moveTo(a.x, a.y + CELL / 2)
            .lineTo(b.x, b.y - CELL / 2)
            .stroke({ color: this.state.isUnlocked(r) ? branch.color : 0x332e4a, width: 3, alpha: 0.85 });
        }
      }
    }
    root.addChild(lines);

    for (const n of branch.nodes) {
      const p = pos.get(n.id)!;
      this.drawCell(n, branch, p.x, p.y - CELL / 2, false);
    }

    // A locked tier says exactly what opens it, rather than just refusing.
    for (const [tier] of byTier) {
      const need = this.state.tierGate(tier);
      if (need > spent) {
        root.addChild(
          label(`🔒 spend ${need} in ${branch.name} to unlock`, midX, gridTop + tier * ROW_H - 12, {
            size: 13,
            color: 0x8a7fb0,
          }),
        );
      }
    }
  }

  private drawCell(n: SkillNode, branch: SkillBranch, cx: number, top: number, hex: boolean): void {
    const rank = this.state.rankOf(n.id);
    const block = this.state.canInvest(n.id);
    const { fill, text } = cellFill(block, rank, branch.color);
    const box = new Container();
    box.position.set(cx, top);

    const g = new Graphics();
    if (hex) {
      const r = CELL / 2 + 6;
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(Math.cos(a) * r, Math.sin(a) * r + CELL / 2);
      }
      g.poly(pts).fill(fill).poly(pts).stroke({ color: lighten(fill, 0.3), width: 3 });
    } else {
      g.roundRect(-CELL / 2, 0, CELL, CELL, 12)
        .fill(fill)
        .roundRect(-CELL / 2, 0, CELL, CELL, 12)
        .stroke({ color: rank > 0 ? lighten(branch.color, 0.35) : 0x3a3550, width: 2 });
    }
    box.addChild(g);

    // Icon ids draw as vector art; anything else falls back to its emoji.
    if (isIconId(n.emoji)) {
      const icon = drawIcon(n.emoji, CELL * 0.52);
      icon.position.set(0, CELL / 2);
      box.addChild(icon);
    } else {
      box.addChild(label(n.emoji, 0, CELL / 2, { size: 34, color: text }));
    }

    box.addChild(label(n.name.slice(0, 14), 0, CELL + 10, { size: 13, color: rank > 0 ? 0xe6e4f0 : 0x9a97b8 }));
    box.addChild(
      label(`${rank}/${n.maxRank}`, CELL / 2 - 16, 12, {
        size: 15,
        color: rank > 0 ? darken(branch.color, 0.8) : 0xc9c5e0,
        bold: true,
      }),
    );
    if (block === 'needsTier') box.addChild(label('🔒', -CELL / 2 + 14, 12, { size: 15, color: 0x8a7fb0 }));

    box.eventMode = 'static';
    box.cursor = 'pointer';
    box.hitArea = { contains: (x: number, y: number) => x >= -CELL / 2 && x <= CELL / 2 && y >= 0 && y <= CELL + 20 };
    box.on('pointertap', () => this.invest(n.id));
    this.root!.addChild(box);
  }
}

function label(
  text: string,
  x: number,
  y: number,
  opts: { size: number; color: number; bold?: boolean },
): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: opts.size,
      fontWeight: opts.bold ? '800' : '600',
      fill: opts.color,
    },
  });
  t.anchor.set(0.5);
  t.position.set(x, y);
  return t;
}
