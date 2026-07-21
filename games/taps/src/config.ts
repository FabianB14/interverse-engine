/**
 * Relay URL resolution, most specific first:
 *   1. ?relay=wss://...   (saved to localStorage for next time)
 *   2. previously saved value
 *   3. VITE_RELAY_URL build-time env
 *   4. DEFAULT_RELAY_URL below — set this once the relay is deployed
 *   5. ws://<host>:8787 during local dev
 */

// The deployed relay (Render, free plan — it naps when idle and takes
// ~30s to wake on the first connection).
const DEFAULT_RELAY_URL = 'wss://interverse-engine.onrender.com';

const STORAGE_KEY = 'interverse-relay-url';

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
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* private mode — fine */
    }
    return url;
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;
  } catch {
    /* private mode — fine */
  }
  const env = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (env) return normalize(env);
  // Local dev always talks to the local relay (pnpm relay), even when a
  // production default is configured below.
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8787`;
  if (DEFAULT_RELAY_URL) return normalize(DEFAULT_RELAY_URL);
  return null;
}

export const GAME_TAG = 'tap-party';
