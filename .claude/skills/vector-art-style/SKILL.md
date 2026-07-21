---
name: vector-art-style
description: The Interverse house art style — palettes, blob shape language, and animation juice rules for code-drawn vector art. Use when creating or editing any visual asset, scene decoration, or character.
---

# Interverse house art style

Everything is code-drawn (PixiJS Graphics). No image assets. If it can't be
built from rounded shapes and palette colors, simplify the idea.

## Shape language

- **Round beats sharp.** Organic blobs (`drawBlob`), circles, `roundRect`
  with generous radii (≥ height/6). Hard corners only for "danger".
- Characters are blob rigs: `blobCharacter` — body + dot eyes at
  (±0.3r, −0.18r) + blush cheeks at (±0.44r, 0.14r). Personality comes from
  color, seed, size, and motion — not extra detail.
- White outlines (`stroke: ink, strokeWidth: ~radius*0.06`) make characters
  pop off any background; environmental art gets no outline.
- Soft shadows: same blob shape, black at alpha 0.18, offset y +14% radius.
- Detail budget: a tile or prop should read at 32px on screen. Three shapes
  max per tile; use the per-tile `rng` for variation (knots, stitches),
  never uniform repetition.

## Color

- Always start from a named palette (`partyPop` for energetic games,
  `cozyAutumn` for warm/gentle ones; add new palettes to
  `packages/engine/src/art/palettes.ts` rather than inlining hexes).
- Entities use `palette.colors[...]` (assign by player index in multiplayer).
- Shading = `darken(base, 0.15–0.3)`; highlights = `lighten(base, 0.1–0.2)`.
  Never pure black/white except `ink` text and outlines.
- Text: `ink` for primary, `inkSoft` for secondary, `accent` for scores/CTA.

## Juice rules (non-negotiable)

- Everything that appears: `popIn` (outBack overshoot). Everything that dies:
  shrink or fade ≤ 0.4s. Nothing just appears or vanishes.
- Idle characters breathe: `Wobble` amount 0.03–0.05, speed 2–3, randomized
  `phase` so crowds don't sync.
- Impacts squash: `squash` amount 0.3–0.4 for hits, plus particles (6–10
  palette-colored circles, radial velocity, fade 0.45s) for destruction.
- Motion feedback: walking = body-scale bob at ~11Hz; camera `shake` for
  surprises (amplitude 8–12, duration 0.3s).
- Pulse "tap me" text with sine alpha (0.6 ± 0.4 at ~4Hz).

## Screen craft

- Design space 720x1280 portrait. Keep vital UI inside 40px margins.
- One focal point per screen; headers ≤ 25% of height; CTAs in the bottom
  third where thumbs live.
