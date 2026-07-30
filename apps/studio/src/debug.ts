/** Headless-test hooks (window.__studio) — the playtest drives the editor
 *  through these instead of clicking DOM. */
import type { EntityKind } from './model.js';

export interface StudioDebug {
  ready: () => boolean;
  addEntity: (kind: EntityKind, x: number, y: number) => string;
  entityCount: () => number;
  select: (name: string) => boolean;
  setProp: (key: string, value: unknown) => boolean;
  getEntity: (name: string) => Record<string, unknown> | null;
  play: () => void;
  stop: () => void;
  playing: () => boolean;
  playEntityCount: () => number;
  setScript: (code: string) => void;
  applyScriptNow: (code: string) => void;
  addScene: (name: string) => string;
  sceneCount: () => number;
  switchSceneByName: (name: string) => boolean;
  sceneName: () => string;
  exportJson: () => string;
  importJson: (json: string) => void;
  projectName: () => string;
  setStory: (lines: string[]) => boolean;
  templateCount: () => number;
  loadTemplate: (id: string) => boolean;
  playScore: () => number;
  playVisibleCount: () => number;
  gameIsOver: () => boolean;
  skillNodeCount: () => number;
  skillPoints: () => number;
  skillAddPoints: (n: number) => void;
  skillUnlock: (id: string) => boolean;
  skillUnlocked: () => string[];
  setMultiplayer: (b: boolean) => void;
  netHost: () => Promise<string>;
  netJoin: (code: string) => Promise<void>;
  netCode: () => string | null;
  netIsHost: () => boolean;
  netPlayerCount: () => number;
  netRemoteCount: () => number;
  netRemotePos: () => { x: number; y: number } | null;
  netSetState: (k: string, v: unknown) => void;
  netGetState: (k: string) => unknown;
  setTile: (c: number, r: number, ch: string) => void;
  tileAt: (c: number, r: number) => string;
  setTileMode: (ch: string | null) => void;
  playHasTiles: () => boolean;
  setView: (v: 'top' | 'depth') => void;
  setGravity: (g: boolean) => void;
  setWorldSize: (w: number, h: number) => void;
  worldSize: () => { w: number; h: number };
  cameraX: () => number;
  setFramePreview: (m: 'off' | 'landscape' | 'portrait') => void;
  framePreview: () => 'off' | 'landscape' | 'portrait';
  mobCount: () => number;
  mobHp: (name: string) => number;
  heartsNow: () => number;
  xpNow: () => number;
  levelNow: () => number;
  abilityCount: () => number;
  fireAbility: (name: string) => boolean;
  bossBarVisible: () => boolean;
  playerZ: () => number;
  shotsFired: () => number;
  mobEnraged: (name: string) => boolean;
  chatBridged: () => boolean;
  coinsNow: () => number;
  setEvents: (name: string, events: unknown) => boolean;
  switchIsOn: (name: string) => boolean;
  librarySave: () => string;
  libraryList: () => { id: string; name: string; updated: number }[];
  libraryOpen: (id: string) => boolean;
  libraryDelete: (id: string) => void;
}

declare global {
  interface Window {
    __studio?: StudioDebug;
  }
}
