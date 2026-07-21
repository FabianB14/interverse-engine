# Multiplayer (§5)

Room-code sessions, Jackbox-style but symmetric: every player on their own
phone, browser joiners always welcome. Host-authoritative — the host device
owns game state; the relay (deployed once, serves all games) only forwards
messages.

```ts
import { host, join } from '@interverse/net';

const session = await host({ url: relayUrl, game: 'my-game', name });
// session.code -> "GLDN" (4 letters, unambiguous alphabet)

const session = await join('GLDN', 'Fabe', { url: relayUrl, game: 'my-game' });

session.players;                       // live roster, host first
session.onPlayerJoin((p) => { ... });
session.onPlayerLeave((id) => { ... });
session.onMessage((from, data) => { ... });
session.onClose((reason) => { ... }); // host left / disconnected

session.send(data);        // joiner -> host
session.sendTo(id, data);  // host -> one player
session.broadcast(data);   // host -> everyone else
```

Patterns (see `games/taps`):

- The host stamps and fans out events: receive a joiner's message, add
  authoritative fields (sender id, ordering), `broadcast` the result.
- Keep a host-owned `order: string[]` of player ids and broadcast it as a
  roster message — clients derive colors/seats from it.
- Coordinates travel in design space (720x1280) — identical on all phones.
- `game` tags prevent joining another game's room with a stolen code.
- Relay URL resolution for demos: `?relay=` param > saved > localhost dev
  fallback > baked default (`games/taps/src/config.ts` pattern).

Rules: max 8 players/room, nicknames filtered server-side (kid-safe), no
accounts, no PII. Free-tier relays sleep — the client connect timeout is
45s and UIs should say "waking the relay" while hosting.

Testing without phones: MCP tools `create_room` / `join_room_bot` spin up
protocol-level fake players against a local relay; `pnpm verify:net` runs
the full 3-headless-phones check.
