import type { Text } from 'pixi.js';
import {
  Entity,
  Scene,
  Timer,
  Wobble,
  audio,
  blobCharacter,
  partyPop,
  verium,
} from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { CLASSES, classById, shadeFor } from '../classes.js';
import { ACCESSORIES, FREE_ACCESSORIES, accessoryView } from '../accessories.js';
import { VOICES, playVoice } from '../voice.js';
import { Container, Graphics } from 'pixi.js';
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
  /** Accessory index per player (index into ACCESSORIES). */
  accs?: Record<string, number>;
  /** Voice index per player (index into VOICES). */
  voices?: Record<string, number>;
  /** Which non-host players have tapped Ready. */
  ready?: Record<string, boolean>;
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

interface AccMessage {
  type: 'acc';
  acc: number;
}

interface VoiceMessage {
  type: 'voice';
  voice: number;
}

interface ReadyMessage {
  type: 'ready';
  ready: boolean;
}

interface CountdownMessage {
  type: 'countdown';
  secs: number | null;
}

interface StartMessage {
  type: 'start';
  roster: RosterState;
}

interface InProgressMessage {
  type: 'inprogress';
}

type LobbyMessage =
  | RosterMessage
  | ClassMessage
  | LookMessage
  | AccMessage
  | VoiceMessage
  | ReadyMessage
  | CountdownMessage
  | StartMessage
  | InProgressMessage;

/** Lobby: code + roster + class picker; host starts the adventure. */
export class LobbyScene extends Scene {
  private roster: RosterState = {
    order: [],
    names: {},
    classes: {},
    looks: {},
    accs: {},
    voices: {},
  };
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
  private readyBtn: UIButton | null = null;
  private myReady = false;
  private countdownText!: Text;
  private countdownSecs: number | null = null;
  private countdownAcc = 0;
  private veriumChip!: Text;
  private customizeBtn!: UIButton;
  // Customize overlay ("different screen" with a close-up).
  private customizeRoot!: Container;
  private customizeBg!: Graphics;
  private customizeTitle!: Text;
  private previewEntity!: Entity;
  private styleLabel!: Text;
  private swatchRow!: Entity;
  private accLabel!: Text;
  private accRow!: Entity;
  private accExpanded = false;
  private voiceLabel!: Text;
  private voiceRow!: Entity;
  private storeLabel!: Text;
  private storeRow!: Entity;
  private storeVeriumText!: Text;
  private storeNote!: Text;
  private doneBtn!: UIButton;
  private buyConfirmBtn!: UIButton;
  /** Store item being previewed on the blob (null = showing equipped). */
  private previewAcc: number | null = null;
  private previewBody: Container | null = null;
  private t = 0;

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  /** Free starter accessories + anything purchased (persisted per device). */
  private ownedAccessories(): Set<number> {
    const bought = store.get<number[]>('ownedAccs', []);
    return new Set<number>([...FREE_ACCESSORIES, ...bought]);
  }

  private layout(W: number, H: number): void {
    const landscape = W > H;
    this.codeLabel.position.set(W / 2, landscape ? 40 : 64);
    this.codeText.position.set(W / 2, landscape ? 96 : 128);
    this.countText.position.set(W / 2, landscape ? 152 : 192);
    this.rosterRow.position.set(W / 2, landscape ? 250 : 300);
    this.pickLabel.position.set(W / 2, landscape ? 350 : 430);
    // Class picker as a centered grid so any roster size (5 or 7 classes)
    // stays on-screen; the last (short) row is centered too.
    const cols = landscape ? 4 : 2;
    const colW = landscape ? 300 : 340;
    const rowH = 104;
    const top = landscape ? 404 : 500;
    const n = this.classBtns.length;
    this.classBtns.forEach((btn, i) => {
      const row = Math.floor(i / cols);
      const idxInRow = i - row * cols;
      const inThisRow = Math.min(cols, n - row * cols);
      const cx = W / 2 + (idxInRow - (inThisRow - 1) / 2) * colW;
      const cy = top + row * rowH;
      btn.position.set(cx, cy);
      this.classBlurbs[i]?.position.set(cx, cy + 50);
    });
    const rowsCount = Math.ceil(n / cols);
    const bottom = top + (rowsCount - 1) * rowH + 96;
    this.veriumChip.position.set(landscape ? 120 : 110, landscape ? 40 : 48);
    this.customizeBtn.position.set(W / 2, bottom + 12);
    this.statusText.position.set(W / 2, bottom + 92);
    this.countdownText.position.set(W / 2, landscape ? 300 : 700);
    this.startBtn?.position.set(W / 2, H - (landscape ? 60 : 100));
    this.readyBtn?.position.set(W / 2, H - (landscape ? 60 : 100));
    this.waitText?.position.set(W / 2, H - (landscape ? 120 : 190));
    this.layoutCustomize(W, H);
  }

  /** Full-screen customize overlay: close-up + color/accessory/sound + store. */
  private layoutCustomize(W: number, H: number): void {
    this.customizeBg.clear();
    this.customizeBg.rect(0, 0, W, H).fill(0x140f1e);
    this.customizeTitle.position.set(W / 2, 60);
    this.previewEntity.position.set(W / 2, 220);
    this.styleLabel.position.set(W / 2, 348);
    this.swatchRow.position.set(W / 2, 388);
    this.accLabel.position.set(W / 2, 450);
    this.accRow.position.set(W / 2, 492);
    this.voiceLabel.position.set(W / 2, 556);
    this.voiceRow.position.set(W / 2, 596);
    this.storeLabel.position.set(W / 2 - 150, 668);
    this.storeVeriumText.position.set(W / 2 + 150, 668);
    this.storeNote.position.set(W / 2, 700);
    this.storeRow.position.set(W / 2, 772);
    this.buyConfirmBtn.position.set(W / 2, H - 178);
    this.doneBtn.position.set(W / 2, H - 80);
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
      accs: () => ({ ...(this.roster.accs ?? {}) }),
      setAcc: (i: number) => this.pickAcc(i),
      voices: () => ({ ...(this.roster.voices ?? {}) }),
      setVoice: (i: number) => this.pickVoice(i),
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      owned: () => [...this.ownedAccessories()],
      buyAcc: (i: number) => this.buyAccessory(i),
      previewStore: (i: number) => this.previewStoreItem(i),
      previewingAcc: () => this.previewAcc,
      openCustomize: () => this.openCustomize(),
      customizeOpen: () => this.customizeRoot.visible,
      setReady: (r: boolean) => {
        if (!this.session.isHost && this.myReady !== r) this.toggleReady();
      },
      ready: () => ({ ...(this.roster.ready ?? {}) }),
      countdown: () => this.countdownSecs,
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

    // Lobby: a Verium chip + a CUSTOMIZE button that opens the close-up.
    this.veriumChip = makeText('⬡ 0', 24, { color: 0x9ad8ff, weight: '800' });
    this.stage.addChild(this.veriumChip);
    this.customizeBtn = new UIButton('✨ CUSTOMIZE BLOB', {
      width: 480,
      height: 88,
      fontSize: 32,
      fill: 0xc9a0ff,
      textColor: 0x1c1c28,
      onTap: () => this.openCustomize(),
    });
    this.customizeBtn.visible = false; // appears once you've picked a class
    this.add(this.customizeBtn);

    // The customize overlay ("a different screen") — hidden until opened.
    this.customizeRoot = new Container();
    this.customizeRoot.visible = false;
    this.customizeBg = new Graphics();
    this.customizeBg.eventMode = 'static'; // block taps to the lobby behind
    this.customizeRoot.addChild(this.customizeBg);
    this.customizeTitle = makeText('CUSTOMIZE YOUR BLOB', 34, { color: partyPop.accent });
    this.previewEntity = new Entity();
    this.styleLabel = makeText('COLOR', 22, { color: partyPop.inkSoft, weight: 'bold' });
    this.swatchRow = new Entity();
    this.accLabel = makeText('ACCESSORY', 22, { color: partyPop.inkSoft, weight: 'bold' });
    this.accRow = new Entity();
    this.voiceLabel = makeText('SOUND', 22, { color: partyPop.inkSoft, weight: 'bold' });
    this.voiceRow = new Entity();
    this.storeLabel = makeText('STORE', 24, { color: 0xffd166, weight: '800' });
    this.storeVeriumText = makeText('⬡ 0', 24, { color: 0x9ad8ff, weight: '800' });
    this.storeNote = makeText('tap to buy with Verium', 18, {
      color: partyPop.inkSoft,
      weight: 'bold',
    });
    this.storeRow = new Entity();
    this.buyConfirmBtn = new UIButton('BUY', {
      width: 520,
      height: 84,
      fontSize: 28,
      fill: 0xffd166,
      onTap: () => this.confirmBuy(),
    });
    this.buyConfirmBtn.visible = false;
    this.doneBtn = new UIButton('DONE', {
      width: 300,
      height: 90,
      fontSize: 34,
      fill: 0x8affc1,
      onTap: () => this.closeCustomize(),
    });
    this.customizeRoot.addChild(
      this.customizeTitle,
      this.previewEntity,
      this.styleLabel,
      this.swatchRow,
      this.accLabel,
      this.accRow,
      this.voiceLabel,
      this.voiceRow,
      this.storeLabel,
      this.storeVeriumText,
      this.storeNote,
      this.storeRow,
      this.buyConfirmBtn,
      this.doneBtn,
    );
    this.stage.addChild(this.customizeRoot);

    this.statusText = makeText('', 28, { color: partyPop.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.statusText);

    this.countdownText = makeText('', 40, { color: partyPop.accent, weight: '900' });
    this.stage.addChild(this.countdownText);

    if (session.isHost) {
      this.startBtn = new UIButton('START ADVENTURE', {
        width: 480,
        height: 100,
        fontSize: 38,
        onTap: () => this.startAdventure(),
      });
      this.add(this.startBtn);
    } else {
      this.waitText = makeText('tap READY when you are set', 24, {
        color: partyPop.inkSoft,
        weight: 'bold',
      });
      this.stage.addChild(this.waitText);
      this.readyBtn = new UIButton("I'M READY", {
        width: 480,
        height: 100,
        fontSize: 38,
        fill: 0x8affc1,
        onTap: () => this.toggleReady(),
      });
      this.add(this.readyBtn);
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
    // Accessory / voice: ?acc= and ?voice= levers, else last saved choice.
    const pickIndex = (key: string, max: number): number => {
      const q = Number(params.get(key));
      if (Number.isInteger(q) && q >= 0 && q < max) return q;
      const saved = store.get<number>(key, 0);
      return saved >= 0 && saved < max ? saved : 0;
    };
    const initialAcc = pickIndex('acc', ACCESSORIES.length);
    const initialVoice = pickIndex('voice', VOICES.length);
    if (initialAcc !== 0) this.pickAcc(initialAcc, true);
    if (initialVoice !== 0) this.pickVoice(initialVoice, true);
    this.redrawSwatches();
    this.redrawAccs();
    this.redrawVoices();

    if (session.isHost) {
      session.onPlayerJoin((p) => {
        this.roster.order.push(p.id);
        this.roster.names[p.id] = this.uniqueName(p.name);
        this.shareRoster();
        this.refreshRoster();
        this.checkAllReady(); // a fresh un-ready player cancels any countdown
        audio.chime();
      });
      session.onPlayerLeave((id) => {
        this.roster.order = this.roster.order.filter((x) => x !== id);
        delete this.roster.classes[id];
        if (this.roster.ready) delete this.roster.ready[id];
        this.shareRoster();
        this.refreshRoster();
        this.checkAllReady();
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
        } else if (msg?.type === 'acc') {
          (this.roster.accs ??= {})[from] = msg.acc;
          this.shareRoster();
          this.refreshRoster();
        } else if (msg?.type === 'voice') {
          (this.roster.voices ??= {})[from] = msg.voice;
          this.shareRoster();
          this.refreshRoster();
        } else if (msg?.type === 'ready') {
          (this.roster.ready ??= {})[from] = msg.ready;
          this.shareRoster();
          this.refreshRoster();
          this.checkAllReady();
        }
      });
    } else {
      session.onMessage((_from, data) => {
        const msg = data as LobbyMessage;
        if (msg?.type === 'roster') {
          this.roster = {
            order: msg.order,
            names: msg.names,
            classes: msg.classes,
            looks: msg.looks ?? {},
            accs: msg.accs ?? {},
            voices: msg.voices ?? {},
          };
          this.refreshRoster();
        } else if (msg?.type === 'countdown') {
          this.setCountdownText(msg.secs);
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
    if (this.customizeRoot?.visible) this.redrawPreview();
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
    if (this.customizeRoot?.visible) this.redrawPreview();
  }

  private pickAcc(i: number, silent = false): void {
    if (!silent) audio.blip(1.2);
    store.set('acc', i);
    if (this.session.isHost) {
      (this.roster.accs ??= {})[this.session.id] = i;
      this.shareRoster();
      this.refreshRoster();
    } else {
      const msg: AccMessage = { type: 'acc', acc: i };
      this.session.send(msg);
    }
    this.redrawAccs();
    if (this.customizeRoot?.visible) {
      this.clearPreview();
      this.redrawPreview();
      this.redrawStore();
    }
  }

  private pickVoice(i: number, silent = false): void {
    if (!silent) playVoice(i); // hear the sound you're choosing
    store.set('voice', i);
    if (this.session.isHost) {
      (this.roster.voices ??= {})[this.session.id] = i;
      this.shareRoster();
      this.refreshRoster();
    } else {
      const msg: VoiceMessage = { type: 'voice', voice: i };
      this.session.send(msg);
    }
    this.redrawVoices();
  }

  /** A row of tappable emoji chips; the current pick gets a white ring. */
  private redrawIconRow(
    row: Entity,
    emojis: string[],
    current: number,
    spacing: number,
    onPick: (i: number) => void,
  ): void {
    for (const old of row.removeChildren()) old.destroy({ children: true });
    const n = emojis.length;
    const total = (n - 1) * spacing;
    emojis.forEach((emoji, i) => {
      const chip = new Entity();
      const g = new Graphics().circle(0, 0, 30).fill(i === current ? 0x2e6b3e : 0x243a2a);
      if (i === current) g.circle(0, 0, 33).stroke({ color: 0xffffff, width: 4 });
      chip.addChild(g);
      const label = makeText(emoji, 26);
      chip.addChild(label);
      chip.position.set(-total / 2 + i * spacing, 0);
      makeTappable(chip, () => onPick(i), { hitRadius: 34 });
      row.addChild(chip);
    });
  }

  /**
   * Equip bar, collapsed by default: one chip shows what you're wearing and
   * how big your wardrobe is; tapping it expands a grid of everything you
   * own (a long row of 20+ hats squeezed into one line was unusable).
   */
  private redrawAccs(): void {
    for (const old of this.accRow.removeChildren()) old.destroy({ children: true });
    const owned = [...this.ownedAccessories()].sort((a, b) => a - b);
    const cur = this.roster.accs?.[this.session.id] ?? store.get<number>('acc', 0);

    if (!this.accExpanded) {
      const bar = new Entity();
      const g = new Graphics()
        .roundRect(-170, -30, 340, 60, 16)
        .fill(0x243a2a)
        .roundRect(-170, -30, 340, 60, 16)
        .stroke({ color: 0xffffff, width: 2, alpha: 0.25 });
      bar.addChild(g);
      const curDef = ACCESSORIES[cur];
      const label = makeText(
        `${curDef?.emoji ?? '🚫'} ${curDef?.name ?? 'None'} · ${owned.length} owned ▾`,
        22,
        { color: partyPop.ink, weight: 'bold' },
      );
      bar.addChild(label);
      makeTappable(
        bar,
        () => {
          this.accExpanded = true;
          this.redrawAccs();
        },
        { hitRect: { x: -170, y: -30, width: 340, height: 60 } },
      );
      this.accRow.addChild(bar);
      return;
    }

    // Expanded: bring the row above the rows below it and lay out a grid.
    this.accRow.parent?.addChild(this.accRow);
    const cols = 8;
    const dx = 80;
    const dy = 74;
    const rows = Math.ceil(owned.length / cols);
    const panelW = cols * dx + 30;
    const panelH = rows * dy + 86;
    const bg = new Graphics()
      .roundRect(-panelW / 2, -40, panelW, panelH, 18)
      .fill({ color: 0x141d16, alpha: 0.97 })
      .roundRect(-panelW / 2, -40, panelW, panelH, 18)
      .stroke({ color: 0x8affc1, width: 2, alpha: 0.6 });
    this.accRow.addChild(bg);
    owned.forEach((accIdx, i) => {
      const chip = new Entity();
      const col = i % cols;
      const row = Math.floor(i / cols);
      const g = new Graphics().circle(0, 0, 28).fill(accIdx === cur ? 0x2e6b3e : 0x243a2a);
      if (accIdx === cur) g.circle(0, 0, 31).stroke({ color: 0xffffff, width: 4 });
      chip.addChild(g);
      chip.addChild(makeText(ACCESSORIES[accIdx]?.emoji ?? '?', 24));
      chip.position.set((col - (cols - 1) / 2) * dx, 8 + row * dy);
      makeTappable(
        chip,
        () => {
          this.accExpanded = false;
          this.pickAcc(accIdx);
        },
        { hitRadius: 32 },
      );
      this.accRow.addChild(chip);
    });
    const closeBar = new Entity();
    const cg = new Graphics().roundRect(-90, -22, 180, 44, 12).fill(0x2e6b3e);
    closeBar.addChild(cg);
    closeBar.addChild(makeText('▴ close', 20, { color: partyPop.ink, weight: 'bold' }));
    closeBar.position.set(0, panelH - 70);
    makeTappable(
      closeBar,
      () => {
        this.accExpanded = false;
        this.redrawAccs();
      },
      { hitRect: { x: -90, y: -22, width: 180, height: 44 } },
    );
    this.accRow.addChild(closeBar);
  }

  /** Store grid: locked (purchasable) accessories with their Verium price. */
  private redrawStore(): void {
    for (const old of this.storeRow.removeChildren()) old.destroy({ children: true });
    const owned = this.ownedAccessories();
    const locked = ACCESSORIES.map((a, i) => ({ a, i })).filter(
      ({ a, i }) => a.price !== undefined && !owned.has(i),
    );
    const cols = 5;
    const dx = 132;
    const dy = 100;
    locked.forEach(({ a, i }, k) => {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const chip = new Entity();
      const previewing = this.previewAcc === i;
      const g = new Graphics()
        .circle(0, 0, 30)
        .fill(previewing ? 0x3a5a3a : 0x243a2a)
        .circle(0, 0, 30)
        .stroke({ color: previewing ? 0xffd166 : 0x4a4a5a, width: previewing ? 4 : 2 });
      chip.addChild(g);
      chip.addChild(makeText(a.emoji, 28));
      const price = makeText(`⬡${a.price}`, 16, { color: 0x9ad8ff, weight: '800' });
      price.position.set(0, 42);
      chip.addChild(price);
      chip.position.set((col - (cols - 1) / 2) * dx, row * dy);
      // Tap to PREVIEW on the blob; a separate Buy button confirms.
      makeTappable(chip, () => this.previewStoreItem(i), { hitRadius: 36 });
      this.storeRow.addChild(chip);
    });
    if (locked.length === 0) {
      this.storeNote.text = 'you own every accessory! 🎉';
      this.storeNote.style.fill = partyPop.accent;
    }
    this.updateVerium();
  }

  /** Try it on: show the accessory on the blob and offer a Buy button. */
  private previewStoreItem(i: number): void {
    const def = ACCESSORIES[i];
    if (!def || def.price === undefined) return;
    audio.blip(1.2);
    this.previewAcc = i;
    this.buyConfirmBtn.setLabel(`Buy ${def.emoji} ${def.name} · ⬡${def.price}`);
    this.buyConfirmBtn.visible = true;
    this.storeNote.text = 'previewing — tap Buy to unlock';
    this.storeNote.style.fill = partyPop.inkSoft;
    this.redrawPreview();
    this.redrawStore();
  }

  private confirmBuy(): void {
    if (this.previewAcc !== null) this.buyAccessory(this.previewAcc);
  }

  private clearPreview(): void {
    this.previewAcc = null;
    this.buyConfirmBtn.visible = false;
  }

  private buyAccessory(i: number): void {
    const def = ACCESSORIES[i];
    if (!def) return;
    if (this.ownedAccessories().has(i)) {
      this.clearPreview();
      this.pickAcc(i); // already owned — just equip it
      return;
    }
    if (def.price === undefined) return;
    if (!verium.spend(def.price)) {
      this.storeNote.text = 'not enough Verium — go earn some!';
      this.storeNote.style.fill = 0xff8f9c;
      audio.buzz();
      this.updateVerium();
      return;
    }
    const bought = store.get<number[]>('ownedAccs', []);
    if (!bought.includes(i)) store.set('ownedAccs', [...bought, i]);
    audio.chime();
    this.storeNote.text = `unlocked ${def.name}!`;
    this.storeNote.style.fill = partyPop.accent;
    this.clearPreview();
    this.pickAcc(i); // auto-equip the new one
    this.redrawStore();
    this.redrawAccs();
  }

  private updateVerium(): void {
    const label = `⬡ ${verium.balance()}`;
    if (this.veriumChip.text !== label) this.veriumChip.text = label;
    this.storeVeriumText.text = label;
  }

  /** Big close-up blob reflecting the current class + color + accessory. */
  private redrawPreview(): void {
    for (const old of this.previewEntity.removeChildren()) old.destroy({ children: true });
    const cls = classById(this.roster.classes[this.session.id]);
    const look = this.roster.looks?.[this.session.id] ?? store.get<number>('look', 2);
    const char = blobCharacter({
      radius: 92,
      color: shadeFor(cls.color, look),
      seed: 7,
      strokeWidth: 6,
    });
    char.body.addChild(cls.accessory(92));
    // Show the store item being tried on, else the equipped accessory.
    const shownAcc = this.previewAcc ?? this.roster.accs?.[this.session.id];
    char.body.addChild(accessoryView(shownAcc, 92));
    this.previewEntity.addChild(char.view);
    this.previewBody = char.body;
  }

  private openCustomize(): void {
    audio.blip();
    this.customizeRoot.visible = true;
    this.stage.addChild(this.customizeRoot); // bring the overlay to the front
    this.clearPreview();
    this.redrawPreview();
    this.redrawSwatches();
    this.redrawAccs();
    this.redrawVoices();
    this.redrawStore();
  }

  private closeCustomize(): void {
    audio.blip(0.9);
    this.clearPreview();
    this.customizeRoot.visible = false;
  }

  private redrawVoices(): void {
    const cur = this.roster.voices?.[this.session.id] ?? store.get<number>('voice', 0);
    this.redrawIconRow(
      this.voiceRow,
      VOICES.map((v) => v.emoji),
      cur,
      96,
      (i) => this.pickVoice(i),
    );
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

  /** Non-host: flip my Ready flag and tell the host. */
  private toggleReady(): void {
    this.myReady = !this.myReady;
    audio.blip(this.myReady ? 1.4 : 0.9);
    this.readyBtn?.setLabel(this.myReady ? '✓ READY' : "I'M READY");
    if (this.waitText) {
      this.waitText.text = this.myReady
        ? 'waiting for the rest of the party…'
        : 'tap READY when you are set';
    }
    (this.roster.ready ??= {})[this.session.id] = this.myReady;
    this.session.send({ type: 'ready', ready: this.myReady });
  }

  /** Host: once every non-host is Ready, count down and auto-start. */
  private checkAllReady(): void {
    if (!this.session.isHost) return;
    const others = this.roster.order.filter((id) => id !== this.session.id);
    const allReady = others.length > 0 && others.every((id) => this.roster.ready?.[id]);
    if (allReady) this.startCountdown();
    else this.cancelCountdown();
  }

  private startCountdown(): void {
    if (this.countdownSecs !== null) return; // already counting
    this.countdownAcc = 0;
    this.setCountdown(3);
  }

  private cancelCountdown(): void {
    if (this.countdownSecs === null) return;
    this.setCountdown(null);
  }

  /** Host: set the shared countdown value (null = hidden) and broadcast it. */
  private setCountdown(secs: number | null): void {
    this.countdownSecs = secs;
    this.setCountdownText(secs);
    this.session.broadcast({ type: 'countdown', secs });
  }

  private setCountdownText(secs: number | null): void {
    this.countdownText.text = secs && secs > 0 ? `Starting in ${secs}…` : '';
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
      char.body.addChild(accessoryView(this.roster.accs?.[id], 34));
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
      if (this.roster.ready?.[id]) {
        const rdy = makeText('✓ ready', 15, { color: 0x8affc1, weight: '800' });
        rdy.position.set(0, 98);
        chip.addChild(rdy);
      }
      this.rosterRow.addChild(chip);
    });
    this.redrawSwatches();
    this.redrawAccs();
    this.redrawVoices();
    // The customize close-up unlocks once you've chosen a class.
    this.customizeBtn.visible = this.roster.classes[this.session.id] !== undefined;
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    for (const chip of this.rosterRow.children) {
      if (chip instanceof Entity) chip.update(dt);
    }
    if (this.customizeRoot.visible && this.previewBody) {
      const s = Math.sin(this.t * 2.2) * 0.05;
      this.previewBody.scale.set(1 + s, 1 - s);
    }
    // Host drives the pre-start countdown once everyone is ready.
    if (this.session.isHost && this.countdownSecs !== null) {
      this.countdownAcc += dt;
      if (this.countdownAcc >= 1) {
        this.countdownAcc -= 1;
        const next = this.countdownSecs - 1;
        if (next <= 0) {
          this.countdownSecs = null;
          this.setCountdownText(null);
          this.startAdventure();
          return;
        }
        this.setCountdown(next);
      }
    }
    this.updateVerium();
  }
}
