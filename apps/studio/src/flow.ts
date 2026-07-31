/**
 * ⛓ Flow — the visual scripting map (Blueprints v1). Levels and every
 * actor with ⚡ events render as draggable node cards; wires show the
 * relationships that make quests tick: switch setters → switch-gated
 * events, and 🚪 go-to-level actions → level nodes. Clicking a node
 * selects the actor so the inspector edits it. This is the read/navigate
 * layer of the graph editor — wire-dragging authoring builds on it next.
 */
import type { StudioEditor } from './editor.js';
import { TRIG_ICON, actionLabel, knownSwitches } from './cmds.js';
import type { EventDef } from './model.js';

export function wireFlow(editor: StudioEditor): { render: () => void; nodeCount: () => number; link: (fromId: string, toId: string) => boolean } {
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

    /** ◉ output port: drag from it onto another node to create a link. */
    const attachPort = (el: HTMLElement, id: string): void => {
      const port = document.createElement('div');
      port.textContent = '◉';
      port.style.cssText =
        'position:absolute;right:-9px;top:50%;transform:translateY(-50%);color:var(--good);cursor:crosshair;font-size:13px';
      port.title = 'Drag onto another node to link (actor→actor: switch gate · actor→level: door)';
      port.addEventListener('pointerdown', (down) => {
        down.stopPropagation();
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', '#8affc1');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '5 4');
        svg.appendChild(line);
        const cRect = canvas.getBoundingClientRect();
        const x1 = el.offsetLeft + el.offsetWidth;
        const y1 = el.offsetTop + el.offsetHeight / 2;
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        const move = (ev: PointerEvent): void => {
          line.setAttribute('x2', String(ev.clientX - cRect.left + canvas.scrollLeft));
          line.setAttribute('y2', String(ev.clientY - cRect.top + canvas.scrollTop));
        };
        const up = (ev: PointerEvent): void => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          line.remove();
          const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.flow-node');
          const target = nodes.find((nd) => nd.el === targetEl);
          if (target && target.id !== id) link(id, target.id);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      el.appendChild(port);
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

    /** One '<trigger> <gate> → <actions>' row per event, actor or level. */
    const evRows = (events: readonly EventDef[]): string =>
      events
        .map((ev) => {
          const gate = `${ev.ifSwitch ? ` 🔒${ev.ifSwitch}` : ''}${ev.ifVar ? ` 🔢${ev.ifVar}≥${ev.ifVarAtLeast ?? 1}` : ''}`;
          const acts = ev.actions.map(actionLabel).join(' · ');
          return `<div class="fn-ev">${TRIG_ICON[ev.trigger]}${gate} → ${acts || '(no actions)'}</div>`;
        })
        .join('');
    const setsOf = (events: readonly EventDef[]): string[] =>
      events.flatMap((ev) => ev.actions.filter((a) => a.cmd === 'switchOn').map((a) => a.text ?? ''));
    const gatesOf = (events: readonly EventDef[]): string[] =>
      events.map((ev) => ev.ifSwitch ?? '').filter(Boolean);
    const gotosOf = (events: readonly EventDef[]): string[] =>
      events.flatMap((ev) => ev.actions.filter((a) => a.cmd === 'goto').map((a) => a.text ?? ''));

    let col = 0;
    for (const scene of editor.project.scenes) {
      const x = 18 + col * 260;
      const lvl = document.createElement('div');
      lvl.className = 'flow-node level';
      const lvlEvents = scene.events ?? [];
      lvl.innerHTML =
        `<div class="fn-title">🚪 ${scene.name}</div>` +
        `<div class="fn-ev">${scene.entities.length} actors</div>` +
        evRows(lvlEvents);
      place(lvl, `lvl:${scene.id}`, x, 14);
      lvl.ondblclick = () => editor.switchScene(scene.id);
      canvas.appendChild(lvl);
      draggable(lvl, `lvl:${scene.id}`);
      attachPort(lvl, `lvl:${scene.id}`);
      nodes.push({
        id: `lvl:${scene.id}`,
        el: lvl,
        switchesSet: setsOf(lvlEvents),
        switchGates: gatesOf(lvlEvents),
        gotos: gotosOf(lvlEvents),
        levelName: scene.name,
      });
      count++;

      let y = 96;
      for (const ent of scene.entities) {
        if (!ent.events.length) continue;
        const el = document.createElement('div');
        el.className = 'flow-node';
        el.innerHTML = `<div class="fn-title">${ent.name}</div>${evRows(ent.events)}`;
        place(el, `ent:${ent.id}`, x, y);
        y += 66 + ent.events.length * 18;
        el.onclick = () => {
          if (editor.sceneId !== scene.id) editor.switchScene(scene.id);
          editor.select(ent.id);
        };
        canvas.appendChild(el);
        draggable(el, `ent:${ent.id}`);
        attachPort(el, `ent:${ent.id}`);
        nodes.push({
          id: `ent:${ent.id}`,
          el,
          switchesSet: setsOf(ent.events),
          switchGates: gatesOf(ent.events),
          gotos: gotosOf(ent.events),
          levelName: null,
        });
        count++;
      }
      col++;
    }
    if (count === editor.project.scenes.length && !editor.project.scenes.some((s2) => s2.events?.length)) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.cssText = 'position:absolute;left:18px;bottom:12px;font-size:12px';
      hint.textContent = 'Add ⚡ events to actors (inspector) and they appear here as nodes.';
      canvas.appendChild(hint);
    }
    drawWires();
  };

  /** Wire-authoring v1: connect two nodes and the logic writes itself.
   *  actor → level: the actor's first event gains a 🚪 goto action.
   *  actor → actor: an auto-named switch links them — the source sets it,
   *  the target's events become gated on it (a chest-opens-door in one drag). */
  const link = (fromId: string, toId: string): boolean => {
    let fromEnt = null;
    let fromScene = null;
    let toEnt = null;
    let toScene = null;
    for (const scene of editor.project.scenes) {
      for (const ent of scene.entities) {
        if (`ent:${ent.id}` === fromId) fromEnt = ent;
        if (`ent:${ent.id}` === toId) toEnt = ent;
      }
      if (`lvl:${scene.id}` === fromId) fromScene = scene;
      if (`lvl:${scene.id}` === toId) toScene = scene;
    }
    if ((!fromEnt && !fromScene) || (!toEnt && !toScene)) return false;
    // A level wires from its own ⚡ events; an actor from its first one.
    let events: EventDef[];
    if (fromEnt) {
      if (!fromEnt.events.length) fromEnt.events.push({ trigger: 'touch', actions: [] });
      events = fromEnt.events;
    } else {
      fromScene!.events ??= [];
      if (!fromScene!.events.length) fromScene!.events.push({ trigger: 'start', actions: [] });
      events = fromScene!.events;
    }
    const firstEv = events[0]!;
    if (toScene) {
      firstEv.actions.push({ cmd: 'goto', text: toScene.name });
    } else if (toEnt) {
      let n = 1;
      const used = new Set(knownSwitches(editor.project));
      while (used.has(`link-${n}`)) n++;
      const sw = `link-${n}`;
      firstEv.actions.push({ cmd: 'switchOn', text: sw });
      if (!toEnt.events.length) toEnt.events.push({ trigger: 'touch', actions: [{ cmd: 'sfx', text: 'chime' }] });
      for (const ev of toEnt.events) ev.ifSwitch ||= sw;
    }
    editor.touch();
    render();
    return true;
  };

  return { render, nodeCount: () => count, link };
}
