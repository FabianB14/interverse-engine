import { createGame } from '@interverse/engine';
import { MenuScene } from './scenes/MenuScene.js';
import { NIGHT, unlockSpookAudio } from './theme.js';

// Design (virtual) resolution — portrait; adaptive so the graveyard fills any
// screen (the camera pans the larger world).
const DESIGN_W = 720;
const DESIGN_H = 1280;

async function main(): Promise<void> {
  await createGame({
    width: DESIGN_W,
    height: DESIGN_H,
    background: NIGHT.bg,
    adaptive: true,
    scene: new MenuScene(),
  });
  // Spooky ambience needs a user gesture to start (browser autoplay policy).
  unlockSpookAudio();
}

void main();
