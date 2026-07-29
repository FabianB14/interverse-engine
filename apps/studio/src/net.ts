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
type Msg = PosMsg | SnapMsg | StateMsg | SyncMsg | UserMsg | StartMsg;

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

  private constructor(readonly session: Session) {
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

  /** Scene scripts re-register their callbacks each scene — drop the old. */
  resetSceneBindings(): void {
    this.stateCbs = [];
    this.msgCbs = [];
  }

  leave(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.session.leave();
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
      case 'start':
        this.started = true;
        for (const cb of this.startCbs) cb();
        this.startCbs = [];
        break;
    }
  }
}
