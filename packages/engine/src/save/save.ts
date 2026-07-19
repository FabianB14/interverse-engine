export interface SaveStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  clear(): void;
}

interface SaveState {
  v: number;
  data: Record<string, unknown>;
}

/**
 * Versioned key/value storage (§4.9). Values must be JSON-serializable.
 * Backed by localStorage; falls back to in-memory storage when localStorage
 * is unavailable (private browsing, some embedded webviews). Capacitor
 * Preferences backing lands with the native shell.
 */
export function createSave(
  namespace: string,
  version = 1,
  migrate?: (data: Record<string, unknown>, fromVersion: number) => Record<string, unknown>,
): SaveStore {
  const storageKey = `interverse:${namespace}`;
  let state: SaveState | null = null;
  let storageOk = true;

  const load = (): SaveState => {
    if (state) return state;
    let parsed: unknown = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) parsed = JSON.parse(raw) as unknown;
    } catch {
      storageOk = false;
    }
    let next: SaveState = { v: version, data: {} };
    if (parsed !== null && typeof parsed === 'object' && 'v' in parsed && 'data' in parsed) {
      const prev = parsed as { v: unknown; data: unknown };
      if (typeof prev.v === 'number' && typeof prev.data === 'object' && prev.data !== null) {
        const data = prev.data as Record<string, unknown>;
        next =
          prev.v === version || !migrate
            ? { v: version, data }
            : { v: version, data: migrate(data, prev.v) };
      }
    }
    state = next;
    return state;
  };

  const persist = (): void => {
    if (!storageOk || !state) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      storageOk = false; // quota / private mode — keep the in-memory copy
    }
  };

  return {
    get<T>(key: string, fallback: T): T {
      const s = load();
      return key in s.data ? (s.data[key] as T) : fallback;
    },
    set(key: string, value: unknown): void {
      const s = load();
      s.data[key] = value;
      persist();
    },
    remove(key: string): void {
      const s = load();
      delete s.data[key];
      persist();
    },
    clear(): void {
      state = { v: version, data: {} };
      persist();
    },
  };
}
