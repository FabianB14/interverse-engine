/**
 * Blob Crashers — boot and the loop between screens.
 *
 * menu → map → fight → result → map … plus the co-op detour
 * menu → lobby → fight, which is the whole game's structure, so it lives in
 * one small file where it can be read at a glance rather than being spread
 * across the scenes that happen to trigger each hop.
 */

import { audio, createGame } from '@interverse/engine';
import { host } from '@interverse/net';
import type { Session } from '@interverse/net';
import { MenuScene } from './scenes/menu.js';
import { MapScene, ResultScene } from './scenes/map.js';
import { FightScene } from './scenes/fight.js';
import type { FightResult } from './scenes/fight.js';
import { JoinScene } from './scenes/join.js';
import { LobbyScene } from './scenes/lobby.js';
import type { Party } from './scenes/lobby.js';
import { GAME_TAG, resolveRelayUrl } from './config.js';
import { STAGES, stage } from './levels.js';
import { completeStage, loadRun, saveRun } from './save.js';
import type { CrashersDebug } from './debug.js';

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  const game = await createGame({
    width: 1280,
    height: 720,
    background: 0x1a1226,
    // Landscape-first: a brawler is a wide stage, and on a phone that means
    // the rotated screen is the real one.
    adaptive: true,
    scene: new MenuScene(
      () => toMap(),
      () => void toHost(),
      () => toJoin(),
    ),
  });
  audio.installUnlock();

  const toMenu = (): void => {
    game.scenes.replace(
      new MenuScene(
        () => toMap(),
        () => void toHost(),
        () => toJoin(),
      ),
    );
  };
  const toMap = (): void => {
    game.scenes.replace(new MapScene((n) => toFight(n), toMenu));
  };

  // ------------------------------------------------------------- co-op

  const toLobby = (session: Session): void => {
    game.scenes.replace(
      new LobbyScene(session, (n, party) => toFight(n, party), toMenu),
    );
  };
  const toHost = async (): Promise<void> => {
    const url = resolveRelayUrl();
    if (!url) return;
    try {
      const session = await host({ url, game: GAME_TAG, name: 'Host' });
      toLobby(session);
    } catch {
      // A relay that will not answer is not a reason to lose the game —
      // back to the menu, where SOLO still works.
      audio.buzz();
      toMenu();
    }
  };
  const toJoin = (): void => {
    game.scenes.replace(new JoinScene((session) => toLobby(session), toMenu, params.get('join') ?? ''));
  };

  // ------------------------------------------------------------- fights

  const toFight = (n: number, party: Party | null = null): void => {
    const def = stage(n);
    game.scenes.replace(
      new FightScene(
        def,
        (r: FightResult) => {
          // A losing run still banks what it earned — losing an hour to one
          // bad fight is how a fifteen-stage campaign loses a player.
          saveRun(completeStage(loadRun(), r.won ? n : 0, r.xp, r.coins));
          game.scenes.replace(
            new ResultScene(r.won, def.name, r.xp, r.coins, () => {
              // In co-op the room outlives the stage, so a finished fight
              // goes back to the lobby rather than dumping three friends
              // into three separate campaign maps.
              if (party) toLobby(party.session);
              else if (r.won) toMap();
              else toFight(n);
            }),
          );
        },
        party,
      ),
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
      if (s instanceof LobbyScene) return 'lobby';
      if (s instanceof JoinScene) return 'join';
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

    // ---------------------------------------------------------- co-op
    hostRoom: () => void toHost(),
    joinRoom: (code) => {
      const s = game.scenes.current;
      if (s instanceof JoinScene) s.debugType(code);
      else {
        toJoin();
        // The scene swap is synchronous, so the code can go in immediately.
        const next = game.scenes.current;
        if (next instanceof JoinScene) next.debugType(code);
      }
    },
    roomCode: () => {
      const s = game.scenes.current;
      return s instanceof LobbyScene ? s.debugCode() : '';
    },
    lobby: () => {
      const s = game.scenes.current;
      return s instanceof LobbyScene ? s.debugRoster() : [];
    },
    lobbyStart: () => {
      const s = game.scenes.current;
      if (s instanceof LobbyScene) s.debugStart();
    },
    party: () => {
      const s = game.scenes.current;
      return s instanceof FightScene ? s.debugParty() : [];
    },
    goDown: () => {
      const s = game.scenes.current;
      if (s instanceof FightScene) s.debugDown();
    },
  };
  window.__crashers = debug;

  // ?host=1 / ?join=CODE so a playtest never has to click through screens.
  if (params.get('host')) void toHost();
  else if (params.get('join')) toJoin();
}

void main();
