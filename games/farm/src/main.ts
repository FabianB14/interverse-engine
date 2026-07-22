import { createGame } from '@interverse/engine';
import { FARM } from './theme.js';
import { TitleScene } from './scenes/TitleScene.js';

// Portrait design space, letterboxed/adaptive to any phone.
const DESIGN_W = 720;
const DESIGN_H = 1280;

async function main(): Promise<void> {
  await createGame({
    width: DESIGN_W,
    height: DESIGN_H,
    background: FARM.bg,
    adaptive: true,
    scene: new TitleScene(),
  });
}

void main();
