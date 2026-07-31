/**
 * 🎛 The HUD editor.
 *
 * Hearts, score, coins, the level bar, the ability cluster and the joystick
 * were all at hardcoded pixel offsets, which is the one thing you cannot
 * leave hardcoded on phones: a notch eats the top-left corner, a home
 * indicator eats the bottom, and a tablet in landscape is a completely
 * different shape from a phone in portrait.
 *
 * So each piece gets an ANCHOR plus an inward offset, and this screen is a
 * phone-shaped preview you drag them around on, with safe-area bands drawn
 * where the hardware will cover things up.
 */
import { HUD_PARTS, defaultHud, hudPos, normalizeHud } from './model.js';
import type { HudAnchor, HudDef, HudElement, HudPart, ProjectDef } from './model.js';

const LABEL: Record<HudPart, string> = {
  hearts: '♥ Hearts',
  score: '⭐ Score',
  coins: '🪙 Coins',
  level: '✨ Level + XP',
  abilities: '⚡ Ability buttons',
  joystick: '🕹 Joystick',
};

/** Which corner a dropped point belongs to. Snapping to the NEAREST corner
 *  is what keeps offsets small and positive, which is what makes a layout
 *  survive a screen it was not designed on. */
export function anchorFor(x: number, y: number, w: number, h: number): HudAnchor {
  const vert = y < h / 2 ? 'top' : 'bottom';
  const third = w / 3;
  const horiz = x < third ? 'left' : x > third * 2 ? 'right' : 'center';
  return `${vert}-${horiz}` as HudAnchor;
}

/** Turn a dropped screen point into anchor + inward offset. */
export function place(x: number, y: number, w: number, h: number, safeTop = 0, safeBottom = 0): { anchor: HudAnchor; dx: number; dy: number } {
  const anchor = anchorFor(x, y, w, h);
  const top = anchor.startsWith('top');
  const dy = Math.round(top ? y - safeTop : h - safeBottom - y);
  let dx = Math.round(x);
  if (anchor.endsWith('center')) dx = Math.round(x - w / 2);
  else if (anchor.endsWith('right')) dx = Math.round(w - x);
  return { anchor, dx, dy };
}

export interface HudHost {
  project: ProjectDef;
  touch: () => void;
  openModal: (build: (root: HTMLElement) => void) => void;
  /** Re-lay the live HUD when Play is running, so edits are visible now. */
  relayout: () => void;
}

export function ensureHud(p: ProjectDef): HudDef {
  p.hud = normalizeHud(p.hud);
  return p.hud;
}

export function openHudEditor(host: HudHost): void {
  host.openModal((root) => {
    const hud = ensureHud(host.project);
    // Preview at a third of the design space — big enough to drag, small
    // enough to sit in a dialog.
    const SCALE = 3;
    const W = 720;
    const H = 1280;
    const pw = W / SCALE;
    const ph = H / SCALE;

    const render = (): void => {
      root.innerHTML = `<h2>🎛 HUD layout</h2>
        <p class="muted" style="font-size:12px">
          Drag a piece to move it. It snaps to the nearest corner and remembers the distance
          from there, so your layout survives a phone, a tablet and a rotated screen.
        </p>
        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div id="hud-phone" style="position:relative;width:${pw}px;height:${ph}px;background:#0b0a12;
            border:2px solid #35304d;border-radius:18px;overflow:hidden;flex:none"></div>
          <div style="flex:1;min-width:220px">
            <div id="hud-rows"></div>
            <div class="row" style="margin-top:10px">
              <label class="muted">Safe top <input id="hud-st" type="number" style="width:70px" /></label>
              <label class="muted">bottom <input id="hud-sb" type="number" style="width:70px" /></label>
            </div>
            <p class="muted" style="font-size:11px">
              Safe areas keep the HUD clear of notches and the home bar. 44–60 is typical.
            </p>
            <button class="btn" id="hud-reset" style="margin-top:6px">↺ Reset layout</button>
          </div>
        </div>`;

      const phone = root.querySelector<HTMLElement>('#hud-phone')!;
      // Safe-area bands, drawn where the hardware will cover the screen.
      for (const [key, h] of [['top', hud.safeTop], ['bottom', hud.safeBottom]] as const) {
        if (!h) continue;
        const band = document.createElement('div');
        band.style.cssText = `position:absolute;left:0;right:0;${key}:0;height:${h / SCALE}px;
          background:repeating-linear-gradient(45deg,#ff6f9133,#ff6f9133 6px,transparent 6px,transparent 12px)`;
        phone.appendChild(band);
      }

      for (const part of HUD_PARTS) {
        const el = hud.parts[part];
        const pos = hudPos(el, W, H, hud.safeTop, hud.safeBottom);
        const chip = document.createElement('div');
        chip.dataset.part = part;
        chip.textContent = LABEL[part];
        chip.style.cssText = `position:absolute;left:${pos.x / SCALE}px;top:${pos.y / SCALE}px;
          transform:translate(${el.anchor.endsWith('right') ? '-100%' : el.anchor.endsWith('center') ? '-50%' : '0'},
          ${el.anchor.startsWith('bottom') ? '-100%' : '0'});
          font-size:10px;padding:2px 5px;border-radius:5px;cursor:grab;white-space:nowrap;
          background:${el.show ? '#3a3268' : '#241f36'};color:${el.show ? '#e6e4f0' : '#6b6688'};
          border:1px solid ${el.show ? '#6c5fb8' : '#35304d'};opacity:${el.show ? 1 : 0.6}`;
        chip.addEventListener('pointerdown', (down) => {
          down.preventDefault();
          chip.style.cursor = 'grabbing';
          const move = (ev: PointerEvent): void => {
            const r = phone.getBoundingClientRect();
            const x = Math.max(0, Math.min(W, (ev.clientX - r.left) * SCALE));
            const y = Math.max(0, Math.min(H, (ev.clientY - r.top) * SCALE));
            Object.assign(el, place(x, y, W, H, hud.safeTop, hud.safeBottom));
          };
          const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            host.touch();
            host.relayout();
            render();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        phone.appendChild(chip);
      }

      const rows = root.querySelector<HTMLElement>('#hud-rows')!;
      for (const part of HUD_PARTS) {
        const el = hud.parts[part];
        const row = document.createElement('div');
        row.className = 'row';
        row.style.cssText = 'align-items:center;gap:6px;margin-bottom:4px;font-size:12px';
        const show = document.createElement('input');
        show.type = 'checkbox';
        show.checked = el.show;
        show.title = 'Show this piece';
        show.onchange = () => {
          el.show = show.checked;
          host.touch();
          host.relayout();
          render();
        };
        const name = document.createElement('span');
        name.style.cssText = 'width:130px';
        name.textContent = LABEL[part];
        const size = document.createElement('input');
        size.type = 'range';
        size.min = '0.6';
        size.max = '1.8';
        size.step = '0.1';
        size.value = String(el.scale);
        size.style.width = '80px';
        size.title = `Size ${el.scale.toFixed(1)}x`;
        size.oninput = () => {
          el.scale = Number(size.value);
          host.touch();
          host.relayout();
        };
        const where = document.createElement('span');
        where.className = 'muted';
        where.style.cssText = 'font-size:10px';
        where.textContent = el.anchor;
        row.append(show, name, size, where);
        rows.appendChild(row);
      }

      const st = root.querySelector<HTMLInputElement>('#hud-st')!;
      const sb = root.querySelector<HTMLInputElement>('#hud-sb')!;
      st.value = String(hud.safeTop);
      sb.value = String(hud.safeBottom);
      const safe = (): void => {
        hud.safeTop = Math.max(0, Math.min(200, Number(st.value) || 0));
        hud.safeBottom = Math.max(0, Math.min(200, Number(sb.value) || 0));
        host.touch();
        host.relayout();
        render();
      };
      st.onchange = safe;
      sb.onchange = safe;
      root.querySelector<HTMLButtonElement>('#hud-reset')!.onclick = () => {
        host.project.hud = defaultHud();
        host.touch();
        host.relayout();
        openHudEditor(host);
      };
    };
    render();
  });
}

/** Headless helpers so the playtest can drive the layout without dragging. */
export function moveHudPart(p: ProjectDef, part: HudPart, x: number, y: number): HudElement {
  const hud = ensureHud(p);
  const el = hud.parts[part];
  Object.assign(el, place(x, y, 720, 1280, hud.safeTop, hud.safeBottom));
  return el;
}
