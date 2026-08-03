/**
 * Relay wiring, same ladder as the other multiplayer games:
 * ?relay= param > VITE_RELAY_URL > deployed default > local dev :8787.
 */

const DEFAULT_RELAY_URL = 'wss://interverse-engine.onrender.com';

export const GAME_TAG = 'haven';

function normalize(u: string): string {
  if (u.startsWith('ws://') || u.startsWith('wss://')) return u;
  if (u.startsWith('http://')) return `ws://${u.slice(7)}`;
  if (u.startsWith('https://')) return `wss://${u.slice(8)}`;
  return `wss://${u}`;
}

export function resolveRelayUrl(): string {
  const param = new URLSearchParams(location.search).get('relay');
  if (param) return normalize(param);
  const env = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (env) return normalize(env);
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return `ws://${h}:8787`;
  return normalize(DEFAULT_RELAY_URL);
}

function relayHttp(): string {
  const ws = resolveRelayUrl();
  return ws.startsWith('wss://') ? `https://${ws.slice(6)}` : `http://${ws.slice(5)}`;
}

/** The presence lookup rides the same relay over plain HTTPS. */
export function presenceUrl(codes: string[]): string {
  return `${relayHttp()}/presence?codes=${encodeURIComponent(codes.join(','))}`;
}

/** The Verium vault: the relay mirrors a balance per friend code. */
export function walletUrl(code: string): string {
  return `${relayHttp()}/wallet/${encodeURIComponent(code)}`;
}
