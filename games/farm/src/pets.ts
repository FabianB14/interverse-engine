import { Container, Graphics } from 'pixi.js';
import { darken, verium } from '@interverse/engine';
import { store } from './store.js';

/**
 * Farm pets — little AI companions sold in the shop. Each is code-drawn and
 * trots along behind you on the farm (simple follow steering + bob).
 */
export interface PetDef {
  id: string;
  name: string;
  emoji: string;
  price: number;
  draw: (r: number) => Container;
}

function chick(r: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.ellipse(0, r * 0.5, r * 0.55, r * 0.2).fill({ color: 0x000000, alpha: 0.15 });
  g.circle(0, 0, r * 0.55).fill(0xffd166);
  g.circle(0, -r * 0.55, r * 0.4).fill(0xffe08a);
  g.circle(-r * 0.14, -r * 0.62, r * 0.06).fill(0x2b2b33);
  g.circle(r * 0.14, -r * 0.62, r * 0.06).fill(0x2b2b33);
  g.poly([0, -r * 0.5, -r * 0.12, -r * 0.4, r * 0.12, -r * 0.4]).fill(0xe07a5f);
  return (c.addChild(g), c);
}

function cat(r: number): Container {
  const c = new Container();
  const fur = 0x8d8d99;
  const g = new Graphics();
  g.ellipse(0, r * 0.55, r * 0.6, r * 0.2).fill({ color: 0x000000, alpha: 0.15 });
  g.ellipse(0, r * 0.1, r * 0.55, r * 0.45).fill(fur);
  g.circle(0, -r * 0.45, r * 0.38).fill(fur);
  g.poly([-r * 0.3, -r * 0.65, -r * 0.42, -r * 0.95, -r * 0.12, -r * 0.75]).fill(fur);
  g.poly([r * 0.3, -r * 0.65, r * 0.42, -r * 0.95, r * 0.12, -r * 0.75]).fill(fur);
  g.circle(-r * 0.14, -r * 0.48, r * 0.05).fill(0x2b2b33);
  g.circle(r * 0.14, -r * 0.48, r * 0.05).fill(0x2b2b33);
  g.moveTo(r * 0.5, r * 0.2)
    .quadraticCurveTo(r * 0.9, r * 0.1, r * 0.85, -r * 0.3)
    .stroke({ color: darken(fur, 0.1), width: Math.max(3, r * 0.14), cap: 'round' });
  return (c.addChild(g), c);
}

function pup(r: number): Container {
  const c = new Container();
  const fur = 0xb98a4b;
  const g = new Graphics();
  g.ellipse(0, r * 0.55, r * 0.6, r * 0.2).fill({ color: 0x000000, alpha: 0.15 });
  g.ellipse(0, r * 0.12, r * 0.58, r * 0.45).fill(fur);
  g.circle(0, -r * 0.42, r * 0.4).fill(fur);
  g.ellipse(-r * 0.38, -r * 0.5, r * 0.14, r * 0.3).fill(darken(fur, 0.2));
  g.ellipse(r * 0.38, -r * 0.5, r * 0.14, r * 0.3).fill(darken(fur, 0.2));
  g.circle(-r * 0.14, -r * 0.46, r * 0.055).fill(0x2b2b33);
  g.circle(r * 0.14, -r * 0.46, r * 0.055).fill(0x2b2b33);
  g.circle(0, -r * 0.3, r * 0.09).fill(0x2b2b33);
  return (c.addChild(g), c);
}

function bunny(r: number): Container {
  const c = new Container();
  const fur = 0xf2f2ee;
  const g = new Graphics();
  g.ellipse(0, r * 0.55, r * 0.55, r * 0.18).fill({ color: 0x000000, alpha: 0.15 });
  g.ellipse(0, r * 0.15, r * 0.5, r * 0.42).fill(fur);
  g.circle(0, -r * 0.4, r * 0.35).fill(fur);
  g.ellipse(-r * 0.18, -r * 0.85, r * 0.11, r * 0.35).fill(fur);
  g.ellipse(r * 0.18, -r * 0.85, r * 0.11, r * 0.35).fill(fur);
  g.ellipse(-r * 0.18, -r * 0.85, r * 0.05, r * 0.22).fill(0xff9fb2);
  g.ellipse(r * 0.18, -r * 0.85, r * 0.05, r * 0.22).fill(0xff9fb2);
  g.circle(-r * 0.12, -r * 0.44, r * 0.05).fill(0x2b2b33);
  g.circle(r * 0.12, -r * 0.44, r * 0.05).fill(0x2b2b33);
  return (c.addChild(g), c);
}

export const PETS: readonly PetDef[] = [
  { id: 'chick', name: 'Chick', emoji: '🐤', price: 150, draw: chick },
  { id: 'bunny', name: 'Bunny', emoji: '🐰', price: 200, draw: bunny },
  { id: 'cat', name: 'Cat', emoji: '🐱', price: 250, draw: cat },
  { id: 'pup', name: 'Puppy', emoji: '🐶', price: 250, draw: pup },
];

export function petById(id: string): PetDef | undefined {
  return PETS.find((p) => p.id === id);
}

const OWNED_KEY = 'ownedPets';

export function isPetOwned(id: string): boolean {
  return store.get<string[]>(OWNED_KEY, []).includes(id);
}

export function buyPet(id: string): boolean {
  const def = petById(id);
  if (!def || isPetOwned(id)) return false;
  if (!verium.spend(def.price)) return false;
  const owned = store.get<string[]>(OWNED_KEY, []);
  owned.push(id);
  store.set(OWNED_KEY, owned);
  store.set('pet', id);
  return true;
}

/** The active companion's id, or '' for none. */
export function activePet(): string {
  const id = store.get<string>('pet', '');
  return isPetOwned(id) ? id : '';
}

export function setActivePet(id: string): void {
  store.set('pet', id && isPetOwned(id) ? id : '');
}
