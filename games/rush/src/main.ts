/**
 * Blob Rush — boot and the loop between screens.
 *
 * menu → run → result → run … The result screen goes straight back into a
 * run rather than via the menu, because a run lasts about a minute and every
 * screen between two of them is friction paid over and over.
 */

import { audio, createGame } from '@interverse/engine';
import { MenuScene } from './scenes/menu.js';
import { RunScene } from './scenes/run.js';
import type { RunResult } from './scenes/run.js';
import { ResultScene } from './scenes/result.js';
import { HATS } from './hats.js';
import { bankRun, loadProfile, saveProfile } from './save.js';
import type { RushDebug } from './debug.js';

async function main(): Promise<void> {
  const game = await createGame({
    width: 1280,
    height: 720,
    background: 0x120e22,
    // Landscape-first: a road that goes away from you needs width, and on a
    // phone that means the rotated screen is the real one.
    adaptive: true,
    scene: new MenuScene(() => toRun()),
  });
  audio.installUnlock();

  const toMenu = (): void => {
    game.scenes.replace(new MenuScene(() => toRun()));
  };
  const toRun = (): void => {
    game.scenes.replace(new RunScene((r: RunResult) => toResult(r)));
  };
  const toResult = (r: RunResult): void => {
    const { profile, best } = bankRun(loadProfile(), r.metres, r.coins);
    saveProfile(profile);
    game.scenes.replace(new ResultScene(r, best, profile.coins, () => toRun(), toMenu));
  };

  // Headless playtest hooks. Same shape as the other games: drive the game
  // through here rather than swiping at a canvas.
  const debug: RushDebug = {
    ready: () => true,
    screen: () => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) return 'menu';
      if (s instanceof RunScene) return 'run';
      if (s instanceof ResultScene) return 'result';
      return 'boot';
    },
    profile: () => loadProfile(),
    setProfile: (patch) => saveProfile({ ...loadProfile(), ...patch }),

    hats: () => {
      const owned = loadProfile().owned;
      return HATS.map((h) => ({ id: h.id, price: h.price, owned: owned.includes(h.id) }));
    },
    pickHat: (id) => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) s.debugPickHat(id);
    },
    buy: () => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) s.debugBuy();
    },
    picked: () => {
      const s = game.scenes.current;
      return s instanceof MenuScene ? s.debugPicked() : loadProfile().wearing;
    },
    play: () => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) s.debugPlay();
      else toRun();
    },

    run: () => {
      const s = game.scenes.current;
      return s instanceof RunScene ? s.debugState() : null;
    },
    swipe: (dir) => {
      const s = game.scenes.current;
      if (s instanceof RunScene) s.debugSwipe(dir);
    },
    corner: () => {
      const s = game.scenes.current;
      return s instanceof RunScene ? s.debugCorner() : 0;
    },
    hat: () => {
      const s = game.scenes.current;
      return s instanceof RunScene ? s.debugHat() : null;
    },

    again: () => {
      const s = game.scenes.current;
      if (s instanceof ResultScene) s.debugAgain();
    },
    menu: () => {
      const s = game.scenes.current;
      if (s instanceof ResultScene) s.debugMenu();
      else toMenu();
    },
  };
  window.__rush = debug;

  // ?run=1 drops straight into a run, so a playtest never has to sit through
  // the title screen.
  if (new URLSearchParams(window.location.search).get('run')) toRun();
}

void main();
