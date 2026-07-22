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
  // Customization
  acc?: () => string;
  setAcc?: (id: string) => void;
  skin?: () => number;
  setSkin?: (c: number) => void;
  name?: () => string;
  editName?: () => void;
  setName?: (n: string) => void;
  saveName?: () => void;
  // Navigation / feedback
  home?: () => void;
  tip?: () => string;
  storm?: () => boolean;
  openInv?: () => void;
  invOpen?: () => boolean;
  // Friends / visit / trade (multiplayer)
  friends?: (() => void) | (() => string[]);
  openFarm?: () => void;
  visitByCode?: (c: string) => void;
  setCode?: (c: string) => void;
  visit?: () => void;
  code?: () => string;
  remoteIds?: () => string[];
  startTrade?: () => void;
  offerItem?: (id: string) => void;
  confirmTrade?: () => void;
  tradeOpen?: () => boolean;
  isVisiting?: () => boolean;
  addFriendCode?: (name: string, code: string) => boolean;
  // Building / pets / themes
  buildStart?: (id: string) => void;
  placeAt?: (col: number, row: number) => boolean;
  buildCount?: () => number;
  placingId?: () => string | null;
  cancelBuild?: () => void;
  removeAt?: (col: number, row: number) => boolean;
  plotScreen?: (i: number) => { x: number; y: number } | null;
  petActive?: () => string;
  buyPet?: (id: string) => boolean;
  buyTheme?: (id: string) => boolean;
  themeActive?: () => string;
  // Shop
  toShop?: () => void;
  tab?: () => string;
  setTab?: (t: string) => void;
  buyUpgrade?: (id: string) => boolean;
  upLevel?: (id: string) => number;
  buyCosmetic?: (id: string) => boolean;
  owned?: (id: string) => boolean;
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
