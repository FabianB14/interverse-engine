import type { EntityKind } from './model.js';

export interface PaletteItem {
  kind: EntityKind;
  label: string;
  emoji: string;
}

export const PALETTE: { title: string; items: PaletteItem[] }[] = [
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
