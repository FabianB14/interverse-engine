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
}

declare global {
  interface Window {
    __farm?: FarmDebug;
  }
}
