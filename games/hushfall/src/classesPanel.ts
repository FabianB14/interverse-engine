import { Container, Graphics } from 'pixi.js';
import { blobCharacter, verium } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import {
  HIDERS,
  SEEKERS,
  levelFromXp,
  requiredLevel,
  statsFor,
  upgradesFor,
  xpForLevel,
} from './classes.js';
import type { ClassDef } from './classes.js';
import { NIGHT, sting } from './theme.js';
import { makeText } from './text.js';
import { addUpgrade, classXp, ownedUpgrades } from './store.js';

/** The CLASSES page: every seeker + survivor, stats, ability, and the Verium
 *  passives — browse and BUY without joining a match. Shared by the main menu
 *  AND the lobby, so players can study classes while they wait for friends. */
export class ClassesPanel {
  private root: Container | null = null;
  private sel: string | null = null;

  constructor(
    private readonly parent: Container,
    private readonly dims: () => { w: number; h: number },
  ) {}

  open(): void {
    // Always land on the class GRID — a detail page left open last time
    // shouldn't greet the next visit.
    this.sel = null;
    this.render(true);
  }

  /** Re-render on resize — only does work while the page is showing. */
  layout(): void {
    this.render();
  }

  private render(open = false): void {
    const { w: W, h: H } = this.dims();
    if (!this.root) {
      this.root = new Container();
      this.root.visible = false;
      this.parent.addChild(this.root);
    }
    const root = this.root;
    if (open) root.visible = true;
    if (!root.visible) return;
    this.parent.addChild(root); // keep above everything
    for (const c of root.removeChildren()) c.destroy({ children: true });
    const bg = new Graphics().rect(0, 0, W, H).fill(0x0a0812);
    bg.eventMode = 'static';
    root.addChild(bg);
    const bal = makeText(`⬡ ${verium.balance()}`, 26, { color: NIGHT.ghost, weight: '800' });
    bal.position.set(W - 160, 44);
    root.addChild(bal);
    // Close lives in the TOP corner — it can never sit on the content.
    const closeBtn = new UIButton('✕', {
      width: 64,
      height: 64,
      fontSize: 26,
      fill: NIGHT.violet,
      textColor: 0x140f1e,
      onTap: () => {
        sting('blip');
        root.visible = false;
        this.sel = null; // next open starts back at the grid
      },
    });
    closeBtn.position.set(W - 56, 44);
    root.addChild(closeBtn);

    const sel = this.sel ? [...SEEKERS, ...HIDERS].find((c) => c.id === this.sel) : null;
    if (!sel) {
      const title = makeText('🎓 CLASSES', 44, { color: NIGHT.ink });
      title.position.set(W / 2, 56);
      root.addChild(title);
      const drawGrid = (list: ClassDef[], label: string, top: number): number => {
        const head = makeText(label, 24, { color: NIGHT.inkSoft, weight: '800' });
        head.position.set(W / 2, top);
        root.addChild(head);
        const cols = W > H ? 6 : 4;
        const colW = Math.min(170, (W - 30) / cols);
        const scale = Math.min(1, (colW - 8) / 160);
        list.forEach((cls, i) => {
          const row = Math.floor(i / cols);
          const inRow = Math.min(cols, list.length - row * cols);
          const btn = new UIButton(`${cls.emoji} ${cls.name}`, {
            width: 160,
            height: 58,
            fontSize: 17,
            fill: cls.color,
            textColor: 0x140f1e,
            onTap: () => {
              sting('blip');
              this.sel = cls.id;
              this.render();
            },
          });
          btn.scale.set(scale);
          btn.position.set(W / 2 + (i - row * cols - (inRow - 1) / 2) * colW, top + 52 + row * 68);
          root.addChild(btn);
        });
        return top + 52 + Math.ceil(list.length / cols) * 68;
      };
      const after = drawGrid(SEEKERS, '🩸 SEEKERS', 120);
      drawGrid(HIDERS, '🔦 SURVIVORS', after + 26);
      return;
    }

    // ---- detail page -----------------------------------------------
    const owned = ownedUpgrades();
    const live = statsFor(sel, owned);
    const xp = classXp(sel.id);
    const lvl = levelFromXp(xp);
    const backBtn = new UIButton('‹ BACK', {
      width: 150,
      height: 60,
      fontSize: 22,
      fill: 0x221e34,
      textColor: NIGHT.ink,
      onTap: () => {
        sting('blip');
        this.sel = null;
        this.render();
      },
    });
    backBtn.position.set(96, 44);
    root.addChild(backBtn);
    // Everything below scales to fit short screens, so nothing can ever
    // slide under the corner buttons.
    const body = new Container();
    root.addChild(body);
    const rootAddChild = root.addChild.bind(root);
    root.addChild = ((child: Container) => body.addChild(child)) as typeof root.addChild;
    // Landscape gets TWO columns (identity + stats left, passives right) so
    // nothing has to shrink to fit the short screen; portrait keeps the
    // single scaled column.
    const landscape = W > H;
    const lx = landscape ? W * 0.25 : W / 2;
    const leftWrap = landscape ? Math.min(560, W * 0.42) : 620;
    const preview = new Container();
    const char = blobCharacter({ radius: 54, color: sel.color, seed: 9, shadow: false });
    char.body.addChild(sel.accessory(54));
    preview.addChild(char.view);
    preview.position.set(lx, landscape ? 160 : 170);
    root.addChild(preview);
    const name = makeText(`${sel.emoji} ${sel.name}`, 42, { color: NIGHT.ink });
    name.position.set(lx, landscape ? 258 : 268);
    root.addChild(name);
    const role = makeText(sel.role === 'seeker' ? '🩸 SEEKER' : '🔦 SURVIVOR', 20, {
      color: sel.role === 'seeker' ? NIGHT.blood : NIGHT.gate,
      weight: '800',
    });
    role.position.set(lx, landscape ? 296 : 306);
    root.addChild(role);
    const lvlLine = makeText(
      `⭐ Lv ${lvl} · ${xp}/${xpForLevel(lvl)} XP — play this class to level it`,
      19,
      { color: NIGHT.lantern, weight: '800', wrapWidth: leftWrap },
    );
    lvlLine.position.set(lx, landscape ? 328 : 336);
    root.addChild(lvlLine);
    const blurb = makeText(sel.blurb, 22, {
      color: NIGHT.inkSoft,
      weight: 'bold',
      wrapWidth: leftWrap,
    });
    blurb.position.set(lx, landscape ? 368 : 372);
    root.addChild(blurb);
    // Stats: speed bar + durability hearts (LIVE — owned passives applied).
    const statTop = landscape ? 434 : 424;
    const speedLbl = makeText(`🏃 SPEED ${live.speed}`, 22, { color: NIGHT.ink, weight: '800' });
    speedLbl.position.set(landscape ? lx : W / 2 - 160, statTop);
    root.addChild(speedLbl);
    const barBg = new Graphics().roundRect(-140, -8, 280, 16, 8).fill(0x221e34);
    barBg.position.set(landscape ? lx : W / 2 + 130, landscape ? statTop + 40 : statTop);
    const frac = Math.max(0, Math.min(1, (live.speed - 240) / 70));
    barBg.roundRect(-140, -8, 280 * frac, 16, 8).fill(sel.color);
    root.addChild(barBg);
    const hearts = makeText(`🛡️ DURABILITY ${'❤️'.repeat(live.hp)}`, 22, {
      color: NIGHT.ink,
      weight: '800',
    });
    hearts.position.set(lx, landscape ? statTop + 84 : statTop + 44);
    root.addChild(hearts);
    const ab = makeText(`${sel.ability.emoji} ${sel.ability.name} — ${sel.ability.blurb}`, 20, {
      color: NIGHT.violet,
      weight: 'bold',
      wrapWidth: landscape ? leftWrap : 640,
    });
    ab.position.set(lx, landscape ? statTop + 146 : statTop + 100);
    root.addChild(ab);
    // The passives (2 for most classes, 3 for some — spacing adapts). In
    // landscape they get their own column on the right, full-size text.
    const ups = upgradesFor(sel.id);
    const rowH = landscape ? (ups.length > 2 ? 128 : 150) : ups.length > 2 ? 96 : 108;
    const rowTop = landscape ? 170 : statTop + 170;
    // Right column: text flows up to the BUY button pinned near the edge.
    const buyX = landscape ? W - 135 : W / 2 + 240;
    const txtWrap = landscape ? Math.max(320, W * 0.5 - 250) : 440;
    const txtX = landscape ? W * 0.52 + txtWrap / 2 : W / 2 - 90;
    ups.forEach((up, i) => {
      const y = rowTop + i * rowH;
      const has = owned.includes(up.id);
      const need = requiredLevel(up);
      const lockedByLvl = !has && lvl < need;
      const txt = makeText(`${up.emoji} ${up.name} — ${up.blurb}`, 20, {
        color: has ? NIGHT.gate : lockedByLvl ? NIGHT.inkSoft : NIGHT.ink,
        weight: 'bold',
        wrapWidth: txtWrap,
      });
      txt.position.set(txtX, y);
      root.addChild(txt);
      const buy = new UIButton(
        has ? '✓ OWNED' : lockedByLvl ? `🔒 Lv ${need}` : `BUY ${up.cost}⬡`,
        {
          width: 170,
          height: 64,
          fontSize: 20,
          fill: has || lockedByLvl ? 0x221e34 : NIGHT.gate,
          textColor: has ? NIGHT.gate : lockedByLvl ? NIGHT.inkSoft : 0x0c1a12,
          onTap: () => {
            if (has) return;
            if (lockedByLvl) {
              sting('lose');
              return;
            }
            if (verium.spend(up.cost)) {
              addUpgrade(up.id);
              sting('gate');
            } else {
              sting('lose');
            }
            this.render();
          },
        },
      );
      buy.position.set(buyX, y);
      root.addChild(buy);
    });
    const note = makeText(
      'Play a class to level it — higher levels unlock its passives to buy.\nPassives are always-on once owned. Earn ⬡ Verium by playing hunts.',
      17,
      {
        color: NIGHT.inkSoft,
        weight: 'bold',
        wrapWidth: landscape ? Math.max(360, W * 0.44) : 640,
      },
    );
    const noteY = rowTop + ups.length * rowH + 20;
    note.position.set(landscape ? W * 0.74 : W / 2, noteY);
    root.addChild(note);
    // Restore root.addChild and shrink the body if the screen is short —
    // detail content can never slide under the corner buttons again.
    root.addChild = rootAddChild;
    const contentBottom = Math.max(noteY + 60, landscape ? statTop + 200 : 0);
    const scale = Math.min(1, (H - 100) / contentBottom);
    if (scale < 1) {
      body.pivot.set(W / 2, 90);
      body.position.set(W / 2, 96);
      body.scale.set(scale);
    }
  }
}
