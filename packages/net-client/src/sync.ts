/**
 * Family sync — move a small save blob (the shared Verium wallet) between
 * devices/apps through the relay's /sync endpoints. Installed home-screen
 * apps get ISOLATED storage on iOS, so "same phone" still needs this.
 *
 * Semantics are transfer-style: push uploads under a short code, pull
 * fetches it on the other side. Codes expire in ~a day.
 */

// Same unambiguous alphabet the relay uses for room codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeSyncCode(len = 5): string {
  let code = '';
  for (let i = 0; i < len; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

/** ws(s):// relay URL → its http(s):// base. */
function httpBase(relayUrl: string): string {
  return relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/** Upload `data` under a fresh code; returns the code to read out loud. */
export async function syncPush(relayUrl: string, data: unknown): Promise<string> {
  const code = makeSyncCode();
  const res = await fetch(`${httpBase(relayUrl)}/sync/${code}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`sync upload failed (${res.status})`);
  return code;
}

/** Fetch the blob stored under `code`, or null if unknown/expired. */
export async function syncPull(relayUrl: string, code: string): Promise<unknown | null> {
  const res = await fetch(`${httpBase(relayUrl)}/sync/${code.toUpperCase()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`sync fetch failed (${res.status})`);
  return (await res.json()) as unknown;
}
