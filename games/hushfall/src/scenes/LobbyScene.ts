import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Wobble, blobCharacter, makeTappable, verium } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { HIDERS, SEEKERS, classById, defaultClassFor, shadeFor } from '../classes.js';
import type { ClassDef, Role } from '../classes.js';
import { ACCESSORIES, FREE_ACCESSORIES, accessoryView } from '../accessories.js';
import { NIGHT, sting } from '../theme.js';
import { makeText } from '../text.js';
import { savedClass, store } from '../store.js';
import { LEVELS } from '../map.js';
import { MatchScene } from './MatchScene.js';
import { MenuScene } from './MenuScene.js';
import '../debug.js';

export interface RosterState {
  order: string[];
  names: Record<string, string>;
  roles: Record<string, Role>;
  classes: Record<string, string>;
  accs?: Record<string, number>;
  ready?: Record<string, boolean>;
  seekerId?: string | null;
  level?: number;
}

type LobbyMsg =
  | ({ type: 'roster' } & RosterState)
  | { type: 'class'; cls: string; acc?: number }
  | { type: 'acc'; acc: number }
  | { type: 'volunteer' }
  | { type: 'ready'; ready: boolean }
  | { type: 'start'; roster: RosterState }
  | { type: 'inprogress' }
  | { type: 'hello' };

export class LobbyScene extends Scene {
  private roster: RosterState = { order: [], names: {}, roles: {}, classes: {}, accs: {}, ready: {}, level: 0 };
  private live = true;
  private inProgress = false;

  private codeLabel!: Text;
  private codeText!: Text;
  private countText!: Text;
  private rosterRow!: Entity;
  private roleBtn!: UIButton;
  private pickLabel!: Text;
  private abilityInfo!: Text;
  private classBtns: UIButton[] = [];
  private classRole: Role = 'hider';
  private veriumChip!: Text;
  private wardrobeBtn!: UIButton;
  private startBtn: UIButton | null = null;
  private randomBtn: UIButton | null = null;
  private readyBtn: UIButton | null = null;
  private botCount = 0;
  private botMinus: UIButton | null = null;
  private botPlus: UIButton | null = null;
  private botLabel: Text | null = null;
  private levelMinus: UIButton | null = null;
  private levelPlus: UIButton | null = null;
  private levelLabel: Text | null = null;
  private waitText: Text | null = null;
  private statusText!: Text;

  private wardRoot!: Container;
  private wardBg!: Graphics;
  private wardTitle!: Text;
  private preview!: Entity;
  private previewBody: Container | null = null;
  private wardGrid!: Entity;
  private wardVerium!: Text;
  private wardNote!: Text;
  private wardDone!: UIButton;
  private t = 0;

  constructor(private readonly session: Session) {
    super();
  }

  protected override onResize(w: number, h: number): void {
    this.layout(w, h);
  }

  private ownedAccessories(): Set<number> {
    const bought = store.get<number[]>('ownedAccs', []);
    return new Set<number>([...FREE_ACCESSORIES, ...bought]);
  }
  private myAcc(): number {
    return this.roster.accs?.[this.session.id] ?? store.get<number>('acc', 0);
  }
  private myRole(): Role {
    return this.roster.roles[this.session.id] ?? 'hider';
  }
  private myClass(): string {
    return this.roster.classes[this.session.id] ?? defaultClassFor(this.myRole());
  }

  private layout(W: number, H: number): void {
    const landscape = W > H;
    const rowH = landscape ? 78 : 100;
    const top = landscape ? 348 : 500;
    this.veriumChip.position.set(landscape ? 80 : 96, landscape ? 30 : 44);
    this.codeLabel.position.set(W / 2, landscape ? 24 : 56);
    this.codeText.position.set(W / 2, landscape ? 62 : 118);
    this.countText.position.set(W / 2, landscape ? 100 : 178);
    this.rosterRow.position.set(W / 2, landscape ? 150 : 262);
    this.roleBtn.position.set(W / 2, landscape ? 260 : 360);
    this.pickLabel.position.set(W / 2, landscape ? 306 : 430);
    const cols = this.classRole === 'seeker' ? 3 : 4;
    const colW = Math.min(236, (W - 40) / cols);
    const scale = Math.max(0.5, Math.min(1, (colW - 10) / 220)) * (landscape ? 0.8 : 1);
    const n = this.classBtns.length;
    this.classBtns.forEach((btn, i) => {
      const row = Math.floor(i / cols);
      const idx = i - row * cols;
      const inRow = Math.min(cols, n - row * cols);
      btn.scale.set(scale);
      btn.position.set(W / 2 + (idx - (inRow - 1) / 2) * colW, top + row * rowH);
    });

    if (landscape) {
      // Wide, short view: a bot stepper row, then a bottom action row spread
      // across the width.
      this.abilityInfo.position.set(W / 2, 512);
      this.botLabel?.position.set(W * 0.3, 566);
      this.botMinus?.position.set(W * 0.3 - 150, 566);
      this.botPlus?.position.set(W * 0.3 + 150, 566);
      this.levelLabel?.position.set(W * 0.7, 566);
      this.levelMinus?.position.set(W * 0.7 - 150, 566);
      this.levelPlus?.position.set(W * 0.7 + 150, 566);
      const ay = H - 60;
      this.wardrobeBtn.position.set(W * 0.18, ay);
      this.randomBtn?.position.set(W * 0.5, ay);
      this.startBtn?.position.set(W * 0.82, ay);
      this.readyBtn?.position.set(W * 0.7, ay);
      this.waitText?.position.set(W * 0.5, ay - 54);
      this.statusText.position.set(W / 2, ay - 54);
      this.layoutWardrobe(W, H);
      return;
    }

    const rows = Math.max(1, Math.ceil(n / cols));
    const bottom = top + (rows - 1) * rowH + 90;
    this.abilityInfo.position.set(W / 2, bottom - 40);
    this.wardrobeBtn.position.set(W / 2, bottom + 24);
    this.statusText.position.set(W / 2, bottom + 92);
    this.startBtn?.position.set(W / 2, H - 96);
    this.randomBtn?.position.set(W / 2, H - 190);
    this.botLabel?.position.set(W / 2, H - 296);
    this.botMinus?.position.set(W / 2 - 150, H - 296);
    this.botPlus?.position.set(W / 2 + 150, H - 296);
    this.levelLabel?.position.set(W / 2, H - 380);
    this.levelMinus?.position.set(W / 2 - 150, H - 380);
    this.levelPlus?.position.set(W / 2 + 150, H - 380);
    this.readyBtn?.position.set(W / 2, H - 96);
    this.waitText?.position.set(W / 2, H - 176);
    this.layoutWardrobe(W, H);
  }

  private layoutWardrobe(W: number, H: number): void {
    this.wardBg.clear();
    this.wardBg.rect(0, 0, W, H).fill(0x0a0812);
    if (W > H) {
      // Two columns: your blob on the left, the accessory grid on the right.
      this.wardTitle.position.set(W / 2, 40);
      this.preview.position.set(W * 0.22, 210);
      this.wardVerium.position.set(W * 0.22, 330);
      this.wardNote.position.set(W * 0.22, 372);
      this.wardGrid.position.set(W * 0.66, 190);
      this.wardDone.position.set(W * 0.22, H - 60);
      return;
    }
    this.wardTitle.position.set(W / 2, 60);
    this.preview.position.set(W / 2, 210);
    this.wardVerium.position.set(W / 2, 320);
    this.wardNote.position.set(W / 2, 358);
    this.wardGrid.position.set(W / 2, 430);
    this.wardDone.position.set(W / 2, H - 90);
  }

  protected override onEnter(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    const session = this.session;

    this.roster.order = session.players.map((p) => p.id);
    for (const p of session.players) {
      this.roster.names[p.id] = p.name;
      this.roster.roles[p.id] = 'hider';
    }
    this.roster.classes[session.id] = savedClass('hider');
    (this.roster.accs ??= {})[session.id] = store.get<number>('acc', 0);
    this.classRole = 'hider';

    this.codeLabel = makeText('ROOM CODE', 26, { color: NIGHT.inkSoft, weight: 'bold' });
    this.codeText = makeText(session.code, 84, { color: NIGHT.blood, letterSpacing: 14 });
    this.countText = makeText('', 26, { color: NIGHT.ink, weight: 'bold' });
    this.stage.addChild(this.codeLabel, this.codeText, this.countText);

    this.rosterRow = new Entity();
    this.add(this.rosterRow);

    this.roleBtn = new UIButton('🩸 BE THE SEEKER', {
      width: 440,
      height: 76,
      fontSize: 28,
      fill: NIGHT.blood,
      textColor: 0xffffff,
      onTap: () => this.toggleSeeker(),
    });
    this.add(this.roleBtn);

    this.pickLabel = makeText('CHOOSE YOUR SURVIVOR', 30, { color: NIGHT.ink });
    this.stage.addChild(this.pickLabel);
    this.abilityInfo = makeText('', 20, { color: NIGHT.ghost, weight: 'bold', wrapWidth: 620 });
    this.stage.addChild(this.abilityInfo);

    this.veriumChip = makeText('⬡ 0', 24, { color: NIGHT.ghost, weight: '800' });
    this.stage.addChild(this.veriumChip);

    this.wardrobeBtn = new UIButton('🎭 WARDROBE', {
      width: 360,
      height: 80,
      fontSize: 30,
      fill: NIGHT.violet,
      textColor: 0x140f1e,
      onTap: () => this.openWardrobe(),
    });
    this.add(this.wardrobeBtn);

    this.statusText = makeText('', 26, { color: NIGHT.inkSoft, weight: 'bold', wrapWidth: 640 });
    this.stage.addChild(this.statusText);

    if (session.isHost) {
      // AI bots to fill out a short-handed hunt.
      this.botLabel = makeText('🤖 Bots: 0/7', 26, { color: NIGHT.ghost, weight: '800' });
      this.stage.addChild(this.botLabel);
      this.botMinus = new UIButton('➖', {
        width: 76,
        height: 76,
        fontSize: 32,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.setBots(this.botCount - 1),
      });
      this.botPlus = new UIButton('➕', {
        width: 76,
        height: 76,
        fontSize: 32,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.setBots(this.botCount + 1),
      });
      this.add(this.botMinus);
      this.add(this.botPlus);
      this.updateBotLabel();
      // Level (map) picker.
      this.levelLabel = makeText('', 26, { color: NIGHT.lantern, weight: '800' });
      this.stage.addChild(this.levelLabel);
      this.levelMinus = new UIButton('◀', {
        width: 76,
        height: 76,
        fontSize: 32,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.setLevel((this.roster.level ?? 0) - 1),
      });
      this.levelPlus = new UIButton('▶', {
        width: 76,
        height: 76,
        fontSize: 32,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.setLevel((this.roster.level ?? 0) + 1),
      });
      this.add(this.levelMinus);
      this.add(this.levelPlus);
      this.updateLevelLabel();
      this.randomBtn = new UIButton('🎲 RANDOM SEEKER', {
        width: 440,
        height: 84,
        fontSize: 30,
        fill: 0x2a3a4a,
        textColor: NIGHT.ink,
        onTap: () => this.randomSeeker(),
      });
      this.add(this.randomBtn);
      this.startBtn = new UIButton('START THE HUNT', {
        width: 480,
        height: 100,
        fontSize: 38,
        fill: NIGHT.gate,
        textColor: 0x0c1a12,
        onTap: () => this.startMatch(),
      });
      this.add(this.startBtn);
    } else {
      this.waitText = makeText('tap READY when you are set', 24, { color: NIGHT.inkSoft, weight: 'bold' });
      this.stage.addChild(this.waitText);
      this.readyBtn = new UIButton("I'M READY", {
        width: 480,
        height: 100,
        fontSize: 38,
        fill: NIGHT.gate,
        textColor: 0x0c1a12,
        onTap: () => this.toggleReady(),
      });
      this.add(this.readyBtn);
    }

    this.buildWardrobe();
    this.buildClassButtons();
    this.layout(W, H);
    this.refreshRoster();

    window.__hushfall = {
      scene: () => 'lobby',
      code: () => session.code,
      playerCount: () => this.roster.order.length,
      names: () => this.roster.order.map((id) => this.roster.names[id] ?? '?'),
      roles: () => ({ ...this.roster.roles }),
      classes: () => ({ ...this.roster.classes }),
      pick: (cls: string) => this.pickClass(cls),
      volunteerSeeker: () => this.toggleSeeker(),
      myRole: () => this.myRole(),
      seekerId: () => this.roster.seekerId ?? null,
      setAcc: (i: number) => this.pickAcc(i),
      acc: () => this.myAcc(),
      verium: () => verium.balance(),
      grantVerium: (n: number) => verium.add(n),
      buyAcc: (i: number) => this.buyAcc(i),
      owned: () => [...this.ownedAccessories()],
      ready: () => ({ ...(this.roster.ready ?? {}) }),
      setReady: (r: boolean) => {
        if (!session.isHost && !!this.roster.ready?.[session.id] !== r) this.toggleReady();
      },
      inProgress: () => this.inProgress,
      joinNow: () => this.joinInProgress(),
      botCount: () => this.botCount,
      levelIndex: () => this.roster.level ?? 0,
      levelCount: () => LEVELS.length,
      ...(session.isHost
        ? {
            start: () => this.startMatch(),
            randomSeeker: () => this.randomSeeker(),
            setBots: (n: number) => this.setBots(n),
            setLevel: (i: number) => this.setLevel(i),
          }
        : {}),
    };

    this.wireNet();

    const params = new URLSearchParams(window.location.search);
    if (params.get('seeker') === '1') this.toggleSeeker();
    const cls = params.get('class');
    if (cls) this.pickClass(cls, true);
  }

  protected override onExit(): void {
    this.live = false;
    delete window.__hushfall;
  }

  private wireNet(): void {
    const session = this.session;
    if (session.isHost) {
      session.onPlayerJoin((p) => {
        if (!this.live) return;
        // Insert humans before the bot block so bot ids stay contiguous.
        const bots = this.roster.order.filter((id) => this.isBot(id));
        this.roster.order = this.roster.order.filter((id) => !this.isBot(id));
        if (!this.roster.order.includes(p.id)) this.roster.order.push(p.id);
        this.roster.order.push(...bots);
        this.roster.names[p.id] = this.uniqueName(p.name);
        this.roster.roles[p.id] = 'hider';
        this.roster.classes[p.id] ??= defaultClassFor('hider');
        this.rebuildBots(); // re-clamp: a new human lowers the bot ceiling
        this.updateBotLabel();
        this.shareRoster();
        this.refreshRoster();
        sting('blip');
      });
      session.onPlayerLeave((id) => {
        if (!this.live) return;
        this.roster.order = this.roster.order.filter((x) => x !== id);
        delete this.roster.roles[id];
        delete this.roster.classes[id];
        if (this.roster.ready) delete this.roster.ready[id];
        if (this.roster.seekerId === id) this.roster.seekerId = null;
        this.rebuildBots();
        this.updateBotLabel();
        this.shareRoster();
        this.refreshRoster();
      });
      session.onMessage((from, data) => {
        if (!this.live) return;
        const msg = data as LobbyMsg;
        if (msg?.type === 'class') {
          this.roster.classes[from] = msg.cls;
          if (msg.acc !== undefined) (this.roster.accs ??= {})[from] = msg.acc;
        } else if (msg?.type === 'acc') {
          (this.roster.accs ??= {})[from] = msg.acc;
        } else if (msg?.type === 'volunteer') {
          this.setSeeker(from);
        } else if (msg?.type === 'ready') {
          (this.roster.ready ??= {})[from] = msg.ready;
        } else if (msg?.type === 'hello') {
          this.shareRoster();
          return;
        } else {
          return;
        }
        this.shareRoster();
        this.refreshRoster();
      });
    } else {
      session.onMessage((_from, data) => {
        if (!this.live) return;
        const msg = data as LobbyMsg;
        if (msg?.type === 'roster') {
          const mine = this.roster.classes[session.id];
          const myAcc = this.roster.accs?.[session.id];
          this.roster = {
            order: msg.order,
            names: msg.names,
            roles: msg.roles,
            classes: msg.classes,
            accs: msg.accs ?? {},
            ready: msg.ready ?? {},
            seekerId: msg.seekerId ?? null,
            level: msg.level ?? 0,
          };
          if (this.inProgress && mine) this.roster.classes[session.id] = mine;
          if (this.inProgress && myAcc !== undefined) (this.roster.accs ??= {})[session.id] = myAcc;
          this.classRole = this.myRole();
          this.buildClassButtons();
          this.layout(this.game.viewWidth, this.game.viewHeight);
          this.refreshRoster();
        } else if (msg?.type === 'start') {
          this.live = false;
          this.game.scenes.replace(new MatchScene(session, msg.roster));
        } else if (msg?.type === 'inprogress') {
          this.enterLateJoin();
        }
      });
    }
    session.onClose((reason) => {
      if (!this.live) return;
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

    if (!session.isHost) session.send({ type: 'hello' });
  }

  private enterLateJoin(): void {
    if (this.inProgress) return;
    this.inProgress = true;
    if (this.waitText) {
      this.waitText.text = 'a hunt is underway — you will join the next one';
      this.waitText.style.fill = NIGHT.violet;
    }
    if (this.readyBtn) this.readyBtn.visible = false;
  }

  private joinInProgress(): void {
    /* reserved: mid-match join */
  }

  private shareRoster(): void {
    this.session.broadcast({ type: 'roster', ...this.roster });
  }

  private uniqueName(name: string): string {
    const taken = new Set(Object.values(this.roster.names));
    if (!taken.has(name)) return name;
    for (let n = 2; n < 99; n++) if (!taken.has(`${name}${n}`)) return `${name}${n}`;
    return `${name}${Math.floor(Math.random() * 999)}`;
  }

  private setSeeker(id: string): void {
    this.roster.seekerId = id;
    this.applyRoles();
  }

  /** Re-derive every player's role from the current seekerId (host only). */
  private applyRoles(): void {
    const id = this.roster.seekerId;
    for (const pid of this.roster.order) {
      const role: Role = pid === id ? 'seeker' : 'hider';
      const prev = this.roster.roles[pid];
      this.roster.roles[pid] = role;
      const cls = classById(this.roster.classes[pid]);
      if (cls.role !== role) this.roster.classes[pid] = defaultClassFor(role);
      if (prev !== role && pid === this.session.id) {
        this.classRole = role;
        this.buildClassButtons();
        this.layout(this.game.viewWidth, this.game.viewHeight);
      }
    }
  }

  // ------------------------------------------------------------------ bots

  private isBot(id: string): boolean {
    return id.startsWith('bot');
  }

  /** Host: (re)generate the bot roster entries to match `botCount` (cap 8). */
  private rebuildBots(): void {
    this.roster.order = this.roster.order.filter((id) => !this.isBot(id));
    for (const rec of [this.roster.roles, this.roster.classes, this.roster.names, this.roster.accs ?? {}]) {
      for (const id of Object.keys(rec)) if (this.isBot(id)) delete rec[id];
    }
    const humans = this.roster.order.length;
    const n = Math.max(0, Math.min(this.botCount, 8 - humans));
    for (let i = 0; i < n; i++) {
      const id = `bot${i}`;
      this.roster.order.push(id);
      this.roster.names[id] = `Bot ${i + 1}`;
      this.roster.roles[id] = 'hider';
      this.roster.classes[id] = (HIDERS[i % HIDERS.length] ?? HIDERS[0]!).id;
      (this.roster.accs ??= {})[id] = i % 4 === 0 ? 2 : 0;
    }
    if (this.roster.seekerId && !this.roster.order.includes(this.roster.seekerId)) this.roster.seekerId = null;
    this.applyRoles();
  }

  private setBots(n: number): void {
    if (!this.session.isHost) return;
    const humans = this.roster.order.filter((id) => !this.isBot(id)).length;
    this.botCount = Math.max(0, Math.min(n, 8 - humans));
    sting('blip');
    this.rebuildBots();
    this.updateBotLabel();
    this.shareRoster();
    this.refreshRoster();
  }

  private updateBotLabel(): void {
    const humans = this.roster.order.filter((id) => !this.isBot(id)).length;
    const max = Math.max(0, 8 - humans);
    if (this.botLabel) this.botLabel.text = `🤖 Bots: ${this.botCount}/${max}`;
  }

  // ---------------------------------------------------------------- levels

  private setLevel(i: number): void {
    if (!this.session.isHost) return;
    const n = LEVELS.length;
    this.roster.level = ((i % n) + n) % n; // wrap both ways
    sting('blip');
    this.updateLevelLabel();
    this.shareRoster();
  }

  private updateLevelLabel(): void {
    const lv = LEVELS[this.roster.level ?? 0] ?? LEVELS[0]!;
    if (this.levelLabel) this.levelLabel.text = `🏚️ ${lv.name} · ${lv.lanterns} lanterns`;
  }

  private toggleSeeker(): void {
    sting('blip');
    if (this.roster.seekerId === this.session.id) {
      if (this.session.isHost) {
        this.roster.seekerId = null;
        this.roster.roles[this.session.id] = 'hider';
        this.roster.classes[this.session.id] = defaultClassFor('hider');
        this.classRole = 'hider';
        this.buildClassButtons();
        this.layout(this.game.viewWidth, this.game.viewHeight);
        this.shareRoster();
        this.refreshRoster();
      }
      return;
    }
    if (this.session.isHost) {
      this.setSeeker(this.session.id);
      this.shareRoster();
      this.refreshRoster();
    } else {
      this.session.send({ type: 'volunteer' });
    }
  }

  private randomSeeker(): void {
    if (!this.session.isHost || this.roster.order.length === 0) return;
    sting('blip');
    const pick = this.roster.order[Math.floor(Math.random() * this.roster.order.length)]!;
    this.setSeeker(pick);
    this.shareRoster();
    this.refreshRoster();
  }

  private buildClassButtons(): void {
    for (const b of this.classBtns) this.remove(b);
    this.classBtns = [];
    const list: ClassDef[] = this.classRole === 'seeker' ? SEEKERS : HIDERS;
    this.pickLabel.text = this.classRole === 'seeker' ? 'CHOOSE YOUR SEEKER' : 'CHOOSE YOUR SURVIVOR';
    this.updateAbilityInfo();
    for (const cls of list) {
      const btn = new UIButton(`${cls.emoji} ${cls.name}`, {
        width: 220,
        height: 82,
        fontSize: 24,
        fill: cls.color,
        textColor: 0x140f1e,
        onTap: () => this.pickClass(cls.id),
      });
      this.add(btn);
      this.classBtns.push(btn);
    }
  }

  private pickClass(id: string, silent = false): void {
    const cls = classById(id);
    if (cls.role !== this.myRole()) return;
    if (!silent) sting('blip');
    store.set(cls.role === 'seeker' ? 'seekerClass' : 'hiderClass', id);
    this.roster.classes[this.session.id] = id;
    this.updateAbilityInfo();
    if (this.session.isHost) {
      this.shareRoster();
      this.refreshRoster();
    } else {
      this.session.send({ type: 'class', cls: id, acc: this.myAcc() });
    }
    if (this.wardRoot.visible) this.redrawPreview();
  }

  private updateAbilityInfo(): void {
    const a = classById(this.myClass()).ability;
    this.abilityInfo.text = `${a.emoji} ${a.name} — ${a.blurb}`;
  }

  private pickAcc(i: number): void {
    sting('blip');
    store.set('acc', i);
    (this.roster.accs ??= {})[this.session.id] = i;
    if (this.session.isHost) {
      this.shareRoster();
      this.refreshRoster();
    } else {
      this.session.send({ type: 'acc', acc: i });
    }
    if (this.wardRoot.visible) {
      this.redrawPreview();
      this.redrawWardGrid();
    }
  }

  private toggleReady(): void {
    if (this.inProgress) return;
    const now = !this.roster.ready?.[this.session.id];
    (this.roster.ready ??= {})[this.session.id] = now;
    sting('blip');
    this.readyBtn?.setLabel(now ? '✓ READY' : "I'M READY");
    if (this.waitText) this.waitText.text = now ? 'waiting for the host to start…' : 'tap READY when you are set';
    this.session.send({ type: 'ready', ready: now });
  }

  private startMatch(): void {
    if (!this.session.isHost) return;
    if (this.roster.order.length < 2) {
      this.statusText.style.fill = NIGHT.blood;
      this.statusText.text = 'need at least 2 blobs (1 seeker + 1 hider)';
      sting('lose');
      return;
    }
    if (!this.roster.seekerId || !this.roster.order.includes(this.roster.seekerId)) {
      this.setSeeker(this.roster.order[Math.floor(Math.random() * this.roster.order.length)]!);
    }
    for (const id of this.roster.order) {
      this.roster.classes[id] ??= defaultClassFor(this.roster.roles[id] ?? 'hider');
    }
    this.live = false;
    sting('gate');
    this.session.broadcast({ type: 'start', roster: this.roster });
    this.game.scenes.replace(new MatchScene(this.session, this.roster));
  }

  private buildWardrobe(): void {
    this.wardRoot = new Container();
    this.wardRoot.visible = false;
    this.wardBg = new Graphics();
    this.wardBg.eventMode = 'static';
    this.wardRoot.addChild(this.wardBg);
    this.wardTitle = makeText('WARDROBE', 40, { color: NIGHT.violet });
    this.preview = new Entity();
    this.wardVerium = makeText('⬡ 0', 26, { color: NIGHT.ghost, weight: '800' });
    this.wardNote = makeText('tap to equip · locked ones cost Verium', 20, { color: NIGHT.inkSoft, weight: 'bold' });
    this.wardGrid = new Entity();
    this.wardDone = new UIButton('DONE', {
      width: 300,
      height: 90,
      fontSize: 34,
      fill: NIGHT.gate,
      textColor: 0x0c1a12,
      onTap: () => this.closeWardrobe(),
    });
    this.wardDone.visible = false;
    this.wardRoot.addChild(this.wardTitle, this.preview, this.wardVerium, this.wardNote, this.wardGrid, this.wardDone);
    this.stage.addChild(this.wardRoot);
  }

  private openWardrobe(): void {
    sting('blip');
    this.wardRoot.visible = true;
    this.wardDone.visible = true;
    this.stage.addChild(this.wardRoot);
    this.redrawPreview();
    this.redrawWardGrid();
    this.updateVerium();
  }
  private closeWardrobe(): void {
    sting('blip');
    this.wardRoot.visible = false;
    this.wardDone.visible = false;
  }

  private redrawPreview(): void {
    for (const old of this.preview.removeChildren()) old.destroy({ children: true });
    const cls = classById(this.myClass());
    const char = blobCharacter({ radius: 84, color: cls.color, seed: 7, strokeWidth: 6 });
    char.body.addChild(cls.accessory(84));
    char.body.addChild(accessoryView(this.myAcc(), 84));
    this.preview.addChild(char.view);
    this.previewBody = char.body;
  }

  private redrawWardGrid(): void {
    for (const old of this.wardGrid.removeChildren()) old.destroy({ children: true });
    const owned = this.ownedAccessories();
    const cur = this.myAcc();
    const cols = 5;
    const dx = 128;
    const dy = 128;
    ACCESSORIES.forEach((a, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const chip = new Entity();
      const has = owned.has(i);
      chip.addChild(
        new Graphics()
          .circle(0, 0, 44)
          .fill(i === cur ? 0x2e6b3e : has ? 0x241f38 : 0x18141f)
          .circle(0, 0, 44)
          .stroke({ color: i === cur ? 0xffffff : has ? NIGHT.inkSoft : NIGHT.blood, width: i === cur ? 4 : 2 }),
      );
      const mini = accessoryView(i, 30);
      mini.position.set(0, 14);
      chip.addChild(mini);
      const emo = makeText(a.emoji, 22);
      emo.position.set(0, -12);
      chip.addChild(emo);
      if (!has && a.price) {
        const price = makeText(`⬡${a.price}`, 16, { color: NIGHT.ghost, weight: '800' });
        price.position.set(0, 56);
        chip.addChild(price);
      }
      chip.position.set((col - (cols - 1) / 2) * dx, row * dy);
      makeTappable(chip, () => (has ? this.pickAcc(i) : this.buyAcc(i)), { hitRadius: 48 });
      this.wardGrid.addChild(chip);
    });
  }

  private buyAcc(i: number): void {
    const def = ACCESSORIES[i];
    if (!def) return;
    if (this.ownedAccessories().has(i)) {
      this.pickAcc(i);
      return;
    }
    if (def.price === undefined) return;
    if (!verium.spend(def.price)) {
      this.wardNote.text = 'not enough Verium — win hunts to earn some!';
      this.wardNote.style.fill = NIGHT.blood;
      sting('lose');
      this.updateVerium();
      return;
    }
    const bought = store.get<number[]>('ownedAccs', []);
    if (!bought.includes(i)) store.set('ownedAccs', [...bought, i]);
    sting('lantern');
    this.wardNote.text = `unlocked ${def.name}!`;
    this.wardNote.style.fill = NIGHT.gate;
    this.pickAcc(i);
    this.redrawWardGrid();
    this.updateVerium();
  }

  private updateVerium(): void {
    const label = `⬡ ${verium.balance()}`;
    if (this.veriumChip.text !== label) this.veriumChip.text = label;
    this.wardVerium.text = label;
  }

  private refreshRoster(): void {
    const n = this.roster.order.length;
    const hiders = this.roster.order.filter((id) => this.roster.roles[id] !== 'seeker').length;
    this.countText.text = `${n} in the room · ${hiders} hider${hiders === 1 ? '' : 's'} vs 1 seeker`;
    const seek = this.roster.seekerId;
    this.roleBtn.setLabel(
      seek === this.session.id
        ? '🔦 SWITCH TO HIDER'
        : seek
          ? `seeker: ${this.roster.names[seek] ?? '?'}`
          : '🩸 BE THE SEEKER',
    );
    for (const old of this.rosterRow.removeChildren()) old.destroy({ children: true });
    const gap = 116;
    const total = (n - 1) * gap;
    this.roster.order.forEach((id, i) => {
      const cls = classById(this.roster.classes[id]);
      const isSeeker = this.roster.roles[id] === 'seeker';
      const chip = new Entity();
      const char = blobCharacter({
        radius: 32,
        color: isSeeker ? cls.color : shadeFor(cls.color, 2),
        seed: 3 + i,
        shadow: false,
      });
      chip.addChild(char.view);
      char.body.addChild(cls.accessory(32));
      char.body.addChild(accessoryView(this.roster.accs?.[id], 32));
      chip.addBehavior(new Wobble({ target: char.body, amount: 0.05, speed: 2 + i * 0.2 }));
      chip.position.set(-total / 2 + i * gap, 0);
      const nm = makeText(this.roster.names[id] ?? '?', 18, { color: NIGHT.ink, weight: 'bold' });
      nm.position.set(0, 52);
      chip.addChild(nm);
      const bot = this.isBot(id);
      const tag = makeText(isSeeker ? '🩸 SEEKER' : bot ? `🤖 ${cls.name}` : cls.name, 15, {
        color: isSeeker ? NIGHT.blood : bot ? NIGHT.ghost : NIGHT.inkSoft,
        weight: '800',
      });
      tag.position.set(0, 74);
      chip.addChild(tag);
      if (this.roster.ready?.[id]) {
        const rdy = makeText('✓', 16, { color: NIGHT.gate, weight: '800' });
        rdy.position.set(0, 94);
        chip.addChild(rdy);
      }
      this.rosterRow.addChild(chip);
    });
    this.updateVerium();
  }

  protected override onUpdate(dt: number): void {
    this.t += dt;
    for (const chip of this.rosterRow.children) if (chip instanceof Entity) chip.update(dt);
    if (this.wardRoot.visible && this.previewBody) {
      const s = Math.sin(this.t * 2.2) * 0.05;
      this.previewBody.scale.set(1 + s, 1 - s);
    }
  }
}
