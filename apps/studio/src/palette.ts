import type { EntityKind } from './model.js';

export interface PaletteItem {
  /** Placeable actor kinds. Omitted for items that open a screen instead. */
  kind?: EntityKind;
  /** Screen this item opens rather than placing anything. */
  opens?: 'controls';
  label: string;
  emoji: string;
}

export const PALETTE: { title: string; items: PaletteItem[] }[] = [
  {
    // The palette is where people look for "things I can add", and a
    // control IS a thing you add — so binds get a door here too.
    title: 'Controls',
    items: [{ opens: 'controls', label: 'Key & button binds', emoji: '🎮' }],
  },
  {
    title: 'Characters',
    items: [
      { kind: 'blob', label: 'Blob character', emoji: '🙂' },
      { kind: 'npc', label: 'Story character', emoji: '💬' },
    ],
  },
  {
    title: 'Enemies',
    items: [
      { kind: 'mob', label: 'Monster', emoji: '👾' },
      { kind: 'boss', label: 'Boss', emoji: '👹' },
    ],
  },
  {
    title: 'Props',
    items: [
      { kind: 'crate', label: 'Crate', emoji: '📦' },
      { kind: 'lantern', label: 'Lantern', emoji: '🏮' },
      { kind: 'plant', label: 'Plant', emoji: '🪴' },
    ],
  },
  {
    title: '3D',
    items: [
      { kind: 'shape', label: 'Shape (plane/box/ramp)', emoji: '🧊' },
      { kind: 'camera', label: 'Camera', emoji: '🎥' },
    ],
  },
  {
    title: 'UI',
    items: [
      { kind: 'text', label: 'Text label', emoji: '🔤' },
      { kind: 'button', label: 'Button', emoji: '🔘' },
    ],
  },
  {
    title: 'Assets',
    items: [{ kind: 'image', label: 'Import image…', emoji: '🖼️' }],
  },
];
