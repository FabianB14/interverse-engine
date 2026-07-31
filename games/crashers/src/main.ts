/**
 * Blob Crashers — boot and the loop between screens.
 *
 * menu → map → fight → result → map … which is the whole game's structure,
 * so it lives in one small file where it can be read at a glance rather than
 * being spread across the scenes that happen to trigger each hop.
 */

import { audio, createGame } from '@interverse/engine';
import { MenuScene } from './scenes/menu.js';
import { MapScene, ResultScene } from './scenes/map.js';
import { FightScene } from './scenes/fight.js';
import type { FightResult } from './scenes/fight.js';
import { STAGES, stage } from './levels.js';
import { completeStage, loadRun, saveRun } from './save.js';
import type { CrashersDebug } from './debug.js';

async function main(): Promise<void> {
  const game = await createGame({
    width: 1280,
    height: 720,
    background: 0x1a1226,
    // Landscape-first: a brawler is a wide stage, and on a phone that means
    // the rotated screen is the real one.
    adaptive: true,
    scene: new MenuScene(() => toMap()),
  });
  audio.installUnlock();

  const toMenu = (): void => {
    game.scenes.replace(new MenuScene(() => toMap()));
  };
  const toMap = (): void => {
    game.scenes.replace(new MapScene((n) => toFight(n), toMenu));
  };
  const toFight = (n: number): void => {
    const def = stage(n);
    game.scenes.replace(
      new FightScene(def, (r: FightResult) => {
        // A losing run still banks what it earned — losing an hour to one
        // bad fight is how a fifteen-stage campaign loses a player.
        saveRun(completeStage(loadRun(), r.won ? n : 0, r.xp, r.coins));
        game.scenes.replace(
          new ResultScene(r.won, def.name, r.xp, r.coins, () => (r.won ? toMap() : toFight(n))),
        );
      }),
    );
  };

  // Headless playtest hooks. Same shape as the other games: drive the game
  // through here rather than clicking through screens.
  const debug: CrashersDebug = {
    ready: () => true,
    screen: () => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) return 'menu';
      if (s instanceof MapScene) return 'map';
      if (s instanceof FightScene) return 'fight';
      if (s instanceof ResultScene) return 'result';
      return 'boot';
    },
    stageCount: () => STAGES.length,
    pickClass: (i) => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) s.debugPick(i);
    },
    pickedClass: () => {
      const s = game.scenes.current;
      return s instanceof MenuScene ? s.debugPicked() : loadRun().classId;
    },
    start: () => {
      const s = game.scenes.current;
      if (s instanceof MenuScene) s.debugStart();
    },
    unlocked: () => {
      const s = game.scenes.current;
      return s instanceof MapScene ? s.debugUnlocked() : [];
    },
    play: (n) => {
      const s = game.scenes.current;
      if (s instanceof MapScene) s.debugPlay(n);
      else toFight(n);
    },
    fight: () => {
      const s = game.scenes.current;
      return s instanceof FightScene ? s.debugState() : null;
    },
    move: (x, y) => {
      const s = game.scenes.current;
      if (s instanceof FightScene) s.debugMove(x, y);
    },
    swing: () => {
      const s = game.scenes.current;
      if (s instanceof FightScene) s.debugSwing();
    },
    clearWave: () => {
      const s = game.scenes.current;
      if (s instanceof FightScene) s.debugClear();
    },
    next: () => {
      const s = game.scenes.current;
      if (s instanceof ResultScene) s.debugNext();
    },
    run: () => loadRun(),
    setRun: (patch) => saveRun({ ...loadRun(), ...patch }),
  };
  window.__crashers = debug;
}

void main();
