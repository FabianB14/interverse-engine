/**
 * 🏪 The Blobhaven store — everything buyable, in one catalogue, priced in
 * ⬡ Verium (the SHARED Interverse wallet from @interverse/core: the same
 * balance Bloomstead and Blobvale pay into, so coins earned farming buy
 * hats here). Price 0 means starter gear — owned by everyone forever.
 *
 * Model decor: MODEL_DECOR lists .glb files under public/models/. To sell
 * a new model, drop the file there and add one line — loadModel handles
 * scale + grounding, the store handles the rest.
 */

export interface PricedItem {
  id: string;
  name: string;
  price: number;
}

export const HAT_STORE: readonly PricedItem[] = [
  { id: 'none', name: 'Bare', price: 0 },
  { id: 'sprout', name: 'Sprout', price: 0 },
  { id: 'cap', name: 'Cap', price: 40 },
  { id: 'flower', name: 'Flower', price: 50 },
  { id: 'sun', name: 'Sun Hat', price: 60 },
  { id: 'party', name: 'Party Cone', price: 80 },
  { id: 'wizard', name: 'Wizard', price: 120 },
  { id: 'crown', name: 'Crown', price: 150 },
  { id: 'viking', name: 'Viking', price: 160 },
  { id: 'tophat', name: 'Top Hat', price: 200 },
  { id: 'halo', name: 'Halo', price: 250 },
  { id: 'prop', name: 'Propeller', price: 300 },
];

/** Base coat colors everyone owns; premium coats are bought once. */
export const BASE_COLORS: readonly number[] = [
  0xe07a5f, 0xf2cc8f, 0x81b29a, 0x6fc3ff, 0xc77dff, 0xff6f91, 0xffc75f, 0x8affc1,
];
export const PREMIUM_COLORS: readonly { color: number; name: string; price: number }[] = [
  { color: 0xf5c542, name: 'Gold', price: 80 },
  { color: 0x3ef0c5, name: 'Glowmint', price: 80 },
  { color: 0x9a8cff, name: 'Lavender', price: 80 },
  { color: 0x2b3a5c, name: 'Midnight', price: 100 },
];

/** Furniture beyond the free starter set. Model-backed pieces live in
 *  MODEL_DECOR but are SOLD through this list too. */
export const FURNITURE_STORE: readonly PricedItem[] = [
  { id: 'campfire', name: 'Campfire', price: 60 },
  { id: 'swing', name: 'Swing', price: 80 },
  { id: 'telescope', name: 'Telescope', price: 100 },
  { id: 'piano', name: 'Piano', price: 120 },
  { id: 'aquarium', name: 'Aquarium', price: 140 },
  { id: 'gnome', name: 'Gnome Statue', price: 90 },
  { id: 'bear', name: 'Teddy Bear', price: 110 },
];

/** .glb decor: drop a file in public/models/, list it here, price it in
 *  FURNITURE_STORE, and it is in the game. */
export const MODEL_DECOR: readonly { id: string; url: string; height: number }[] = [
  { id: 'gnome', url: 'models/gnome.glb', height: 130 },
  { id: 'bear', url: 'models/bear.glb', height: 110 },
];

export type HouseSizeId = 'cozy' | 'grand' | 'manor';

export interface HouseDims {
  w: number;
  d: number;
  doorW: number;
  halfW: number;
  halfD: number;
  stories: number;
}

/** Footprint + interior half-extents per size. The exterior box and the
 *  interior room are the same numbers — the walk-in trigger, the wall
 *  collision and the art all read THIS. */
export const HOUSE_SIZES: Record<HouseSizeId, HouseDims> = {
  cozy: { w: 640, d: 460, doorW: 150, halfW: 460, halfD: 320, stories: 1 },
  grand: { w: 900, d: 620, doorW: 170, halfW: 620, halfD: 430, stories: 1 },
  manor: { w: 1000, d: 700, doorW: 180, halfW: 680, halfD: 470, stories: 2 },
};

export const HOUSE_STORE: readonly (PricedItem & { blurb: string })[] = [
  { id: 'cozy', name: 'Cozy Cottage', price: 0, blurb: 'one warm room' },
  { id: 'grand', name: 'Grand House', price: 400, blurb: 'half again the floor' },
  { id: 'manor', name: 'Two-Story Manor', price: 800, blurb: 'a loft up the stairs' },
];

export interface HouseTheme {
  id: string;
  name: string;
  price: number;
  wall: number;
  roof: number;
  door: number;
  inWall: number;
  floor: number;
}

export const THEME_STORE: readonly HouseTheme[] = [
  { id: 'meadow', name: 'Meadow', price: 0, wall: 0xd8c9a8, roof: 0xa8543a, door: 0x6a4a32, inWall: 0xc9b896, floor: 0x8a6a48 },
  { id: 'sage', name: 'Sage', price: 100, wall: 0xb8c8a8, roof: 0x5a7a52, door: 0x4a5a42, inWall: 0xc2d0b4, floor: 0x7a6a4c },
  { id: 'dusk', name: 'Dusk', price: 100, wall: 0x9ab0c8, roof: 0x3a4a6a, door: 0x2e3a52, inWall: 0xaebedb, floor: 0x6a5a48 },
  { id: 'rose', name: 'Rose', price: 100, wall: 0xe0b8c0, roof: 0xa84a62, door: 0x7a3548, inWall: 0xe8ccd2, floor: 0x8a6a58 },
  { id: 'midnight', name: 'Midnight', price: 150, wall: 0x3a3a4c, roof: 0x22222e, door: 0xe6b33f, inWall: 0x4a4a5e, floor: 0x32323e },
];

export function themeById(id: string): HouseTheme {
  return THEME_STORE.find((t) => t.id === id) ?? THEME_STORE[0]!;
}
