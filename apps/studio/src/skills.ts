/**
 * Skill tree system — defined from a scene script via api.skills.define(),
 * rendered as an in-engine overlay (panel + node buttons), persisted per
 * project with the engine save store. Nodes unlock with points; `requires`
 * gates deeper tiers, so both linear paths and branching trees work.
 */
import { Graphics, Text } from 'pixi.js';
import { Entity, createSave, darken } from '@interverse/engine';
import type { Scene } from '@interverse/engine';
import { UIButton } from '@interverse/ui';

export interface SkillNode {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  /** Node ids that must be unlocked first. */
  requires?: string[];
  blurb?: string;
}

export interface SkillTreeDef {
  title?: string;
  points: number;
  nodes: SkillNode[];
}

export class SkillTree {
  private def: SkillTreeDef = { points: 0, nodes: [] };
  private unlocked = new Set<string>();
  private points = 0;
  private root: Entity | null = null;
  private unlockCbs: ((id: string) => void)[] = [];
  private save = createSave('studio-skills');

  constructor(
    private readonly scene: Scene,
    private readonly projectName: string,
  ) {}

  private get saveKey(): string {
    return `${this.projectName}`;
  }

  define(def: SkillTreeDef): void {
    this.def = def;
    const stored = this.save.get<{ points: number; unlocked: string[] }>(this.saveKey, {
      points: def.points,
      unlocked: [],
    });
    this.points = stored.points;
    this.unlocked = new Set(stored.unlocked.filter((id) => def.nodes.some((n) => n.id === id)));
  }

  private persist(): void {
    this.save.set(this.saveKey, { points: this.points, unlocked: [...this.unlocked] });
  }

  addPoints(n: number): void {
    this.points += n;
    this.persist();
    this.redraw();
  }

  getPoints(): number {
    return this.points;
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  unlockedIds(): string[] {
    return [...this.unlocked];
  }

  nodeCount(): number {
    return this.def.nodes.length;
  }

  onUnlock(cb: (id: string) => void): void {
    this.unlockCbs.push(cb);
  }

  canUnlock(node: SkillNode): boolean {
    if (this.unlocked.has(node.id) || this.points < node.cost) return false;
    return (node.requires ?? []).every((r) => this.unlocked.has(r));
  }

  unlock(id: string): boolean {
    const node = this.def.nodes.find((n) => n.id === id);
    if (!node || !this.canUnlock(node)) return false;
    this.points -= node.cost;
    this.unlocked.add(id);
    this.persist();
    for (const cb of this.unlockCbs) cb(id);
    this.redraw();
    return true;
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

  /** Depth = longest requires-chain, used as the row. */
  private depth(node: SkillNode, seen = new Set<string>()): number {
    const reqs = node.requires ?? [];
    if (!reqs.length || seen.has(node.id)) return 0;
    seen.add(node.id);
    return (
      1 +
      Math.max(
        ...reqs.map((r) => {
          const p = this.def.nodes.find((n) => n.id === r);
          return p ? this.depth(p, seen) : 0;
        }),
      )
    );
  }

  private redraw(): void {
    if (!this.root) return;
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
    const W = 660;
    const rows = new Map<number, SkillNode[]>();
    for (const n of this.def.nodes) {
      const d = this.depth(n);
      rows.set(d, [...(rows.get(d) ?? []), n]);
    }
    const rowCount = Math.max(...[...rows.keys()], 0) + 1;
    const H = 190 + rowCount * 150;
    const panel = new Graphics()
      .roundRect(0, 0, W, H, 22)
      .fill({ color: 0x171326, alpha: 0.97 })
      .roundRect(0, 0, W, H, 22)
      .stroke({ color: 0xc77dff, width: 3, alpha: 0.7 });
    this.root.addChild(panel);
    this.root.position.set((720 - W) / 2, 120);

    const title = new Text({
      text: this.def.title ?? 'SKILLS',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 34, fontWeight: '800', fill: 0xe6e4f0 },
    });
    title.anchor.set(0.5);
    title.position.set(W / 2, 44);
    this.root.addChild(title);
    const pts = new Text({
      text: `✦ ${this.points} points`,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 24, fontWeight: '800', fill: 0xffd166 },
    });
    pts.anchor.set(0.5);
    pts.position.set(W / 2, 84);
    this.root.addChild(pts);

    // Connector lines first, then node buttons.
    const nodePos = new Map<string, { x: number; y: number }>();
    for (const [row, nodes] of rows) {
      nodes.forEach((n, i) => {
        nodePos.set(n.id, {
          x: (W / (nodes.length + 1)) * (i + 1),
          y: 160 + row * 150,
        });
      });
    }
    const lines = new Graphics();
    for (const n of this.def.nodes) {
      for (const r of n.requires ?? []) {
        const a = nodePos.get(r);
        const b = nodePos.get(n.id);
        if (a && b) {
          lines
            .moveTo(a.x, a.y + 36)
            .lineTo(b.x, b.y - 36)
            .stroke({
              color: this.unlocked.has(r) ? 0x8affc1 : 0x3a3550,
              width: 4,
              alpha: 0.8,
            });
        }
      }
    }
    this.root.addChild(lines);

    for (const n of this.def.nodes) {
      const p = nodePos.get(n.id)!;
      const done = this.unlocked.has(n.id);
      const usable = this.canUnlock(n);
      const fill = done ? 0x8affc1 : usable ? 0xffd166 : 0x2a2740;
      const btn = new UIButton(`${n.emoji} ${n.name}${done ? ' ✓' : ` · ${n.cost}✦`}`, {
        width: 250,
        height: 66,
        fontSize: 20,
        fill,
        textColor: done || usable ? darken(fill, 0.75) : 0x77738f,
        onTap: () => {
          this.unlock(n.id);
        },
      });
      btn.position.set(p.x, p.y);
      this.root.addChild(btn);
    }

    const close = new UIButton('CLOSE', {
      width: 180,
      height: 64,
      fontSize: 24,
      fill: 0x2a3a4a,
      textColor: 0xe6e4f0,
      onTap: () => this.close(),
    });
    close.position.set(W / 2, H - 52);
    this.root.addChild(close);
  }
}
