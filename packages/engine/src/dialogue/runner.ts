/**
 * Dialogue system core (§4.7): speaker, branching via choices, flags.
 * Authored as plain JSON so Claude Code can generate and edit it easily.
 * Presentation (typewriter box, portraits) lives in @interverse/ui.
 */

export interface DialogueChoice {
  text: string;
  /** Node to jump to; omit to end the conversation. */
  next?: string;
  /** Flags to set when picked. */
  set?: string[];
}

export interface DialogueNode {
  speaker?: string;
  text: string;
  /** Node to advance to; omit (with no choices) to end. */
  next?: string;
  choices?: DialogueChoice[];
  /** Flags to set when this node is entered. */
  set?: string[];
}

export interface DialogueData {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export class DialogueRunner {
  readonly flags: Set<string>;
  private nodeId: string | null = null;

  constructor(
    private readonly data: DialogueData,
    flags: Iterable<string> = [],
  ) {
    this.flags = new Set(flags);
  }

  get node(): DialogueNode | null {
    return this.nodeId !== null ? (this.data.nodes[this.nodeId] ?? null) : null;
  }

  get currentId(): string | null {
    return this.nodeId;
  }

  get done(): boolean {
    return this.nodeId === null;
  }

  /** Begin (or restart) at a node — defaults to the data's start node. */
  start(id: string = this.data.start): void {
    this.enter(id);
  }

  /** Advance past a node that has no choices. */
  advance(): void {
    const n = this.node;
    if (!n || (n.choices && n.choices.length > 0)) return;
    if (n.next !== undefined) {
      this.enter(n.next);
    } else {
      this.nodeId = null;
    }
  }

  /** Pick a choice on the current node. */
  choose(index: number): void {
    const choice = this.node?.choices?.[index];
    if (!choice) return;
    for (const f of choice.set ?? []) this.flags.add(f);
    if (choice.next !== undefined) {
      this.enter(choice.next);
    } else {
      this.nodeId = null;
    }
  }

  private enter(id: string): void {
    const n = this.data.nodes[id];
    if (!n) {
      this.nodeId = null;
      return;
    }
    this.nodeId = id;
    for (const f of n.set ?? []) this.flags.add(f);
  }
}
