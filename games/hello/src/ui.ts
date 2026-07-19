import { Text } from 'pixi.js';
import { partyPop } from '@interverse/engine';

export interface TextOptions {
  color?: number;
  weight?: 'normal' | 'bold' | '800' | '900';
  letterSpacing?: number;
}

/** Centered-anchor text in the game's house style. */
export function makeText(content: string, size: number, opts: TextOptions = {}): Text {
  const t = new Text({
    text: content,
    style: {
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontSize: size,
      fontWeight: opts.weight ?? '900',
      fill: opts.color ?? partyPop.ink,
      letterSpacing: opts.letterSpacing ?? 0,
      align: 'center',
    },
  });
  t.anchor.set(0.5);
  return t;
}
