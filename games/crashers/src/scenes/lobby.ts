/**
 * 🤝 The co-op lobby: a room code, four blobs, and one button.
 *
 * The whole screen exists to answer three questions before the fight starts:
 * who is here, which blob am I, and are we going yet. Everything else — stage
 * choice, the code to read out loud — belongs to the host, because a lobby
 * where four people can each change the plan is a lobby nobody leaves.
 *
 * Joining is install-free by design (spec §8.3): a code typed into a browser
 * is the whole ceremony.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { BRAWLER_CLASSES, Scene, audio, brawlerClass, playerTint } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { fighter } from '../art.js';
import { STAGES } from '../levels.js';
import { isUnlocked, loadRun, saveRun, unlockedStages } from '../save.js';
import { asMsg } from '../net.js';
import type { RosterMsg } from '../net.js';

export interface Party {
  session: Session;
  /** Player ids in slot order, host first. */
  order: string[];
  names: Record<string, string>;
  classes: Record<string, string>;
}

const INK = 0xe6e4f0;
const DIM = 0x9a97b8;

function label(text: string, size: number, fill = INK, weight: '700' | '800' = '700'): Text {
  return new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill },
  });
}

export class LobbyScene extends Scene {
  private roster: Container = new Container();
  private codeText!: Text;
  private stageText!: Text;
  private hint!: Text;
  private order: string[] = [];
  private names: Record<string, string> = {};
  private classes: Record<string, string> = {};
  private stageN = 1;
  private started = false;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly session: Session,
    private readonly onStart: (stage: number, party: Party) => void,
    private readonly onLeave: () => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    const run = loadRun();
    const unlocked = unlockedStages(run);
    this.stageN = unlocked.length ? unlocked[unlocked.length - 1]! : 1;
    this.order = [this.session.id];
    // Your own name has to be your real name, not "You" — the host publishes
    // this table to everyone, and a roster where three people are all called
    // "You" is worse than no names at all. drawRoster highlights yourself by
    // id instead.
    this.names[this.session.id] =
      this.session.players.find((p) => p.id === this.session.id)?.name ??
      (this.session.isHost ? 'Host' : 'Player');
    this.classes[this.session.id] = run.classId;

    this.offs.push(
      this.session.onMessage((from, data) => this.onMessage(from, data)),
      this.session.onPlayerJoin((p) => {
        if (!this.order.includes(p.id)) this.order.push(p.id);
        this.names[p.id] = p.name;
        // A new arrival gets whichever class nobody has yet, so four people
        // who all mash START are still four different blobs.
        this.classes[p.id] ??= this.freeClass();
        audio.pop();
        this.publish();
        this.rebuild();
      }),
      this.session.onPlayerLeave((id) => {
        this.order = this.order.filter((o) => o !== id);
        delete this.names[id];
        delete this.classes[id];
        this.publish();
        this.rebuild();
      }),
      this.session.onClose(() => {
        if (!this.started) this.onLeave();
      }),
    );

    // Seed the roster from whoever the relay already knew about — a joiner
    // arrives into a room that may already be half full.
    for (const p of this.session.players) {
      if (!this.order.includes(p.id)) this.order.push(p.id);
      this.names[p.id] ??= p.name;
    }
    if (this.session.isHost) this.publish();
    else this.session.send({ type: 'hello' });

    this.build();
    audio.music.play('adventure');
  }

  protected override onExit(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    audio.music.stop();
  }

  protected override onResize(): void {
    this.rebuild();
  }

  /** First class nobody has picked; falls back to the first if all four are
   *  taken, since duplicates are legal — playerTint keeps them apart. */
  private freeClass(): string {
    const taken = new Set(Object.values(this.classes));
    return (BRAWLER_CLASSES.find((c) => !taken.has(c.id)) ?? BRAWLER_CLASSES[0]!).id;
  }

  // ------------------------------------------------------------------ net

  private onMessage(from: string, data: unknown): void {
    const msg = asMsg(data);
    if (!msg) return;
    if (msg.type === 'hello' && this.session.isHost) {
      this.classes[from] ??= this.freeClass();
      this.publish();
      this.rebuild();
      return;
    }
    if (msg.type === 'pick' && this.session.isHost) {
      this.classes[from] = msg.classId;
      this.publish();
      this.rebuild();
      return;
    }
    if (msg.type === 'roster' && !this.session.isHost) {
      this.order = msg.order;
      this.names = msg.names;
      this.classes = msg.classes;
      this.stageN = msg.stage;
      this.rebuild();
      return;
    }
    if (msg.type === 'start' && !this.session.isHost) {
      this.begin(msg.stage);
    }
  }

  /** Host → everyone: the roster is the host's, so it is only ever sent one
   *  way. Two machines merging rosters is two machines disagreeing. */
  private publish(): void {
    if (!this.session.isHost) return;
    const msg: RosterMsg = {
      type: 'roster',
      order: this.order,
      names: this.names,
      classes: this.classes,
      stage: this.stageN,
    };
    this.session.broadcast(msg);
  }

  // --------------------------------------------------------------- screen

  private rebuild(): void {
    this.stage.removeChildren();
    this.roster = new Container();
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.stage.addChild(new Graphics().rect(0, 0, W, H).fill(0x18122a));

    const title = label('CO-OP', 34, 0xffd166, '800');
    title.anchor.set(0.5, 0);
    title.position.set(W / 2, 14);
    this.stage.addChild(title);

    // The code is the biggest thing on the screen because reading it aloud
    // is what the screen is for.
    this.codeText = label(this.session.code, Math.min(74, W / 9), 0x8affc1, '800');
    this.codeText.anchor.set(0.5, 0);
    this.codeText.position.set(W / 2, 52);
    this.hint = label(
      this.session.isHost
        ? 'Friends open the game and tap JOIN, then type this code'
        : 'Waiting for the host to start…',
      19,
      DIM,
    );
    this.hint.anchor.set(0.5, 0);
    this.hint.position.set(W / 2, 52 + Math.min(80, W / 8));
    this.stage.addChild(this.codeText, this.hint);

    this.stage.addChild(this.roster);
    this.drawRoster(W, H);

    this.stageText = label('', 22, INK, '800');
    this.stageText.anchor.set(0.5);
    this.stageText.position.set(W / 2, H - 132);
    this.stage.addChild(this.stageText);
    this.refreshStageText();

    if (this.session.isHost) {
      const prev = new UIButton('◀', { width: 76, height: 62, fontSize: 26, fill: 0x3a3160, onTap: () => this.stepStage(-1) });
      prev.position.set(W / 2 - 190, H - 132);
      const next = new UIButton('▶', { width: 76, height: 62, fontSize: 26, fill: 0x3a3160, onTap: () => this.stepStage(1) });
      next.position.set(W / 2 + 190, H - 132);
      const go = new UIButton('▶ START', { width: Math.min(320, W - 120), fill: 0x8affc1, onTap: () => this.hostStart() });
      go.position.set(W / 2, H - 58);
      this.add(prev);
      this.add(next);
      this.add(go);
    }

    const back = new UIButton('← LEAVE', { width: 168, height: 62, fontSize: 20, fill: 0x3a3160, onTap: () => this.quit() });
    back.position.set(102, H - 48);
    this.add(back);
  }

  /** Four slots, always four — an empty slot says "there is room for you"
   *  far better than a list that just stops. */
  private drawRoster(W: number, H: number): void {
    this.roster.removeChildren();
    const slots = 4;
    const gap = Math.min(196, (W - 90) / slots);
    const left = W / 2 - (gap * (slots - 1)) / 2;
    const y = H * 0.5;
    for (let i = 0; i < slots; i++) {
      const id = this.order[i];
      const cell = new Container();
      cell.position.set(left + i * gap, y);
      if (!id) {
        const empty = new Graphics()
          .circle(0, 0, 42)
          .stroke({ color: 0x3a3160, width: 4, alpha: 0.9 });
        const q = label('?', 34, 0x3a3160, '800');
        q.anchor.set(0.5);
        cell.addChild(empty, q);
      } else {
        const cls = brawlerClass(this.classes[id] ?? 'knight');
        // Same tint rule the fight uses, so the blob you see here is the blob
        // your friends will be looking for.
        const color = playerTint(cls.color, i);
        cell.addChild(fighter({ radius: 40, color, seed: 3 + i, hat: cls.hat, held: cls.held }));
        const name = label(id === this.session.id ? 'YOU' : (this.names[id] ?? 'Player'), 19, id === this.session.id ? 0xffd166 : INK, '800');
        name.anchor.set(0.5);
        name.position.set(0, 70);
        const who = label(cls.name, 17, DIM);
        who.anchor.set(0.5);
        who.position.set(0, 94);
        cell.addChild(name, who);
      }
      this.roster.addChild(cell);
    }

    // Your own class picker, right under the roster: everyone chooses their
    // own blob, and the host is not a travel agent.
    const pickY = y + 146;
    const pgap = Math.min(150, (W - 80) / BRAWLER_CLASSES.length);
    const pleft = W / 2 - (pgap * (BRAWLER_CLASSES.length - 1)) / 2;
    BRAWLER_CLASSES.forEach((cls, i) => {
      const mine = this.classes[this.session.id] === cls.id;
      const b = new UIButton(cls.name, {
        width: Math.min(136, pgap - 12),
        height: 62,
        fontSize: 18,
        fill: mine ? cls.color : 0x3a3160,
        onTap: () => this.pick(cls.id),
      });
      b.position.set(pleft + i * pgap, pickY);
      this.add(b);
    });
  }

  private pick(classId: string): void {
    this.classes[this.session.id] = classId;
    saveRun({ ...loadRun(), classId });
    audio.blip(1.2);
    if (this.session.isHost) this.publish();
    else this.session.send({ type: 'pick', classId });
    this.rebuild();
  }

  private refreshStageText(): void {
    const s = STAGES.find((x) => x.n === this.stageN) ?? STAGES[0]!;
    this.stageText.text = `${s.n}. ${s.name}`;
  }

  /** Stage choice walks only the host's unlocked stages — a co-op run uses
   *  the host's campaign, so a friend on stage 1 can be carried through 12
   *  without the game pretending they unlocked it themselves. */
  private stepStage(dir: number): void {
    const run = loadRun();
    let n = this.stageN;
    for (let i = 0; i < STAGES.length; i++) {
      n += dir;
      if (n < 1) n = STAGES.length;
      if (n > STAGES.length) n = 1;
      if (isUnlocked(run, n)) break;
    }
    this.stageN = n;
    this.refreshStageText();
    audio.blip();
    this.publish();
  }

  private hostStart(): void {
    this.session.broadcast({ type: 'start', stage: this.stageN });
    this.begin(this.stageN);
  }

  private begin(stage: number): void {
    if (this.started) return;
    this.started = true;
    audio.chime();
    this.onStart(stage, {
      session: this.session,
      order: [...this.order],
      names: { ...this.names },
      classes: { ...this.classes },
    });
  }

  private quit(): void {
    this.session.leave();
    this.onLeave();
  }

  // ------------------------------------------------- headless test hooks

  debugCode(): string {
    return this.session.code;
  }

  debugRoster(): { id: string; name: string; classId: string }[] {
    return this.order.map((id) => ({
      id,
      name: this.names[id] ?? '',
      classId: this.classes[id] ?? '',
    }));
  }

  debugPick(classId: string): void {
    this.pick(classId);
  }

  debugStage(): number {
    return this.stageN;
  }

  debugStart(): void {
    if (this.session.isHost) this.hostStart();
  }
}
