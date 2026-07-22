import { Text } from 'pixi.js';
import { FARM } from './theme.js';

export interface TextOptions {
  color?: number;
  weight?: 'normal' | 'bold' | '800' | '900';
  letterSpacing?: number;
  wrapWidth?: number;
  align?: 'left' | 'center' | 'right';
}

/** Centered-anchor text in the cozy house style. */
export function makeText(content: string, size: number, opts: TextOptions = {}): Text {
  const t = new Text({
    text: content,
    style: {
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontSize: size,
      fontWeight: opts.weight ?? '900',
      fill: opts.color ?? FARM.ink,
      letterSpacing: opts.letterSpacing ?? 0,
      align: opts.align ?? 'center',
      ...(opts.wrapWidth ? { wordWrap: true, wordWrapWidth: opts.wrapWidth } : {}),
    },
  });
  t.anchor.set(0.5);
  return t;
}
