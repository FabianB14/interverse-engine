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
  ws: WebSocket & { isAlive?: boolean };
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

const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws: WebSocket & { isAlive?: boolean }) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
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
const heartbeat = setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
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
