/**
 * Interverse relay server (spec §5.2): room-code sessions over WebSocket.
 * The relay is game-agnostic — one deployment serves every Interverse game.
 * It creates rooms, tracks who's in them, and forwards messages. All game
 * logic lives on the host player's device (host-authoritative model).
 * No accounts, no PII: room code + player nickname only.
 *
 * Protocol (JSON):
 *   client -> relay: {t:'host', name?, game?} | {t:'join', code, name?, game?}
 *                    {t:'msg', data}                 (player -> host)
 *                    {t:'msg', to, data}             (host -> one player)
 *                    {t:'broadcast', data}           (host -> everyone else)
 *                    {t:'leave'}
 *   relay -> client: {t:'hosted', code, id} | {t:'joined', code, id, players}
 *                    {t:'player-join', player} | {t:'player-leave', id}
 *                    {t:'msg', from, data} | {t:'host-left'} | {t:'error', code, message}
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
// Unambiguous room-code alphabet: no 0/O, 1/I/L (spec §5.1).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const MAX_PLAYERS = 8;
const ROOM_IDLE_MS = 10 * 60_000;
const NAME_MAX = 12;
const MAX_MESSAGE_BYTES = 64 * 1024;
// Kid-safe defaults (spec §8.6): a minimal nickname filter. Games shipping
// real text entry should filter harder client-side too.
const BLOCKED_NAME_PARTS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'ass', 'dick'];

interface Player {
  id: string;
  name: string;
  ws: WebSocket & { missedPongs?: number };
  isHost: boolean;
}

interface Room {
  code: string;
  game: string;
  host: Player;
  /** Non-host players by id. */
  players: Map<string, Player>;
  lastActive: number;
}

const rooms = new Map<string, Room>();

function sanitizeName(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  const lower = cleaned.toLowerCase();
  if (cleaned.length === 0 || BLOCKED_NAME_PARTS.some((w) => lower.includes(w))) {
    return `Player${Math.floor(Math.random() * 90 + 10)}`;
  }
  return cleaned;
}

function generateCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)] ?? 'A';
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('could not allocate a room code');
}

function send(ws: WebSocket, message: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function roomRoster(room: Room): { id: string; name: string; isHost: boolean }[] {
  return [
    { id: room.host.id, name: room.host.name, isHost: true },
    ...[...room.players.values()].map((p) => ({ id: p.id, name: p.name, isHost: false })),
  ];
}

function closeRoom(room: Room, reason: string): void {
  rooms.delete(room.code);
  for (const p of room.players.values()) {
    send(p.ws, { t: 'host-left', reason });
    p.ws.close();
  }
}

// Family sync: tiny short-lived blobs (wallet transfers between devices and
// between installed apps, which get isolated storage on iOS). Codes expire
// after a day; payloads are capped small. Best-effort — the free-tier host
// may restart, so clients treat this as "transfer now", not cloud storage.
const SYNC_TTL_MS = 24 * 60 * 60_000;
const SYNC_MAX_BYTES = 8 * 1024;
const syncBlobs = new Map<string, { data: string; at: number }>();

const httpServer = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const sync = /^\/sync\/([A-Z2-9]{4,8})$/.exec(req.url ?? '');
  if (sync) {
    const code = sync[1]!;
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > SYNC_MAX_BYTES) req.destroy();
      });
      req.on('end', () => {
        try {
          JSON.parse(body);
        } catch {
          res.writeHead(400, cors);
          res.end();
          return;
        }
        syncBlobs.set(code, { data: body, at: Date.now() });
        res.writeHead(200, { 'content-type': 'application/json', ...cors });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === 'GET') {
      const blob = syncBlobs.get(code);
      if (!blob || Date.now() - blob.at > SYNC_TTL_MS) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(blob.data);
      return;
    }
  }
  res.writeHead(404, cors);
  res.end();
});

// Expire stale sync blobs alongside the room sweep.
setInterval(() => {
  const now = Date.now();
  for (const [code, blob] of syncBlobs) {
    if (now - blob.at > SYNC_TTL_MS) syncBlobs.delete(code);
  }
}, 60 * 60_000);

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws: WebSocket & { missedPongs?: number }) => {
  ws.missedPongs = 0;
  ws.on('pong', () => {
    ws.missedPongs = 0;
  });

  let me: Player | null = null;
  let room: Room | null = null;

  const fail = (code: string, message: string): void => {
    send(ws, { t: 'error', code, message });
  };

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      fail('bad-json', 'messages must be JSON');
      return;
    }
    if (room) room.lastActive = Date.now();

    switch (msg.t) {
      case 'host': {
        if (me) return fail('already-in-room', 'this connection already hosts or joined a room');
        me = { id: randomUUID(), name: sanitizeName(msg.name), ws, isHost: true };
        room = {
          code: generateCode(),
          game: String(msg.game ?? ''),
          host: me,
          players: new Map(),
          lastActive: Date.now(),
        };
        rooms.set(room.code, room);
        send(ws, { t: 'hosted', code: room.code, id: me.id });
        return;
      }

      case 'join': {
        if (me) return fail('already-in-room', 'this connection already hosts or joined a room');
        const code = String(msg.code ?? '').toUpperCase();
        const target = rooms.get(code);
        if (!target) return fail('no-room', `no room with code ${code}`);
        if (msg.game !== undefined && target.game !== '' && String(msg.game) !== target.game) {
          return fail('wrong-game', 'that code belongs to a different game');
        }
        if (target.players.size + 1 >= MAX_PLAYERS) return fail('room-full', 'room is full');
        me = { id: randomUUID(), name: sanitizeName(msg.name), ws, isHost: false };
        room = target;
        room.players.set(me.id, me);
        send(ws, { t: 'joined', code: room.code, id: me.id, players: roomRoster(room) });
        const announcement = {
          t: 'player-join',
          player: { id: me.id, name: me.name, isHost: false },
        };
        send(room.host.ws, announcement);
        for (const p of room.players.values()) {
          if (p.id !== me.id) send(p.ws, announcement);
        }
        return;
      }

      case 'msg': {
        if (!me || !room) return fail('not-in-room', 'host or join first');
        if (me.isHost) {
          const target = room.players.get(String(msg.to ?? ''));
          if (target) send(target.ws, { t: 'msg', from: me.id, data: msg.data });
        } else {
          send(room.host.ws, { t: 'msg', from: me.id, data: msg.data });
        }
        return;
      }

      case 'broadcast': {
        if (!me || !room) return fail('not-in-room', 'host or join first');
        if (!me.isHost) return fail('host-only', 'only the host can broadcast');
        for (const p of room.players.values()) {
          send(p.ws, { t: 'msg', from: me.id, data: msg.data });
        }
        return;
      }

      case 'leave': {
        ws.close();
        return;
      }

      // App-level keepalive from clients: keeps proxies from idling the
      // socket and refreshes the room's TTL while players sit in menus.
      case 'ping': {
        send(ws, { t: 'pong' });
        return;
      }

      default:
        fail('unknown-type', `unknown message type ${String(msg.t)}`);
    }
  });

  ws.on('close', () => {
    if (!me || !room) return;
    if (me.isHost) {
      // Host migration is v2 (spec §5.2) — for now the room ends.
      closeRoom(room, 'host disconnected');
    } else {
      room.players.delete(me.id);
      room.lastActive = Date.now();
      send(room.host.ws, { t: 'player-leave', id: me.id });
      for (const p of room.players.values()) send(p.ws, { t: 'player-leave', id: me.id });
    }
    me = null;
    room = null;
  });
});

// Heartbeat: drop dead sockets (browsers auto-answer protocol pings).
// Tolerant on purpose — phones miss pongs when briefly backgrounded or on
// patchy Wi-Fi, and terminating the HOST closes the room for everyone.
// Three missed beats (~90s of silence) before we give up on a socket.
const MAX_MISSED_PONGS = 3;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { missedPongs?: number }>) {
    ws.missedPongs = (ws.missedPongs ?? 0) + 1;
    if (ws.missedPongs > MAX_MISSED_PONGS) {
      ws.terminate();
      continue;
    }
    ws.ping();
  }
}, 30_000);

// TTL sweep: close rooms idle past the limit.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.lastActive > ROOM_IDLE_MS) {
      room.host.ws.close();
      closeRoom(room, 'room expired');
    }
  }
}, 60_000);

httpServer.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(sweep);
});

httpServer.listen(PORT, () => {
  console.log(`interverse relay listening on :${PORT}`);
});
