/**
 * Studio multiplayer blocks — room-code sessions over the shared Interverse
 * relay, packaged so a Studio game gets multiplayer without netcode:
 *
 * - Drop-in co-op: the host starts immediately; joiners appear the moment
 *   they enter the code (late joiners get a start + state sync on arrival).
 * - Host-authoritative: joiners send their position/state changes to the
 *   host; the host broadcasts 10Hz snapshots + state updates.
 * - Pull-based for scenes: PlayScene calls tick()/remotes() every frame, so
 *   scene changes (api.goto) keep the same session with zero rewiring.
 */
import { host as netHost, join as netJoin } from '@interverse/net';
import type { Session } from '@interverse/net';
import { isFresh, linkState, reconnectDelay } from '@interverse/engine';
import type { HitRequest, LinkState, WorldSnap } from '@interverse/engine';

const DEFAULT_RELAY_URL = 'wss://interverse-engine.onrender.com';
const RELAY_KEY = 'interverse-relay-url';
const NAME_KEY = 'interverse.studio.playername';

function normalize(url: string): string {
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  return url;
}

export function resolveRelayUrl(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('relay');
  if (fromQuery) {
    const url = normalize(fromQuery);
    try {
      window.localStorage.setItem(RELAY_KEY, url);
    } catch {
      /* private mode */
    }
    return url;
  }
  try {
    const saved = window.localStorage.getItem(RELAY_KEY);
    if (saved) return saved;
  } catch {
    /* private mode */
  }
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8787`;
  return normalize(DEFAULT_RELAY_URL);
}

export function playerName(): string {
  let n = localStorage.getItem(NAME_KEY);
  if (!n) {
    n = `Maker${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem(NAME_KEY, n);
  }
  return n;
}

interface PosMsg {
  t: 'pos';
  x: number;
  y: number;
}
interface SnapMsg {
  t: 'snap';
  pos: Record<string, { x: number; y: number }>;
}
interface StateMsg {
  t: 'state';
  k: string;
  v: unknown;
}
interface SyncMsg {
  t: 'sync';
  state: Record<string, unknown>;
}
interface UserMsg {
  t: 'msg';
  from?: string;
  data: unknown;
}
interface StartMsg {
  t: 'start';
}
/** 🛰 The host's picture of the world: enemies and their shots. */
interface WorldMsg {
  t: 'world';
  w: WorldSnap;
}
/** A joiner asking the host to apply damage. Joiners never apply it
 *  themselves — see authority.ts for why. */
interface HitMsg {
  t: 'hit';
  n: string;
  dmg: number;
}
type Msg = PosMsg | SnapMsg | StateMsg | SyncMsg | UserMsg | StartMsg | WorldMsg | HitMsg;

export interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
}

export class StudioNet {
  started = false;
  private positions: Record<string, { x: number; y: number }> = {};
  private stateBag: Record<string, unknown> = {};
  private stateCbs: ((k: string, v: unknown) => void)[] = [];
  private msgCbs: ((from: string, data: unknown) => void)[] = [];
  private startCbs: (() => void)[] = [];
  private sendIn = 0;
  private unsub: (() => void)[] = [];
  /** 🛰 Latest world the host described, and when it arrived. */
  private lastWorld: WorldSnap | null = null;
  private lastWorldT = 0;
  private lastWorldAt = 0;
  private worldCbs: ((w: WorldSnap) => void)[] = [];
  private hitCbs: ((req: HitRequest) => void)[] = [];

  private constructor(public session: Session) {
    this.unsub.push(
      session.onMessage((from, data) => this.onNet(from, data as Msg)),
      session.onPlayerLeave((id) => {
        delete this.positions[id];
      }),
    );
    if (session.isHost) {
      this.started = true;
      this.unsub.push(
        session.onPlayerJoin((p) => {
          // Drop-in: late joiners start immediately with the current state.
          session.sendTo(p.id, { t: 'start' } satisfies StartMsg);
          session.sendTo(p.id, { t: 'sync', state: this.stateBag } satisfies SyncMsg);
        }),
      );
    }
  }

  static async host(relayUrl: string, gameTag: string): Promise<StudioNet> {
    const session = await netHost({ url: relayUrl, game: gameTag, name: playerName() });
    return new StudioNet(session);
  }

  static async join(code: string, relayUrl: string, gameTag: string): Promise<StudioNet> {
    const session = await netJoin(code, playerName(), { url: relayUrl, game: gameTag });
    const net = new StudioNet(session);
    // The host marks us started on arrival; resolve once that lands.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('host did not respond')), 15_000);
      net.startCbs.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return net;
  }

  get id(): string {
    return this.session.id;
  }
  get isHost(): boolean {
    return this.session.isHost;
  }
  get code(): string {
    return this.session.code;
  }

  players(): { id: string; name: string }[] {
    return this.session.players.map((p) => ({ id: p.id, name: p.name }));
  }

  /** Everyone except me, with their latest synced positions. */
  remotes(): RemotePlayer[] {
    return this.session.players
      .filter((p) => p.id !== this.session.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        x: this.positions[p.id]?.x ?? -9999,
        y: this.positions[p.id]?.y ?? -9999,
      }));
  }

  /** Called by the play scene every frame with my player position (if any). */
  tick(dt: number, myPos: { x: number; y: number } | null): void {
    this.sendIn -= dt;
    if (this.sendIn > 0) return;
    this.sendIn = 0.1;
    if (myPos) this.positions[this.session.id] = { x: myPos.x, y: myPos.y };
    if (this.session.isHost) {
      this.session.broadcast({ t: 'snap', pos: this.positions } satisfies SnapMsg);
    } else if (myPos) {
      this.session.send({ t: 'pos', x: myPos.x, y: myPos.y } satisfies PosMsg);
    }
  }

  // ------------------------------------------------------- shared state

  setState(k: string, v: unknown): void {
    if (this.session.isHost) {
      this.stateBag[k] = v;
      this.session.broadcast({ t: 'state', k, v } satisfies StateMsg);
      for (const cb of this.stateCbs) cb(k, v);
    } else {
      this.session.send({ t: 'state', k, v } satisfies StateMsg);
    }
  }

  getState(k: string): unknown {
    return this.stateBag[k];
  }

  onState(cb: (k: string, v: unknown) => void): void {
    this.stateCbs.push(cb);
  }

  send(data: unknown): void {
    if (this.session.isHost) {
      this.session.broadcast({ t: 'msg', from: this.session.id, data } satisfies UserMsg);
    } else {
      this.session.send({ t: 'msg', data } satisfies UserMsg);
    }
  }

  onMsg(cb: (from: string, data: unknown) => void): void {
    this.msgCbs.push(cb);
  }

  // ------------------------------------------------------ 🛰 world state

  /** Host: publish the world. Nobody else may call this — a joiner that
   *  broadcast its own idea of where the monsters are would be fighting the
   *  host for control of the same objects. */
  sendWorld(snap: WorldSnap): void {
    if (!this.session.isHost) return;
    this.lastWorld = snap;
    this.session.broadcast({ t: 'world', w: snap } satisfies WorldMsg);
  }

  /** The last world the host described, or null if none has arrived. */
  world(): WorldSnap | null {
    return this.lastWorld;
  }

  onWorld(cb: (w: WorldSnap) => void): void {
    this.worldCbs.push(cb);
  }

  /** Joiner: ask the host to apply damage. On the host this applies
   *  directly, so the same call works either side and callers do not have
   *  to branch on who they are. */
  requestHit(n: string, dmg: number): void {
    if (this.session.isHost) {
      for (const cb of this.hitCbs) cb({ n, dmg });
    } else {
      this.session.send({ t: 'hit', n, dmg } satisfies HitMsg);
    }
  }

  onHit(cb: (req: HitRequest) => void): void {
    this.hitCbs.push(cb);
  }

  /** How the connection is doing, as the player would describe it. The host
   *  is always live — it IS the world, so there is nothing to be behind. */
  link(nowMs: number): LinkState {
    if (this.session.isHost) return 'live';
    if (!this.lastWorldAt) return 'live'; // nothing has started yet
    return linkState(nowMs - this.lastWorldAt);
  }

  /** Scene scripts re-register their callbacks each scene — drop the old. */
  resetSceneBindings(): void {
    this.stateCbs = [];
    this.msgCbs = [];
    this.worldCbs = [];
    this.hitCbs = [];
  }

  leave(): void {
    this.reconnecting = false;
    for (const u of this.unsub) u();
    this.unsub = [];
    this.session.leave();
  }

  // -------------------------------------------------------- 🔌 reconnect

  private reconnecting = false;
  private linkCbs: ((state: LinkState | 'reconnecting') => void)[] = [];

  onLink(cb: (state: LinkState | 'reconnecting') => void): void {
    this.linkCbs.push(cb);
  }

  private tellLink(state: LinkState | 'reconnecting'): void {
    for (const cb of this.linkCbs) cb(state);
  }

  /**
   * Rejoin the same room after a drop, backing off between tries. A phone
   * that loses wifi for three seconds should not lose the game — and if it
   * really is gone, saying so beats a frozen screen that explains nothing.
   *
   * Only joiners can do this: the room lives on the host, so a host that
   * drops has taken the game with it and there is nothing to rejoin.
   */
  async reconnect(relayUrl: string, gameTag: string): Promise<boolean> {
    if (this.session.isHost || this.reconnecting) return false;
    this.reconnecting = true;
    this.tellLink('reconnecting');
    const code = this.session.code;
    for (let attempt = 0; ; attempt++) {
      const wait = reconnectDelay(attempt);
      if (wait === null) break;
      await new Promise((r) => setTimeout(r, wait));
      if (!this.reconnecting) return false; // they left while we were trying
      try {
        const fresh = await netJoin(code, playerName(), { url: relayUrl, game: gameTag });
        for (const u of this.unsub) u();
        this.unsub = [];
        this.adopt(fresh);
        this.reconnecting = false;
        this.tellLink('live');
        return true;
      } catch {
        /* still down — wait longer and try again */
      }
    }
    this.reconnecting = false;
    this.tellLink('lost');
    return false;
  }

  /** Take over a fresh session in place, keeping every callback the scene
   *  has already registered — the game must not have to rebuild itself. */
  private adopt(session: Session): void {
    this.session = session;
    this.positions = {};
    this.lastWorldT = 0;
    this.unsub.push(
      session.onMessage((from, data) => this.onNet(from, data as Msg)),
      session.onPlayerLeave((id) => {
        delete this.positions[id];
      }),
    );
  }

  private onNet(from: string, msg: Msg): void {
    if (!msg) return;
    switch (msg.t) {
      case 'pos':
        if (this.session.isHost) this.positions[from] = { x: msg.x, y: msg.y };
        break;
      case 'snap':
        if (!this.session.isHost) {
          for (const [id, p] of Object.entries(msg.pos)) {
            if (id !== this.session.id) this.positions[id] = p;
          }
        }
        break;
      case 'state':
        if (this.session.isHost) {
          // Host is authoritative: apply + rebroadcast joiner changes.
          this.setState(msg.k, msg.v);
        } else {
          this.stateBag[msg.k] = msg.v;
          for (const cb of this.stateCbs) cb(msg.k, msg.v);
        }
        break;
      case 'sync':
        this.stateBag = { ...msg.state };
        break;
      case 'msg': {
        const sender = msg.from ?? from;
        if (this.session.isHost) {
          this.session.broadcast({ t: 'msg', from: sender, data: msg.data } satisfies UserMsg);
        }
        for (const cb of this.msgCbs) cb(sender, msg.data);
        break;
      }
      case 'world':
        // Out-of-order packets would drag the world backwards, visibly.
        if (!this.session.isHost && isFresh(msg.w, this.lastWorldT)) {
          this.lastWorld = msg.w;
          this.lastWorldT = msg.w.t;
          this.lastWorldAt = Date.now();
          for (const cb of this.worldCbs) cb(msg.w);
        }
        break;
      case 'hit':
        // Only the host acts on these — it is the one keeping score.
        if (this.session.isHost) {
          for (const cb of this.hitCbs) cb({ n: msg.n, dmg: msg.dmg });
        }
        break;
      case 'start':
        this.started = true;
        for (const cb of this.startCbs) cb();
        this.startCbs = [];
        break;
    }
  }
}
