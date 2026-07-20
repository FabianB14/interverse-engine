import { Text } from 'pixi.js';
import { createGame, partyPop } from '@interverse/engine';
import { TitleScene } from './scenes/TitleScene.js';

// Design (virtual) resolution — portrait, per spec §4.1.
const DESIGN_W = 720;
const DESIGN_H = 1280;

async function main(): Promise<void> {
  const game = await createGame({
    width: DESIGN_W,
    height: DESIGN_H,
    background: partyPop.bg,
    scene: new TitleScene(),
  });

  // Small FPS readout (screen-space, top-left) — the 60fps budget gate.
  const fps = new Text({
    text: 'FPS —',
    style: { fill: 0x8affc1, fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold' },
  });
  fps.position.set(8, 8);
  fps.alpha = 0.7;
  game.app.stage.addChild(fps);

  let acc = 0;
  let smoothed = 60;
  game.app.ticker.add(() => {
    // Clamp: ticker.FPS spikes to absurd values during the first frames.
    smoothed += (Math.min(game.app.ticker.FPS, 120) - smoothed) * 0.1;
    acc += game.app.ticker.deltaMS;
    if (acc >= 250) {
      acc = 0;
      fps.text = `FPS ${Math.round(smoothed)}`;
    }
  });
}

void main();
