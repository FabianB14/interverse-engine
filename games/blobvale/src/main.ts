import { createGame, partyPop } from '@interverse/engine';
import { MenuScene } from './scenes/MenuScene.js';

// Design (virtual) resolution — portrait, per spec §4.1.
const DESIGN_W = 720;
const DESIGN_H = 1280;

async function main(): Promise<void> {
  await createGame({
    width: DESIGN_W,
    height: DESIGN_H,
    background: partyPop.bg,
    adaptive: true,
    scene: new MenuScene(),
  });
}

void main();
