import { GAME_TAG } from './game.js';

/**
 * Relay URL resolution, most specific first:
 * query ?relay= (persisted) > saved > VITE_RELAY_URL > localhost dev relay
 * > the deployed default. One relay serves every Interverse game.
 */
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
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8787`;
  if (DEFAULT_RELAY_URL) return normalize(DEFAULT_RELAY_URL);
  return null;
}

export { GAME_TAG };
