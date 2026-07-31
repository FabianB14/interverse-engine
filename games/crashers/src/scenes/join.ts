/**
 * 🔑 Four letters and you are in.
 *
 * An on-screen keypad rather than a text field: a real input on a phone
 * summons the OS keyboard over half the screen, autocorrects a room code
 * into a word, and — in an installed PWA — sometimes never dismisses. Thirty
 * buttons are less code than working around any one of those.
 *
 * The alphabet has no I/O/0/1 in it, because a code read out loud has to
 * survive being read out loud.
 */

import { Graphics, Text } from 'pixi.js';
import { Scene, audio } from '@interverse/engine';
import { join } from '@interverse/net';
import { UIButton } from '@interverse/ui';
import type { Session } from '@interverse/net';
import { GAME_TAG, resolveRelayUrl } from '../config.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;

export class JoinScene extends Scene {
  private code = '';
  private busy = false;
  private slots: Text[] = [];
  private status!: Text;
  private keys: UIButton[] = [];

  constructor(
    private readonly onJoined: (session: Session) => void,
    private readonly onBack: () => void,
    private readonly prefill = '',
  ) {
    super();
  }

  protected override onEnter(): void {
    this.build();
    if (this.prefill) for (const ch of this.prefill.toUpperCase().slice(0, CODE_LENGTH)) this.press(ch, true);
  }

  protected override onResize(): void {
    this.stage.removeChildren();
    this.slots = [];
    this.keys = [];
    // build() ends with refresh(), so the code typed so far survives a
    // rotation — losing three letters to turning the phone is unforgivable.
    this.build();
  }

  private build(): void {
    const W = this.game.viewWidth;
    const H = this.game.viewHeight;
    this.stage.addChild(new Graphics().rect(0, 0, W, H).fill(0x18122a));

    const title = new Text({
      text: 'ENTER ROOM CODE',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0xffd166 },
    });
    title.anchor.set(0.5, 0);
    title.position.set(W * 0.27, 44);
    this.stage.addChild(title);

    const slotW = Math.min(96, W * 0.1);
    const gap = 16;
    const total = CODE_LENGTH * slotW + (CODE_LENGTH - 1) * gap;
    for (let i = 0; i < CODE_LENGTH; i++) {
      const x = W * 0.27 - total / 2 + slotW / 2 + i * (slotW + gap);
      const y = 130;
      const box = new Graphics()
        .roundRect(-slotW / 2, -slotW * 0.6, slotW, slotW * 1.2, 14)
        .fill({ color: 0xffffff, alpha: 0.06 })
        .roundRect(-slotW / 2, -slotW * 0.6, slotW, slotW * 1.2, 14)
        .stroke({ color: 0x3a3160, width: 3 });
      box.position.set(x, y);
      const ch = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontSize: slotW * 0.7, fontWeight: '800', fill: 0x8affc1 },
      });
      ch.anchor.set(0.5);
      ch.position.set(x, y);
      this.stage.addChild(box, ch);
      this.slots.push(ch);
    }

    this.status = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: 19, fontWeight: '700', fill: 0xff6f91,
        align: 'center', wordWrap: true, wordWrapWidth: Math.min(460, W * 0.5),
      },
    });
    this.status.anchor.set(0.5, 0);
    this.status.position.set(W * 0.27, 222);
    this.stage.addChild(this.status);

    // The keypad sits on the right so a thumb reaches it and the code above
    // stays visible while you type.
    const perRow = 8;
    const kw = Math.min(62, (W * 0.52) / perRow - 8);
    const kh = Math.min(66, (H - 120) / 4 - 10);
    const rowW = perRow * kw + (perRow - 1) * 8;
    const all = [...ALPHABET.split(''), '⌫'];
    all.forEach((key, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const b = new UIButton(key, {
        width: kw, height: kh, fontSize: Math.min(26, kw * 0.45),
        fill: key === '⌫' ? 0xff6f91 : 0x3a3160,
        onTap: () => this.press(key),
      });
      b.position.set(W * 0.68 - rowW / 2 + kw / 2 + col * (kw + 8), 76 + row * (kh + 10));
      this.add(b);
      this.keys.push(b);
    });

    const back = new UIButton('← BACK', {
      width: 176, height: 62, fontSize: 20, fill: 0x3a3160, onTap: () => this.onBack(),
    });
    back.position.set(W * 0.27, H - 62);
    this.add(back);
    this.refresh();
  }

  private press(key: string, silent = false): void {
    if (this.busy) return;
    if (!silent) audio.blip();
    if (key === '⌫') this.code = this.code.slice(0, -1);
    else if (this.code.length < CODE_LENGTH && ALPHABET.includes(key)) this.code += key;
    this.status.text = '';
    this.refresh();
    if (this.code.length === CODE_LENGTH) void this.tryJoin();
  }

  private refresh(): void {
    this.slots.forEach((s, i) => (s.text = this.code[i] ?? ''));
  }

  private async tryJoin(): Promise<void> {
    const url = resolveRelayUrl();
    if (!url) {
      this.status.text = 'No relay configured — open with ?relay=wss://your-relay';
      return;
    }
    this.busy = true;
    this.status.style.fill = 0x9a97b8;
    this.status.text = 'Connecting…';
    try {
      const session = await join(this.code, 'Player', { url, game: GAME_TAG });
      audio.chime();
      this.onJoined(session);
    } catch (err) {
      this.busy = false;
      this.status.style.fill = 0xff6f91;
      // Say what went wrong, not "error": the usual cause is a typo'd code,
      // and the fix for that is knowing it was the code.
      this.status.text = `${err instanceof Error ? err.message : 'Could not join'} — check the code and try again`;
      this.code = '';
      this.refresh();
      audio.buzz();
    }
  }

  // ------------------------------------------------- headless test hooks

  debugType(code: string): void {
    this.code = '';
    for (const ch of code.toUpperCase().slice(0, CODE_LENGTH)) this.press(ch, true);
  }

  debugStatus(): string {
    return this.status.text;
  }
}
