import { CROPS, cropById } from './crops.js';
import { store } from './store.js';

/** A market customer's request: bring `qty` of `crop` for `reward` Verium. */
export interface Order {
  crop: string;
  qty: number;
  reward: number;
  who: string;
}

export const MAX_ORDERS = 3;

const CUSTOMERS = ['🧑‍🌾', '👩‍🌾', '🧓', '👵', '🧔', '👧', '🧒', '👨‍🍳', '👩‍🍳', '🧑'];

/** Orders pay a premium over base sell price — filling them beats quick-selling. */
export function generateOrder(): Order {
  // Favor cheaper, common crops; occasionally a premium request for a big payout.
  const pool = Math.random() < 0.72 ? CROPS.slice(0, 6) : CROPS;
  const crop = pool[Math.floor(Math.random() * pool.length)] ?? CROPS[0]!;
  const qty = 2 + Math.floor(Math.random() * 5); // 2..6
  const bonus = 1.4 + Math.random() * 0.6; // 1.4x .. 2.0x
  const reward = Math.round(crop.sellPrice * qty * bonus);
  const who = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)] ?? '🧑‍🌾';
  return { crop: crop.id, qty, reward, who };
}

export function loadOrders(): Order[] {
  const raw = store.get<Order[]>('orders', []);
  // Drop any that reference a crop that no longer exists.
  return raw.filter((o) => cropById(o.crop));
}

export function saveOrders(orders: Order[]): void {
  store.set('orders', orders);
}

/** Fill the board back up to MAX_ORDERS with fresh requests. */
export function topUpOrders(orders: Order[]): Order[] {
  const next = [...orders];
  while (next.length < MAX_ORDERS) next.push(generateOrder());
  return next;
}
