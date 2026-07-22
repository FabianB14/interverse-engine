import { host, join } from '@interverse/net';
import type { Session } from '@interverse/net';
import { GAME_TAG, resolveRelayUrl } from './config.js';
import { savedAcc, savedName, savedSkin, store } from './store.js';
import type { CharType } from './character.js';

/** How a farmer looks, shipped over the wire so visitors render correctly. */
export interface Look {
  t: CharType;
  c: number;
  s: number;
  a: string;
  n: string;
}

export function myLook(): Look {
  return {
    t: store.get<CharType>('charType', 'blob'),
    c: store.get<number>('charColor', 0xe07a5f),
    s: savedSkin(),
    a: savedAcc(),
    n: savedName() ?? 'Farmer',
  };
}

type MsgHandler = (from: string, data: unknown) => void;
type IdHandler = (id: string) => void;

/**
 * The farm's shared session, held OUTSIDE any scene so hosting survives
 * travelling to the market and back. Scenes assign the handler slots in
 * onEnter (and clear them in onExit); the Session's own listeners are
 * installed exactly once, pointing at these slots — re-entering a scene
 * never stacks duplicate handlers.
 */
class FarmNet {
  private sess: Session | null = null;
  /** Latest known looks by player id (host relays these to everyone). */
  readonly looks = new Map<string, Look>();

  onMsg: MsgHandler | null = null;
  onJoin: IdHandler | null = null;
  onLeave: IdHandler | null = null;
  onClose: ((reason: string) => void) | null = null;

  session(): Session | null {
    return this.sess;
  }

  visiting(): boolean {
    return !!this.sess && !this.sess.isHost;
  }

  async host(): Promise<Session> {
    const relay = resolveRelayUrl();
    if (!relay) throw new Error('no relay configured (add ?relay=…)');
    this.sess = await host({ url: relay, game: GAME_TAG, name: myLook().n });
    this.install();
    return this.sess;
  }

  async join(code: string): Promise<Session> {
    const relay = resolveRelayUrl();
    if (!relay) throw new Error('no relay configured (add ?relay=…)');
    this.sess = await join(code, myLook().n, { url: relay, game: GAME_TAG });
    this.install();
    return this.sess;
  }

  leave(): void {
    try {
      this.sess?.leave();
    } catch {
      /* already closed */
    }
    this.sess = null;
    this.looks.clear();
    this.onMsg = this.onJoin = this.onLeave = this.onClose = null;
  }

  private install(): void {
    const s = this.sess;
    if (!s) return;
    this.looks.clear();
    this.looks.set(s.id, myLook());
    s.onMessage((from, data) => {
      // Look exchange is handled here so every scene benefits.
      const msg = data as { type?: string; look?: Look; looks?: Record<string, Look> } | null;
      if (msg?.type === 'look' && msg.look) {
        this.looks.set(from, msg.look);
        if (s.isHost) s.broadcast({ type: 'looks', looks: Object.fromEntries(this.looks) });
      } else if (msg?.type === 'looks' && msg.looks) {
        for (const [id, l] of Object.entries(msg.looks)) this.looks.set(id, l);
      }
      this.onMsg?.(from, data);
    });
    s.onPlayerJoin((p) => {
      if (s.isHost) s.broadcast({ type: 'looks', looks: Object.fromEntries(this.looks) });
      this.onJoin?.(p.id);
    });
    s.onPlayerLeave((id) => {
      this.looks.delete(id);
      this.onLeave?.(id);
    });
    s.onClose((reason) => {
      this.sess = null;
      this.onClose?.(reason);
    });
    // Introduce ourselves (joiners send to host; the host seeds its own map).
    if (!s.isHost) s.send({ type: 'look', look: myLook() });
  }
}

export const farmNet = new FarmNet();
