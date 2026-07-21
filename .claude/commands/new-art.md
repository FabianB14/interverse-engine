---
description: Create a code-drawn VectorArt asset in the house style
argument-hint: <description of the asset>
---

Create a code-drawn vector art asset: "$ARGUMENTS".

1. Read `.claude/skills/vector-art-style/SKILL.md` (house style) and
   docs/art.md (API).
2. Build it as a function returning a `Container` (or `{ view, body }` rig
   like `blobCharacter`) using PixiJS Graphics + engine helpers — no image
   assets. Deterministic by `seed`; colors from a named palette parameter,
   never hardcoded hex soup.
3. Put game-specific art in that game's `src/art/`; promote to
   `packages/engine/src/art/` only if a second game needs it.
4. Look at it: `run_dev` + `screenshot` via the MCP server, iterate until it
   reads clearly at phone size (assume ~0.5x design scale).
