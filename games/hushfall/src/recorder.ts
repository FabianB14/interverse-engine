/**
 * In-game screen recording: captures the game CANVAS (not the whole screen,
 * so no browser permission prompt) via captureStream + MediaRecorder and
 * saves a video file. Fully feature-detected — on browsers without support
 * (older iOS Safari) the record button simply never appears, so the game
 * behaves exactly as before.
 */

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

function pickMime(): string {
  // Safari records mp4; Chrome/Firefox record webm. First supported wins.
  for (const m of ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export class ScreenRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  /** Start capturing the canvas at 30fps. Returns false if unsupported. */
  start(canvas: HTMLCanvasElement): boolean {
    if (!recordingSupported() || this.rec) return false;
    this.mime = pickMime();
    if (!this.mime) return false;
    try {
      const stream = canvas.captureStream(30);
      this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 5_000_000 });
    } catch {
      this.rec = null;
      return false;
    }
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(1000); // flush a chunk every second so long clips survive
    return true;
  }

  /** Stop and hand the clip to the browser's downloads (Files app on iOS). */
  stop(): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mime });
      this.chunks = [];
      if (blob.size === 0) return;
      const ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hushfall-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
    for (const t of rec.stream.getTracks()) t.stop();
  }
}
