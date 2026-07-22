/** Debug hook shared by scenes (drives headless playtests). */
export interface FarmDebug {
  scene: () => string;
  verium?: () => number;
  grantVerium?: (n: number) => number;
  selectSeed?: (id: string) => void;
  plant?: (i: number, cropId?: string) => boolean;
  water?: (i: number) => void;
  waterAll?: () => void;
  harvest?: (i: number) => boolean;
  growAll?: () => void;
  plotInfo?: () => Array<{ c: string | null; g: number; m: number }>;
  harvested?: () => number;
  weather?: () => string;
  season?: () => string;
  setClock?: (t: number) => void;
  rainNow?: () => void;
  musicOn?: () => boolean;
  toggleMusic?: () => boolean;
  play?: () => void;
  // Market
  inv?: () => Record<string, number>;
  giveItem?: (id: string, n: number) => void;
  clearInv?: () => void;
  toMarket?: () => void;
  toFarm?: () => void;
  orders?: () => Array<{ crop: string; qty: number; reward: number }>;
  fulfill?: (i: number) => boolean;
  quickSell?: (id: string) => number;
  // Walkable world
  player?: () => { x: number; y: number };
  teleport?: (x: number, y: number) => void;
  talkVendor?: () => void;
  dialogueOpen?: () => boolean;
  setChar?: (type: string, color: number) => void;
  charType?: () => string;
  giftReadyMs?: () => number;
  claimGift?: () => void;
  buyBundle?: () => boolean;
}

declare global {
  interface Window {
    __farm?: FarmDebug;
  }
}
