---
description: Launch a game's dev server and print the LAN URL + QR for real phones
argument-hint: <game>
---

Playtest `games/$1` on real phones.

1. If the game is multiplayer, start the local relay first (background):
   `pnpm relay`.
2. Run `node scripts/playtest.mjs $1` in the background and report its
   output: it starts the vite dev server and prints the phone-ready LAN URL
   plus an ASCII QR code to scan.
3. Also sanity-check headlessly before handing over: MCP `screenshot` of the
   running URL — confirm the game renders with no console errors.
4. Remind the tester: phone must be on the same Wi-Fi as this machine; the
   FPS readout top-left should say ~60.
