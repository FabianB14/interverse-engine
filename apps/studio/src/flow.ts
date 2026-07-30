/**
 * ⛓ Flow — the visual scripting map (Blueprints v1). Levels and every
 * actor with ⚡ events render as draggable node cards; wires show the
 * relationships that make quests tick: switch setters → switch-gated
 * events, and 🚪 go-to-level actions → level nodes. Clicking a node
 * selects the actor so the inspector edits it. This is the read/navigate
 * layer of the graph editor — wire-dragging authoring builds on it next.
 */
import type { StudioEditor } from './editor.js';
import type { EventAction, EventDef } from './model.js';

const TRIG_ICON: Record<EventDef['trigger'], string> = {
  tap: '👆',
  touch: '🚶',
  start: '🎬',
  every: '⏲',
};

const actionLabel = (a: EventAction): string => {
  switch (a.cmd) {
    case 'say':
      return `💬"${(a.text ?? '').slice(0, 12)}"`;
    case 'coins':
      return `🪙+${a.n ?? 1}`;
    case 'score':
      return `⭐+${a.n ?? 1}`;
    case 'xp':
      return `✨+${a.n ?? 5}`;
    case 'heal':
      return `❤+${a.n ?? 1}`;
    case 'sfx':
      return `🔊${a.text ?? 'pop'}`;
    case 'music':
      return `🎵${a.text ?? ''}`;
    case 'vfx':
      return `✨${a.text ?? ''}`;
    case 'spawn':
      return `🐣${a.text ?? 'crate'}`;
    case 'remove':
      return '🗑self';
    case 'goto':
      return `🚪${a.text ?? ''}`;
    case 'switchOn':
      return `🔛${a.text ?? ''}`;
    case 'switchOff':
      return `⏹${a.text ?? ''}`;
    case 'win':
      return '🏆win';
    case 'lose':
      return '💀lose';
  }
};

export function wireFlow(editor: StudioEditor): { render: () => void; nodeCount: () => number } {
  const canvas = document.getElementById('flow-canvas')!;
  /** Remembered drag positions (per node id, session-only). */
  const pos = new Map<string, { x: number; y: number }>();
  let count = 0;

  const render = (): void => {
    canvas.innerHTML = '';
    count = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '2400');
    svg.setAttribute('height', '1200');
    svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    canvas.appendChild(svg);

    interface Node {
      id: string;
      el: HTMLElement;
      switchesSet: string[];
      switchGates: string[];
      gotos: string[];
      levelName: string | null;
    }
    const nodes: Node[] = [];

    const place = (el: HTMLElement, id: string, x: number, y: number): void => {
      const p = pos.get(id) ?? { x, y };
      pos.set(id, p);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };

    const drawWires = (): void => {
      svg.innerHTML = '';
      const wire = (a: HTMLElement, b: HTMLElement, color: string): void => {
        const x1 = a.offsetLeft + a.offsetWidth;
        const y1 = a.offsetTop + a.offsetHeight / 2;
        const x2 = b.offsetLeft;
        const y2 = b.offsetTop + b.offsetHeight / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (x1 + x2) / 2;
        path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('opacity', '0.75');
        svg.appendChild(path);
      };
      for (const from of nodes) {
        for (const sw of from.switchesSet) {
          for (const to of nodes) {
            if (to !== from && to.switchGates.includes(sw)) wire(from.el, to.el, '#ffd166');
          }
        }
        for (const dest of from.gotos) {
          for (const to of nodes) {
            if (to.levelName !== null && (to.levelName === dest || to.id === `lvl:${dest}`)) {
              wire(from.el, to.el, '#c77dff');
            }
          }
        }
      }
    };

    const draggable = (el: HTMLElement, id: string): void => {
      el.addEventListener('pointerdown', (down) => {
        const start = pos.get(id)!;
        const ox = down.clientX - start.x;
        const oy = down.clientY - start.y;
        let moved = false;
        const move = (ev: PointerEvent): void => {
          moved = true;
          const p = { x: Math.max(0, ev.clientX - ox), y: Math.max(0, ev.clientY - oy) };
          pos.set(id, p);
          el.style.left = `${p.x}px`;
          el.style.top = `${p.y}px`;
          drawWires();
        };
        const up = (): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (moved) drawWires();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    };

    let col = 0;
    for (const scene of editor.project.scenes) {
      const x = 18 + col * 260;
      const lvl = document.createElement('div');
      lvl.className = 'flow-node level';
      lvl.innerHTML = `<div class="fn-title">🚪 ${scene.name}</div><div class="fn-ev">${scene.entities.length} actors</div>`;
      place(lvl, `lvl:${scene.id}`, x, 14);
      lvl.ondblclick = () => editor.switchScene(scene.id);
      canvas.appendChild(lvl);
      draggable(lvl, `lvl:${scene.id}`);
      nodes.push({ id: `lvl:${scene.id}`, el: lvl, switchesSet: [], switchGates: [], gotos: [], levelName: scene.name });
      count++;

      let y = 96;
      for (const ent of scene.entities) {
        if (!ent.events.length) continue;
        const el = document.createElement('div');
        el.className = 'flow-node';
        const evLines = ent.events
          .map((ev) => {
            const gate = ev.ifSwitch ? ` 🔒${ev.ifSwitch}` : '';
            const acts = ev.actions.map(actionLabel).join(' · ');
            return `<div class="fn-ev">${TRIG_ICON[ev.trigger]}${gate} → ${acts || '(no actions)'}</div>`;
          })
          .join('');
        el.innerHTML = `<div class="fn-title">${ent.name}</div>${evLines}`;
        place(el, `ent:${ent.id}`, x, y);
        y += 66 + ent.events.length * 18;
        el.onclick = () => {
          if (editor.sceneId !== scene.id) editor.switchScene(scene.id);
          editor.select(ent.id);
        };
        canvas.appendChild(el);
        draggable(el, `ent:${ent.id}`);
        nodes.push({
          id: `ent:${ent.id}`,
          el,
          switchesSet: ent.events.flatMap((ev) => ev.actions.filter((a) => a.cmd === 'switchOn').map((a) => a.text ?? '')),
          switchGates: ent.events.map((ev) => ev.ifSwitch ?? '').filter(Boolean),
          gotos: ent.events.flatMap((ev) => ev.actions.filter((a) => a.cmd === 'goto').map((a) => a.text ?? '')),
          levelName: null,
        });
        count++;
      }
      col++;
    }
    if (count === editor.project.scenes.length) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.cssText = 'position:absolute;left:18px;bottom:12px;font-size:12px';
      hint.textContent = 'Add ⚡ events to actors (inspector) and they appear here as nodes.';
      canvas.appendChild(hint);
    }
    drawWires();
  };

  return { render, nodeCount: () => count };
}
