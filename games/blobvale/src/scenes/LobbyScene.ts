import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Wobble, audio, blobCharacter, partyPop } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { CLASSES, classById, shadeFor } from '../classes.js';
import { Graphics } from 'pixi.js';
import { makeTappable } from '@interverse/engine';
import { store } from '../store.js';
import { makeText } from '../text.js';
import { MenuScene } from './MenuScene.js';
import { WorldScene } from './WorldScene.js';

export interface RosterState {
  order: string[];
  names: Record<string, string>;
  classes: Record<string, string>;
  looks?: Record<string, number>;
}

interface RosterMessage extends RosterState {
  type: 'roster';
}

interface ClassMessage {
  type: 'class';
  cls: string;
}

interface LookMessage {
  type: 'look';
  look: number;
}

interface StartMessage {
  type: 'start';
  roster: RosterState;
}

interface InProgressMessage {
  type: 'inprogress';
}

type LobbyMessage = RosterMessage | ClassMessage | LookMessage | StartMessage | InProgressMessage;

/** Lobby: code + roster + class picker; host starts the adventure. */
export class LobbyScene extends Scene {
  private roster: RosterState = { order: [], names: {}, classes: {}, looks: {} };
  private countText!: Text;
  private rosterRow!: Entity;
  private statusText!: Text;
  private waitText: Text | null = null;
  private codeLabel!: Text;
  private codeText!: Text;
  private pickLabel!: Text;
  private classBtns: UIButton[] = [];
  private classBlurbs: Text[] = [];
  private startBtn: UIButton | null = null;
  private styleLabel!: Text;
  private swatchRow!: Entity;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private layout(W: number, H: number): void {
    const landscape = W > H;
    this.codeLabel.position.set(W / 2, landscape ? 40 : 64);
    this.codeText.position.set(W / 2, landscape ? 96 : 128);
    this.countText.position.set(W / 2, landscape ? 152 : 192);
    this.rosterRow.position.set(W / 2, landscape ? 250 : 300);
    this.pickLabel.position.set(W / 2, landscape ? 362 : 442);
    this.classBtns.forEach((btn, i) => {
      if (landscape) {
        const cx = W / 2 + (i - 2) * 310;
        btn.position.set(cx, 452);
        this.classBlurbs[i]?.position.set(cx, 514);
      } else {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx =
          i === this.classBtns.length - 1 && this.classBtns.length % 2 === 1
            ? W / 2
            : W / 2 + (col === 0 ? -170 : 170);
        const cy = 512 + row * 122;
        btn.position.set(cx, cy);
        this.classBlurbs[i]?.position.set(cx, cy + 62);
      }
    });
    this.styleLabel.position.set(W / 2, landscape ? 566 : 812);
    this.swatchRow.position.set(W / 2, landscape ? 622 : 872);
    this.statusText.position.set(W / 2, landscape ? 668 : 950);
    this.startBtn?.position.set(W / 2, H - (landscape ? 76 : 140));
    this.waitText?.position.set(W / 2, H - (landscape ? 60 : 140));
  }

  constructor(private readonly session: Session) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const session = this.session;

    window.__blobvale = {
      scene: () => 'lobby',
      code: () => session.code,
      playerCount: () => this.roster.order.length,
      names: () => this.roster.order.map((id) => this.roster.names[id] ?? '?'),
      classes: () => ({ ...this.roster.classes }),
      pick: (cls: string) => this.pickClass(cls),
      looks: () => ({ ...(this.roster.looks ?? {}) }),
      setLook: (i: number) => this.pickLook(i),
      ...(session.isHost ? { start: () => this.startAdventure() } : {}),
    };

    this.codeLabel = makeText('ROOM CODE', 26, { color: partyPop.inkSoft, weight: 'bold' });
    this.stage.addChild(this.codeLabel);
    this.codeText = makeText(session.code, 88, { color: partyPop.accent, letterSpacing: 16 });
    this.stage.addChild(this.codeText);
    this.countText = makeText('', 28, { color: partyPop.ink, weight: 'bold' });
    this.stage.addChild(this.countText);

    this.rosterRow = new Entity();
    this.add(this.rosterRow);

    this.pickLabel = makeText('CHOOSE YOUR CLASS', 34, { color: partyPop.ink });
    this.stage.addChild(this.pickLabel);

    CLASSES.forEach((cls) => {
      const btn = new UIButton(`${cls.emoji}  ${cls.name}`, {
        width: 300,
        height: 88,
        fontSize: 30,
        fill: cls.color,
        textColor: 0x1c1c28,
        onTap: () => this.pickClass(cls.id),
      });
      this.add(btn);
      this.classBtns.push(btn);
      const blurb = makeText(cls.blurb, 18, { color: partyPop.inkSoft, weight: 'bold' });
      this.stage.addChild(blurb);
      this.classBlurbs.push(blurb);
    });

    this.styleLabel = makeText('STYLE', 24, { color: partyPop.inkSoft, weight: 'bold' });
    this.stage.addChild(this.styleLabel);
    this.swatchRow = new Entity();
    this.add(this.swatchRow);

    this.statusText = makeText('', 28, { color: partyPop.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.statusText);

    if (session.isHost) {
      this.startBtn = new UIButton('START ADVENTURE', {
        width: 480,
        height: 100,
        fontSize: 38,
        onTap: () => this.startAdventure(),
      });
      this.add(this.startBtn);
    } else {
      this.waitText = makeText('the host starts the adventure', 28, {
        color: partyPop.inkSoft,
        weight: 'bold',
      });
      this.stage.addChild(this.waitText);
    }
    this.layout(W, H);

    this.roster.order = session.players.map((p) => p.id);
    for (const p of session.players) this.roster.names[p.id] = p.name;
    this.refreshRoster();

    // Playtest levers: ?class=knight auto-picks; ?look=0..4 sets the shade.
    const params = new URLSearchParams(window.location.search);
    const auto = params.get('class');
    if (auto && CLASSES.some((c) => c.id === auto)) this.pickClass(auto, true);
    const savedLook = store.get<number>('look', 2);
    const lookParam = Number(params.get('look'));
    const initialLook =
      Number.isInteger(lookParam) && lookParam >= 0 && lookParam <= 4 ? lookParam : savedLook;
    if (initialLook !== 2) this.pickLook(initialLook, true);
    this.redrawSwatches();

    if (session.isHost) {
      session.onPlayerJoin((p) => {
        this.roster.order.push(p.id);
        this.roster.names[p.id] = this.uniqueName(p.name);
        this.shareRoster();
        this.refreshRoster();
        audio.chime();
      });
      session.onPlayerLeave((id) => {
        this.roster.order = this.roster.order.filter((x) => x !== id);
        delete this.roster.classes[id];
        this.shareRoster();
        this.refreshRoster();
      });
      session.onMessage((from, data) => {
        const msg = data as LobbyMessage;
        if (msg?.type === 'class') {
          this.roster.classes[from] = msg.cls;
          this.shareRoster();
          this.refreshRoster();
        } else if (msg?.type === 'look') {
          (this.roster.looks ??= {})[from] = msg.look;
          this.shareRoster();
          this.refreshRoster();
        }
      });
    } else {
      session.onMessage((_from, data) => {
        const msg = data as LobbyMessage;
        if (msg?.type === 'roster') {
          this.roster = { order: msg.order, names: msg.names, classes: msg.classes };
          this.refreshRoster();
        } else if (msg?.type === 'start') {
          this.game.scenes.replace(new WorldScene(this.session, msg.roster));
        } else if (msg?.type === 'inprogress' && this.waitText) {
          this.waitText.text = 'adventure in progress — pick a class to jump in!';
          this.waitText.style.fill = partyPop.accent;
        }
      });
    }

    session.onClose((reason) => {
      this.statusText.text = `Disconnected: ${reason} — returning to menu…`;
      const back = new Entity();
      back.addBehavior(
        new Timer(2.2, () => {
          window.history.replaceState(null, '', window.location.pathname);
          this.game.scenes.replace(new MenuScene());
        }),
      );
      this.add(back);
    });
  }

  protected override onExit(): void {
    delete window.__blobvale;
  }

  private pickClass(id: string, silent = false): void {
    if (!silent) audio.blip(1.1);
    if (this.session.isHost) {
      this.roster.classes[this.session.id] = id;
      this.shareRoster();
      this.refreshRoster();
    } else {
      const msg: ClassMessage = { type: 'class', cls: id };
      this.session.send(msg);
    }
    this.redrawSwatches();
  }

  private pickLook(i: number, silent = false): void {
    if (!silent) audio.blip(1.3);
    store.set('look', i);
    if (this.session.isHost) {
      (this.roster.looks ??= {})[this.session.id] = i;
      this.shareRoster();
      this.refreshRoster();
    } else {
      const msg: LookMessage = { type: 'look', look: i };
      this.session.send(msg);
    }
    this.redrawSwatches();
  }

  /** Five tappable shade dots of my current class color. */
  private redrawSwatches(): void {
    for (const old of this.swatchRow.removeChildren()) old.destroy({ children: true });
    const myClass = classById(
      this.roster.classes[this.session.id] ??
        new URLSearchParams(window.location.search).get('class') ??
        undefined,
    );
    const myLook = this.roster.looks?.[this.session.id] ?? store.get<number>('look', 2);
    for (let i = 0; i < 5; i++) {
      const dot = new Entity();
      const g = new Graphics().circle(0, 0, 30).fill(shadeFor(myClass.color, i));
      if (i === myLook) g.circle(0, 0, 36).stroke({ color: 0xffffff, width: 4 });
      dot.addChild(g);
      dot.position.set((i - 2) * 86, 0);
      makeTappable(dot, () => this.pickLook(i), { hitRadius: 42 });
      this.swatchRow.addChild(dot);
    }
  }

  private startAdventure(): void {
    for (const id of this.roster.order) {
      this.roster.classes[id] ??= 'knight'; // undecided adventurers get a sword
    }
    audio.chime();
    const msg: StartMessage = { type: 'start', roster: this.roster };
    this.session.broadcast(msg);
    this.game.scenes.replace(new WorldScene(this.session, this.roster));
  }

  /** Keep display names unique in the room: Ana Blob, Ana2 Blob, ... */
  private uniqueName(name: string): string {
    const taken = new Set(Object.values(this.roster.names));
    if (!taken.has(name)) return name;
    const m = /^(.*?)( Blob)?$/.exec(name);
    const base = m?.[1] ?? name;
    const suffix = m?.[2] ?? '';
    for (let n = 2; n < 99; n++) {
      const candidate = `${base}${n}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${name}${Math.floor(Math.random() * 999)}`;
  }

  private shareRoster(): void {
    const msg: RosterMessage = { type: 'roster', ...this.roster };
    this.session.broadcast(msg);
  }

  private refreshRoster(): void {
    const n = this.roster.order.length;
    this.countText.text = `${n} adventurer${n === 1 ? '' : 's'} (max 5)`;
    for (const old of this.rosterRow.removeChildren()) old.destroy({ children: true });
    const gap = 118;
    const total = (n - 1) * gap;
    this.roster.order.forEach((id, i) => {
      const clsId = this.roster.classes[id];
      const cls = classById(clsId);
      const chip = new Entity();
      const char = blobCharacter({
        radius: 34,
        color: clsId ? shadeFor(cls.color, this.roster.looks?.[id] ?? 2) : 0x8a8a9a,
        seed: 3 + i,
        shadow: false,
      });
      chip.addChild(char.view);
      if (clsId) char.body.addChild(cls.accessory(34));
      chip.addBehavior(new Wobble({ target: char.body, amount: 0.05, speed: 2 + i * 0.3 }));
      chip.position.set(-total / 2 + i * gap, 0);
      const name = makeText(this.roster.names[id] ?? '?', 19, {
        color: partyPop.inkSoft,
        weight: 'bold',
      });
      name.position.set(0, 54);
      chip.addChild(name);
      const clsName = makeText(clsId ? cls.name : '…', 17, {
        color: clsId ? partyPop.accent : partyPop.inkSoft,
        weight: 'bold',
      });
      clsName.position.set(0, 78);
      chip.addChild(clsName);
      this.rosterRow.addChild(chip);
    });
    this.redrawSwatches();
  }

  protected override onUpdate(dt: number): void {
    for (const chip of this.rosterRow.children) {
      if (chip instanceof Entity) chip.update(dt);
    }
  }
}
