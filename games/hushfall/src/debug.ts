/**
 * Debug hooks (window.__hushfall) — installed per scene so headless playtests
 * can drive the game without clicking through UI. Every field is optional; a
 * scene only wires the ones it owns.
 */
export interface HushfallDebug {
  scene: () => string;
  code: () => string | null;
  playerCount: () => number;
  host?: () => void;
  // lobby
  names?: () => string[];
  roles?: () => Record<string, string>;
  classes?: () => Record<string, string>;
  pick?: (cls: string) => void;
  volunteerSeeker?: () => void;
  randomSeeker?: () => void;
  myRole?: () => string;
  seekerId?: () => string | null;
  setAcc?: (i: number) => void;
  acc?: () => number;
  verium?: () => number;
  grantVerium?: (n: number) => number;
  buyAcc?: (i: number) => void;
  owned?: () => number[];
  ready?: () => Record<string, boolean>;
  setReady?: (r: boolean) => void;
  start?: () => void;
  inProgress?: () => boolean;
  joinNow?: () => void;
  setBots?: (n: number) => void;
  botCount?: () => number;
  botPos?: () => { x: number; y: number } | null;
  // match
  phase?: () => string;
  myPos?: () => { x: number; y: number };
  warp?: (x: number, y: number) => void;
  litCount?: () => number;
  lanternCount?: () => number;
  gateOpen?: () => boolean;
  attack?: () => void;
  ability?: () => void;
  downedCount?: () => number;
  escapedCount?: () => number;
  aliveCount?: () => number;
  amDowned?: () => boolean;
  seekerPos?: () => { x: number; y: number } | null;
  lanternPos?: (i: number) => { x: number; y: number } | null;
  gatePos?: () => { x: number; y: number } | null;
  spawnPos?: () => { x: number; y: number };
  forceLightAll?: () => void;
  revealSeen?: () => number;
  abilityUses?: () => number;
}

declare global {
  interface Window {
    __hushfall?: HushfallDebug;
  }
}
