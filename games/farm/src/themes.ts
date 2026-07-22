import { verium } from '@interverse/engine';
import { store } from './store.js';

/**
 * Farm themes — whole-farm looks sold in the shop. Each retints the tile
 * painters (grass, trees, water, flowers); Sakura adds blossom dots to the
 * canopy. The default look is free and always owned.
 */
export interface FarmThemeDef {
  id: string;
  name: string;
  emoji: string;
  price?: number;
  grass: number;
  water: number;
  foliage: number;
  trunk: number;
  path: number;
  flowerPetals: number[];
  /** Blossom-dot color sprinkled on tree canopies (Sakura-style). */
  blossom?: number;
}

export const THEMES: readonly FarmThemeDef[] = [
  {
    id: 'meadow',
    name: 'Meadow',
    emoji: '🌿',
    grass: 0x7bab54,
    water: 0x4d90b0,
    foliage: 0x4f7a34,
    trunk: 0x6b4a2f,
    path: 0xcaa877,
    flowerPetals: [0xffd166, 0xff9fb2, 0xf2ffe9, 0xc77dff],
  },
  {
    id: 'sakura',
    name: 'Sakura',
    emoji: '🌸',
    price: 250,
    grass: 0x8fb573,
    water: 0x6aa8c8,
    foliage: 0xe8a7bc,
    trunk: 0x5d4037,
    path: 0xd8c3a5,
    flowerPetals: [0xffc2d4, 0xff9fb2, 0xfff0f4, 0xf7cfe0],
    blossom: 0xffdce8,
  },
  {
    id: 'rainforest',
    name: 'Rainforest',
    emoji: '🦜',
    price: 250,
    grass: 0x3e7d44,
    water: 0x2f7f8f,
    foliage: 0x1f5e30,
    trunk: 0x4e342e,
    path: 0x8d6e63,
    flowerPetals: [0xff5470, 0xffd166, 0x59d0c0, 0xc77dff],
  },
  {
    id: 'hacienda',
    name: 'Hacienda',
    emoji: '🌵',
    price: 250,
    grass: 0xb5a35c,
    water: 0x58a3a3,
    foliage: 0x6a8f4f,
    trunk: 0x8d5a3b,
    path: 0xc98a4b,
    flowerPetals: [0xe07a5f, 0xffd166, 0xd94f6a, 0xf2cc8f],
  },
];

export function themeById(id: string): FarmThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export function currentTheme(): FarmThemeDef {
  return themeById(store.get<string>('farmTheme', 'meadow'));
}

const OWNED_KEY = 'ownedThemes';

export function isThemeOwned(id: string): boolean {
  const def = themeById(id);
  if (!def.price) return true;
  return store.get<string[]>(OWNED_KEY, []).includes(id);
}

export function buyTheme(id: string): boolean {
  const def = themeById(id);
  if (!def.price || isThemeOwned(id)) return false;
  if (!verium.spend(def.price)) return false;
  const owned = store.get<string[]>(OWNED_KEY, []);
  owned.push(id);
  store.set(OWNED_KEY, owned);
  return true;
}

export function applyTheme(id: string): void {
  if (isThemeOwned(id)) store.set('farmTheme', themeById(id).id);
}
