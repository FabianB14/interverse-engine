/**
 * @interverse/platform — TypeScript client for the Interverse (IVX) platform,
 * a browser twin of the Python InterverseSDK against the same REST API
 * (fabianb14/interverse). Everything is optional and offline-first: games run
 * fine with the local Verium wallet alone; configure a platform URL and the
 * same calls go to the real chain.
 *
 * Spec §8.4 note (no API keys in shipped games): registering a game returns a
 * game api_key used for reward distribution. That key is DEV-TIME material —
 * Studio keeps it on the author's device; exported games carry only the
 * public gameId/apiUrl and read-only endpoints.
 */

export interface PlatformConfig {
  /** Base URL of an Interverse node, e.g. https://ivx.example.com */
  apiUrl: string;
  /** Registered game id (POST /games/register). */
  gameId?: string;
  /** DEV-TIME ONLY reward key — never ship in an exported game. */
  apiKey?: string;
}

export interface ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface GameRegistration {
  game_id: string;
  developer_name: string;
  game_name: string;
  game_metadata?: Record<string, unknown>;
}

export type RewardEvent =
  | 'achievement'
  | 'quest_completion'
  | 'tournament_reward'
  | 'gameplay_milestone'
  | 'custom';

export class PlatformClient {
  constructor(readonly config: PlatformConfig) {}

  private get base(): string {
    return this.config.apiUrl.replace(/\/$/, '');
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as ApiResponse<T> & Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.detail ?? data.message ?? `${res.status} ${res.statusText}`));
    }
    return data;
  }

  /** Is the node reachable? */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Register a game with the world → { game_id, api_key, ... }. Dev-time. */
  registerGame(reg: GameRegistration): Promise<ApiResponse<{ game_id: string; api_key: string }>> {
    return this.call('POST', '/games/register', reg);
  }

  /** Wallet IVX balance — the chain is the source of truth. */
  async walletBalance(address: string): Promise<number> {
    const res = await this.call<{ balance?: number }>('GET', `/wallet/${address}/balance`);
    const d = res.data as Record<string, unknown> | undefined;
    const n = Number(d?.balance ?? (res as unknown as { balance?: number }).balance ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /** Assets a wallet owns (cross-game items / NFTs). */
  walletAssets(address: string): Promise<ApiResponse<unknown[]>> {
    return this.call('GET', `/wallet/${address}/assets`);
  }

  /** Create a global player identity. */
  identityCreate(payload: Record<string, unknown>): Promise<ApiResponse> {
    return this.call('POST', '/identity/create', payload);
  }

  /** Distribute a reward for a game event. DEV-TIME (needs the game key). */
  distributeReward(opts: {
    playerAddress: string;
    event: RewardEvent;
    amount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ApiResponse> {
    if (!this.config.apiKey) return Promise.reject(new Error('no api key configured (dev-time only)'));
    return this.call('POST', '/rewards/distribute', {
      game_id: this.config.gameId,
      api_key: this.config.apiKey,
      player_address: opts.playerAddress,
      event_type: opts.event,
      amount: opts.amount,
      metadata: opts.metadata ?? {},
    });
  }

  /** Reward history for a player. */
  rewardsHistory(address: string): Promise<ApiResponse<unknown[]>> {
    return this.call('GET', `/rewards/history?player_address=${encodeURIComponent(address)}`);
  }
}

/**
 * Bridge the engine's local Verium wallet with the platform: reads the IVX
 * balance for `address` (when configured + reachable) so games can show the
 * real chain balance beside — never instead of — the always-working local
 * Verium. Returns null when offline/unconfigured.
 */
export async function fetchChainBalance(
  config: PlatformConfig | null | undefined,
  address: string | null | undefined,
): Promise<number | null> {
  if (!config?.apiUrl || !address) return null;
  try {
    const client = new PlatformClient(config);
    return await client.walletBalance(address);
  } catch {
    return null;
  }
}
