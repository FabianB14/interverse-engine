/**
 * 🧰 A toolbar that never runs off the edge.
 *
 * The top bar grew to two dozen controls, and on a laptop the last few —
 * including ▶ Play — simply fell off the right-hand side, with no scrollbar
 * and no way to reach them. Hiding everything behind a menu on every screen
 * would be the easy fix and the wrong one, so this is a "priority+" bar:
 * controls stay out in the open while there is room, and only what does not
 * fit moves into a ⋯ More panel, least-important first.
 *
 * How much fits is decided by asking the browser whether the bar still
 * overflows after each eviction, rather than by predicting widths. Predicting
 * meant measuring before fonts had loaded and before "where this project
 * lives" had any text, and being wrong in the one direction that matters.
 * WHAT goes first is a judgement call, so that part is a pure, tested table.
 */

export interface BarItem {
  id: string;
  /** Higher leaves the bar sooner. Ties keep declaration order, last first. */
  evict: number;
}

/**
 * The order things should be given up in. Least-important first, and within
 * one importance band the right-most control goes before the left-most, so
 * the bar empties from the end rather than developing holes.
 */
export function evictionOrder<T extends BarItem>(items: readonly T[]): T[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.evict - a.it.evict || b.i - a.i)
    .map((e) => e.it);
}

/** Groups, in the order they appear in the ⋯ panel. */
export const TOOLBAR_GROUPS = [
  { id: 'level', title: '🗺 This level' },
  { id: 'project', title: '📦 Whole project' },
  { id: 'game', title: '🎮 Game options' },
  { id: 'file', title: '📁 File' },
] as const;

export type ToolbarGroup = (typeof TOOLBAR_GROUPS)[number]['id'];

/**
 * The numbers here are what actually decides what disappears when the window
 * gets narrow, so they are the interesting part of this file: level controls
 * survive longest because they are what you touch while building, File goes
 * first because you touch it once.
 */
export const TOOLBAR_ITEMS: readonly { id: string; group: ToolbarGroup; evict: number }[] = [
  { id: 'btn-tiles', group: 'level', evict: 1 },
  { id: 'view-select', group: 'level', evict: 2 },
  { id: 'size-select', group: 'level', evict: 2 },
  { id: 'lbl-gravity', group: 'level', evict: 3 },
  { id: 'btn-frame', group: 'level', evict: 4 },
  { id: 'btn-hud', group: 'project', evict: 5 },
  { id: 'btn-assets', group: 'project', evict: 5 },
  { id: 'btn-controls', group: 'project', evict: 5 },
  { id: 'btn-db', group: 'project', evict: 6 },
  { id: 'btn-publish', group: 'file', evict: 6 },
  { id: 'lbl-multiplayer', group: 'game', evict: 7 },
  { id: 'lbl-interverse', group: 'game', evict: 7 },
  // Pure information, and the ⋯ panel is a perfectly good place to read it.
  { id: 'project-where', group: 'project', evict: 7 },
  { id: 'btn-import', group: 'file', evict: 8 },
  { id: 'btn-export', group: 'file', evict: 8 },
  { id: 'btn-install', group: 'file', evict: 9 },
];

export interface ToolbarApi {
  relayout: () => void;
  /** ids currently living in the ⋯ panel. */
  overflowed: () => string[];
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  toggle: () => void;
}

/**
 * Take over `bar`, moving what does not fit into `panel`. Items keep their
 * identity — the same element moves — so every click handler wired elsewhere
 * keeps working whichever side of the fold it is on.
 */
export function wireToolbar(bar: HTMLElement, panel: HTMLElement, moreBtn: HTMLElement): ToolbarApi {
  // The bar's authored running order. Remembering a per-item "next sibling"
  // instead is the obvious approach and it is wrong: once two neighbours are
  // both in the panel, one's anchor is no longer in the bar and insertBefore
  // throws — which silently froze the layout at whatever it was on boot.
  const order = Array.from(bar.children) as HTMLElement[];

  const groupRows = new Map<string, HTMLElement>();
  for (const g of TOOLBAR_GROUPS) {
    const box = document.createElement('div');
    box.dataset.group = g.id;
    box.style.display = 'none';
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = g.title;
    const row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:center';
    box.append(head, row);
    panel.appendChild(box);
    groupRows.set(g.id, row);
  }

  const known = TOOLBAR_ITEMS.filter((it) => order.some((el) => el.id === it.id));
  const giveUp = evictionOrder(known);
  const inPanel = new Set<string>();

  const goHome = (): void => {
    for (const el of order) bar.appendChild(el);
    inPanel.clear();
  };
  const goPanel = (id: string, group: string): void => {
    const el = document.getElementById(id);
    const row = groupRows.get(group);
    if (!el || !row) return;
    row.appendChild(el);
    inPanel.add(id);
  };
  // 1px of slack: sub-pixel widths must not cost anyone a button.
  const overflows = (): boolean => bar.scrollWidth > bar.clientWidth + 1;

  let relaying = false;
  const relayout = (): void => {
    if (relaying) return;
    relaying = true;
    try {
      goHome();
      bar.classList.remove('compact');
      moreBtn.style.display = 'none';
      for (const row of groupRows.values()) row.parentElement!.style.display = 'none';
      if (!overflows()) return;
      // Before hiding anything, try dropping the words and keeping the icons.
      // A button you can see and guess at beats one you have to go looking
      // for, and every one of them carries a tooltip.
      bar.classList.add('compact');
      if (!overflows()) return;
      // Something still has to go, and once it does the ⋯ button needs room
      // too — so show it before deciding how much else must follow.
      moreBtn.style.display = '';
      for (const it of giveUp) {
        if (!overflows()) break;
        goPanel(it.id, it.group);
      }
      for (const row of groupRows.values()) {
        row.parentElement!.style.display = row.children.length ? '' : 'none';
      }
      // Everything fit after all (the ⋯ button was the only thing over the
      // line) — put it away rather than showing an empty menu.
      if (!inPanel.size) moreBtn.style.display = 'none';
    } finally {
      relaying = false;
    }
  };

  const isOpen = (): boolean => panel.classList.contains('open');
  const close = (): void => panel.classList.remove('open');
  const open = (): void => {
    if (inPanel.size) panel.classList.add('open');
  };
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    if (isOpen()) close();
    else open();
  };
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !panel.contains(e.target as Node) && e.target !== moreBtn) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      close();
      e.stopPropagation();
    }
  });

  // Re-measuring has to be driven by the things that actually change width.
  // Watching the bar alone is useless: it is always the full window wide, so
  // it never resizes, and the boot-time layout would stand forever.
  let queued = 0;
  const schedule = (): void => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      relayout();
    });
  };
  const watch = new ResizeObserver(schedule);
  watch.observe(bar);
  for (const el of order) watch.observe(el);
  window.addEventListener('resize', schedule);
  // Fonts change every button's width, and they land after first paint.
  void document.fonts?.ready.then(schedule);
  relayout();

  return {
    relayout,
    overflowed: () => [...inPanel],
    open,
    close,
    isOpen,
    toggle: () => (isOpen() ? close() : open()),
  };
}
