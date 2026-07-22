# Blobvale M7 — economy, store, portraits, customize screen, ready flow, update button

Six features from the user, built in shippable waves:

## Wave H — Update button (PWA) [independent, small]

- Every game's `index.html`: an always-visible "⟳ Update" button (next to
  Install) that clears caches + unregisters the service worker + hard-
  reloads, pulling the newest release. So after a new deploy the user taps
  Update and gets it without reinstalling.
- `sw.js`: bump cache name to a version and delete old caches on activate.

## Wave D — Verium currency [engine + blobvale]

- Engine `packages/engine/src/economy/wallet.ts`: `verium` wallet backed by
  the SHARED save namespace `interverse:wallet`, so every Interverse game
  reads/writes the same balance. API: `balance()`, `add(n)`, `spend(n)`.
- Blobvale earns Verium when the party kills: `die` fx carries a `coin`
  amount (mob 5, boss 60); each client adds it locally and shows a floating
  "+N ⬡". Balance shown in the lobby and world HUD.

## Wave E — Customize close-up + mini store [depends on D]

- A full-screen customize overlay in the lobby (keeps the session live),
  opened by a ✨ CUSTOMIZE button that appears once you've picked a class.
  Big blob close-up + COLOR / ACCESSORY / SOUND controls (moved out of the
  crowded lobby) + a STORE to buy locked accessories with Verium.
- Expand `ACCESSORIES` with many more items; a `price` marks purchasable
  ones. Owned set persists (`ownedAccs`); locked items show their price and
  buy-then-equip on tap when affordable.

## Wave F — Party portraits + health (world top-left)

- World HUD: a vertical stack of small blob portraits + name + HP bar for
  every party member, driven by the synced stats.

## Wave G — Ready toggle + countdown (lobby)

- Non-host players get a toggleable READY button; state syncs to the host
  (`ready` message + roster.ready map), shown on roster chips. When all
  non-host players are ready, the host runs a 3·2·1 countdown then auto-
  starts (host START still works to start immediately). Un-readying cancels.
  Interpretation: the host is the "one" who doesn't need to ready.

Each wave: gates green → extend verify → ship fabian-branch → ff main → Pages.
