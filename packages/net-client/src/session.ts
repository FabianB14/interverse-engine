/**
 * Room/session client (spec §5.3). Host-authoritative: joiners' messages go
 * to the host; the host broadcasts or direct-messages.
 *
 *   const session = await host({ url });            // -> session.code "GLDN"
 *   const session = await join('GLDN', 'Fabe', { url });
 *   session.onPlayerJoin(p => ...);
 *   session.onMessage((from, msg) => ...);
 *   session.send({ type: 'vote', choice: 2 });      // joiner -> host
 *   session.broadcast({ type: 'roundStart' });      // host -> all
 *
 * The transport is a thin WebSocket wrapper kept behind this module's API so
 * a LAN/WebRTC transport can be added later without touching game code.
 */

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

export interface NetOptions {
  /** Relay URL, e.g. wss://my-relay.onrender.com (ws:// for local dev). */
  url: string;
  /** Optional game tag — prevents joining a different game's room by code. */
  game?: string;
}

type MessageHandler = (from: string, data: unknown) => void;
type PlayerHandler = (player: PlayerInfo) => void;
type LeaveHandler = (id: string) => void;
type CloseHandler = (reason: string) => void;

// Generous: free-tier relays (e.g. Render) sleep when idle and can take
// ~30s to wake for the first connection.
const CONNECT_TIMEOUT_MS = 45_000;

export class Session {
  /** Live roster, host first. */
  readonly players: PlayerInfo[] = [];
  private readonly messageHandlers: MessageHandler[] = [];
  private readonly joinHandlers: PlayerHandler[] = [];
  private readonly leaveHandlers: LeaveHandler[] = [];
  private readonly closeHandlers: CloseHandler[] = [];
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    readonly code: string,
    readonly id: string,
    readonly isHost: boolean,
    initialPlayers: PlayerInfo[],
  ) {
    this.players.push(...initialPlayers);
    ws.addEventListener('message', (event) => this.handle(String(event.data)));
    ws.addEventListener('close', () => this.emitClose('connection closed'));
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onPlayerJoin(handler: PlayerHandler): void {
    this.joinHandlers.push(handler);
  }

  onPlayerLeave(handler: LeaveHandler): void {
    this.leaveHandlers.push(handler);
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  /** Joiner -> host. (Hosts should use broadcast/sendTo instead.) */
  send(data: unknown): void {
    this.raw({ t: 'msg', data });
  }

  /** Host -> one player. */
  sendTo(id: string, data: unknown): void {
    this.raw({ t: 'msg', to: id, data });
  }

  /** Host -> everyone else in the room. */
  broadcast(data: unknown): void {
    this.raw({ t: 'broadcast', data });
  }

  leave(): void {
    this.raw({ t: 'leave' });
    this.ws.close();
  }

  private raw(message: Record<string, unknown>): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private handle(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.t) {
      case 'msg': {
        const from = String(msg.from ?? '');
        for (const h of this.messageHandlers) h(from, msg.data);
        return;
      }
      case 'player-join': {
        const player = msg.player as PlayerInfo;
        this.players.push(player);
        for (const h of this.joinHandlers) h(player);
        return;
      }
      case 'player-leave': {
        const id = String(msg.id ?? '');
        const i = this.players.findIndex((p) => p.id === id);
        if (i >= 0) this.players.splice(i, 1);
        for (const h of this.leaveHandlers) h(id);
        return;
      }
      case 'host-left': {
        this.emitClose(String(msg.reason ?? 'host left'));
        this.ws.close();
        return;
      }
      default:
        return;
    }
  }

  private emitClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.closeHandlers) h(reason);
  }
}

interface HelloResult {
  ws: WebSocket;
  code: string;
  id: string;
  players: PlayerInfo[];
}

function connectAndHello(
  url: string,
  hello: Record<string, unknown>,
  expect: 'hosted' | 'joined',
): Promise<HelloResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('relay connection timed out'));
    }, CONNECT_TIMEOUT_MS);

    const finish = (fn: () => void): void => {
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      fn();
    };

    const onMessage = (event: MessageEvent): void => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.t === expect) {
        finish(() =>
          resolve({
            ws,
            code: String(msg.code),
            id: String(msg.id),
            players: (msg.players as PlayerInfo[] | undefined) ?? [],
          }),
        );
      } else if (msg.t === 'error') {
        finish(() => {
          ws.close();
          reject(new Error(String(msg.message ?? msg.code ?? 'relay error')));
        });
      }
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('open', () => ws.send(JSON.stringify(hello)));
    ws.addEventListener('error', () =>
      finish(() => reject(new Error('could not reach the relay'))),
    );
  });
}

/** Create a room. The returned session is the room's host. */
export async function host(opts: NetOptions & { name?: string }): Promise<Session> {
  const r = await connectAndHello(
    opts.url,
    { t: 'host', name: opts.name, game: opts.game },
    'hosted',
  );
  const self: PlayerInfo = { id: r.id, name: opts.name ?? 'Host', isHost: true };
  return new Session(r.ws, r.code, r.id, true, [self]);
}

/** Join a room by code. */
export async function join(code: string, name: string, opts: NetOptions): Promise<Session> {
  const r = await connectAndHello(
    opts.url,
    { t: 'join', code: code.toUpperCase(), name, game: opts.game },
    'joined',
  );
  return new Session(r.ws, r.code, r.id, false, r.players);
}
