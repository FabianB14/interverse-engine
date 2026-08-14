/**
 * Proximity voice chat (spec §8.6-aware): OFF by default, per-device opt-in
 * from Settings, and the mic is only requested when a hunt starts with the
 * toggle on. Peers connect in a WebRTC mesh; the star-topology relay only
 * carries the tiny signaling packets (host forwards joiner↔joiner ones).
 * Each remote voice is volume-scaled by in-game distance — whispers nearby,
 * silence across the manor. No servers store or route any audio.
 */

export interface VcSignal {
  type: 'vc';
  /** Target player id, or '*' to announce to the whole room. */
  vto: string;
  vfrom: string;
  sub: 'hello' | 'offer' | 'answer' | 'ice' | 'bye';
  /** True on a direct hello reply — stops hello ping-pong. */
  re?: boolean;
  sdp?: string;
  cand?: unknown;
}

export function isVcSignal(m: unknown): m is VcSignal {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'vc';
}

export function voiceSupported(): boolean {
  return (
    typeof RTCPeerConnection !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

// Full volume within a whisper's reach; silent beyond a room or two.
const VOICE_FULL = 260;
const VOICE_FADE = 900;

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingIce: unknown[];
  haveRemote: boolean;
}

export class ProximityVoice {
  private peers = new Map<string, Peer>();
  private mic: MediaStream | null = null;
  private stopped = false;

  constructor(
    private myId: string,
    private sendSignal: (pkt: VcSignal) => void,
  ) {}

  /** Ask for the mic and announce to the room. False = denied/unsupported. */
  async start(): Promise<boolean> {
    if (!voiceSupported()) return false;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    if (this.stopped) {
      for (const t of this.mic.getTracks()) t.stop();
      return false;
    }
    this.sendSignal({ type: 'vc', vto: '*', vfrom: this.myId, sub: 'hello' });
    return true;
  }

  handleSignal(pkt: VcSignal): void {
    if (this.stopped || !this.mic || pkt.vfrom === this.myId) return;
    void this.handle(pkt);
  }

  private async handle(pkt: VcSignal): Promise<void> {
    const from = pkt.vfrom;
    switch (pkt.sub) {
      case 'hello': {
        // Make ourselves known (once), then the lower id makes the offer so
        // exactly one side initiates.
        if (!pkt.re && !this.peers.has(from)) {
          this.sendSignal({ type: 'vc', vto: from, vfrom: this.myId, sub: 'hello', re: true });
        }
        if (!this.peers.has(from) && this.myId < from) {
          const peer = this.makePeer(from);
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.sendSignal({
            type: 'vc',
            vto: from,
            vfrom: this.myId,
            sub: 'offer',
            sdp: offer.sdp ?? '',
          });
        }
        break;
      }
      case 'offer': {
        const peer = this.peers.get(from) ?? this.makePeer(from);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: pkt.sdp ?? '' });
        peer.haveRemote = true;
        await this.flushIce(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal({
          type: 'vc',
          vto: from,
          vfrom: this.myId,
          sub: 'answer',
          sdp: answer.sdp ?? '',
        });
        break;
      }
      case 'answer': {
        const peer = this.peers.get(from);
        if (!peer) return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: pkt.sdp ?? '' });
        peer.haveRemote = true;
        await this.flushIce(peer);
        break;
      }
      case 'ice': {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.haveRemote) {
          await peer.pc.addIceCandidate(pkt.cand as RTCIceCandidateInit).catch(() => undefined);
        } else {
          peer.pendingIce.push(pkt.cand);
        }
        break;
      }
      case 'bye':
        this.dropPeer(from);
        break;
    }
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) {
      await peer.pc.addIceCandidate(c as RTCIceCandidateInit).catch(() => undefined);
    }
  }

  private makePeer(id: string): Peer {
    // STUN only (no TURN): works on LANs outright and most home networks;
    // where NAT wins, that pair simply stays silent — the game is untouched.
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.volume = 0;
    document.body.appendChild(audio);
    const peer: Peer = { pc, audio, pendingIce: [], haveRemote: false };
    if (this.mic) for (const track of this.mic.getTracks()) pc.addTrack(track, this.mic);
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => undefined);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({
          type: 'vc',
          vto: id,
          vfrom: this.myId,
          sub: 'ice',
          cand: e.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(id);
    };
    this.peers.set(id, peer);
    return peer;
  }

  private dropPeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }
    peer.audio.srcObject = null;
    peer.audio.remove();
  }

  /** Called every frame: distance (design units) to each connected player. */
  updateDistances(dist: (id: string) => number | null): void {
    for (const [id, peer] of this.peers) {
      const d = dist(id);
      let vol = 0;
      if (d !== null) {
        vol =
          d <= VOICE_FULL ? 1 : d >= VOICE_FADE ? 0 : (VOICE_FADE - d) / (VOICE_FADE - VOICE_FULL);
      }
      peer.audio.volume = vol;
    }
  }

  get peerCount(): number {
    return this.peers.size;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const id of [...this.peers.keys()]) {
      this.sendSignal({ type: 'vc', vto: id, vfrom: this.myId, sub: 'bye' });
      this.dropPeer(id);
    }
    if (this.mic) for (const t of this.mic.getTracks()) t.stop();
    this.mic = null;
  }
}
