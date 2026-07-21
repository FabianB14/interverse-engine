import type { Text } from 'pixi.js';
import { Entity, Scene, Timer, Wobble, audio, blobCharacter, partyPop } from '@interverse/engine';
import type { Session } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import { CLASSES, classById } from '../classes.js';
import { makeText } from '../text.js';
import { MenuScene } from './MenuScene.js';
import { WorldScene } from './WorldScene.js';

export interface RosterState {
  order: string[];
  names: Record<string, string>;
  classes: Record<string, string>;
}

interface RosterMessage extends RosterState {
  type: 'roster';
}

interface ClassMessage {
  type: 'class';
  cls: string;
}

interface StartMessage {
  type: 'start';
  roster: RosterState;
}

type LobbyMessage = RosterMessage | ClassMessage | StartMessage;

/** Lobby: code + roster + class picker; host starts the adventure. */
export class LobbyScene extends Scene {
  private roster: RosterState = { order: [], names: {}, classes: {} };
  private countText!: Text;
  private rosterRow!: Entity;
  private statusText!: Text;

  constructor(private readonly session: Session) {
    super();
  }

  protected override onEnter(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;
    const session = this.session;

    window.__blobvale = {
      scene: () => 'lobby',
      code: () => session.code,
      playerCount: () => this.roster.order.length,
      ...(session.isHost ? { start: () => this.startAdventure() } : {}),
    };

    const codeLabel = makeText('ROOM CODE', 26, { color: partyPop.inkSoft, weight: 'bold' });
    codeLabel.position.set(W / 2, 64);
    this.stage.addChild(codeLabel);
    const code = makeText(session.code, 88, { color: partyPop.accent, letterSpacing: 16 });
    code.position.set(W / 2, 128);
    this.stage.addChild(code);
    this.countText = makeText('', 28, { color: partyPop.ink, weight: 'bold' });
    this.countText.position.set(W / 2, 192);
    this.stage.addChild(this.countText);

    this.rosterRow = new Entity();
    this.rosterRow.position.set(W / 2, 300);
    this.add(this.rosterRow);

    const pickLabel = makeText('CHOOSE YOUR CLASS', 34, { color: partyPop.ink });
    pickLabel.position.set(W / 2, 442);
    this.stage.addChild(pickLabel);

    CLASSES.forEach((cls, i) => {
      const btn = new UIButton(`${cls.emoji}  ${cls.name}`, {
        width: 300,
        height: 88,
        fontSize: 30,
        fill: cls.color,
        textColor: 0x1c1c28,
        onTap: () => this.pickClass(cls.id),
      });
      const col = i % 2;
      const row = Math.floor(i / 2);
      if (i === CLASSES.length - 1 && CLASSES.length % 2 === 1) {
        btn.position.set(W / 2, 520 + row * 104);
      } else {
        btn.position.set(W / 2 + (col === 0 ? -160 : 160), 520 + row * 104);
      }
      this.add(btn);
    });

    this.statusText = makeText('', 28, { color: partyPop.inkSoft, weight: 'bold', wrapWidth: 620 });
    this.statusText.position.set(W / 2, 900);
    this.stage.addChild(this.statusText);

    if (session.isHost) {
      const start = new UIButton('START ADVENTURE', {
        width: 480,
        height: 100,
        fontSize: 38,
        onTap: () => this.startAdventure(),
      });
      start.position.set(W / 2, H - 140);
      this.add(start);
    } else {
      const wait = makeText('the host starts the adventure', 28, {
        color: partyPop.inkSoft,
        weight: 'bold',
      });
      wait.position.set(W / 2, H - 140);
      this.stage.addChild(wait);
    }

    this.roster.order = session.players.map((p) => p.id);
    for (const p of session.players) this.roster.names[p.id] = p.name;
    this.refreshRoster();

    // Playtest lever: ?class=knight auto-picks.
    const auto = new URLSearchParams(window.location.search).get('class');
    if (auto && CLASSES.some((c) => c.id === auto)) this.pickClass(auto, true);

    if (session.isHost) {
      session.onPlayerJoin((p) => {
        this.roster.order.push(p.id);
        this.roster.names[p.id] = p.name;
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
        color: clsId ? cls.color : 0x8a8a9a,
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
  }

  protected override onUpdate(dt: number): void {
    for (const chip of this.rosterRow.children) {
      if (chip instanceof Entity) chip.update(dt);
    }
  }
}
