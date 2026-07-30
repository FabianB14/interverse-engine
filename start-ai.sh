#!/usr/bin/env bash
# Interverse Studio AI bridge — run to start (macOS/Linux/git-bash).
# Needs: Node.js (nodejs.org) + Claude Code (claude.com/claude-code, run `claude` once to sign in).
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found. Install it from https://nodejs.org and run this again."
  exit 1
fi
exec node scripts/ai-bridge.mjs
