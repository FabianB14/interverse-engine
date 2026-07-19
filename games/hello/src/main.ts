import { Container, Graphics, Text } from 'pixi.js';
import { createGame, drawBlob } from '@interverse/engine';

// Design (virtual) resolution — portrait, per spec §4.1.
const DESIGN_W = 720;
const DESIGN_H = 1280;
const RADIUS = 96;

async function main(): Promise<void> {
  // --- Blob visual: a code-drawn vector blob with a soft drop shadow. ---
  const blob = new Container();

  const shadow = new Graphics();
  drawBlob(shadow, { radius: RADIUS, seed: 7, color: 0x000000 });
  shadow.alpha = 0.18;
  shadow.position.set(0, 14);

  const body = new Graphics();
  drawBlob(body, {
    radius: RADIUS,
    seed: 7,
    wobble: 0.16,
    color: 0xff6f91,
    stroke: 0xffffff,
    strokeWidth: 6,
  });

  // A little face so it reads as a character, not just a shape (juice).
  const eyeL = new Graphics().circle(-30, -18, 12).fill(0x2b2b3a);
  const eyeR = new Graphics().circle(30, -18, 12).fill(0x2b2b3a);
  const cheekL = new Graphics().circle(-42, 14, 12).fill({ color: 0xff3d6e, alpha: 0.5 });
  const cheekR = new Graphics().circle(42, 14, 12).fill({ color: 0xff3d6e, alpha: 0.5 });

  blob.addChild(shadow, body, cheekL, cheekR, eyeL, eyeR);

  // --- Physics state (design-space). ---
  let x = DESIGN_W / 2;
  let y = DESIGN_H / 2;
  let px = x;
  let py = y;
  let vx = 320; // units/sec
  let vy = 420;

  // Squash-and-stretch state, eased back toward 1 each frame.
  let sx = 1;
  let sy = 1;
  let wobblePhase = 0;

  const step = (dt: number): void => {
    px = x;
    py = y;
    x += vx * dt;
    y += vy * dt;

    const minX = RADIUS;
    const maxX = DESIGN_W - RADIUS;
    const minY = RADIUS;
    const maxY = DESIGN_H - RADIUS;

    if (x < minX) {
      x = minX;
      vx = Math.abs(vx);
      sx = 0.7;
      sy = 1.3; // squash horizontally on a side wall
    } else if (x > maxX) {
      x = maxX;
      vx = -Math.abs(vx);
      sx = 0.7;
      sy = 1.3;
    }
    if (y < minY) {
      y = minY;
      vy = Math.abs(vy);
      sx = 1.3;
      sy = 0.7; // squash vertically on top/bottom
    } else if (y > maxY) {
      y = maxY;
      vy = -Math.abs(vy);
      sx = 1.3;
      sy = 0.7;
    }

    // Ease squash back to rest.
    sx += (1 - sx) * Math.min(1, dt * 10);
    sy += (1 - sy) * Math.min(1, dt * 10);

    // Idle breathing wobble.
    wobblePhase += dt * 3;
  };

  const draw = (alpha: number): void => {
    // Interpolate render position between the last two fixed steps.
    const rx = px + (x - px) * alpha;
    const ry = py + (y - py) * alpha;
    blob.position.set(rx, ry);

    const breath = 1 + Math.sin(wobblePhase) * 0.02;
    blob.scale.set(sx * breath, sy * breath);
    // Squashed shadow tracks the vertical scale so contact reads correctly.
    shadow.scale.set(1 / (sx || 1), 0.85 / (sy || 1));
  };

  const game = await createGame({
    width: DESIGN_W,
    height: DESIGN_H,
    background: 0x101018,
    update: step,
    render: draw,
  });

  game.world.addChild(blob);

  // --- FPS readout so 60fps can be verified on the phone (the "done" gate). ---
  const fps = new Text({
    text: 'FPS —',
    style: { fill: 0x8affc1, fontFamily: 'monospace', fontSize: 28, fontWeight: 'bold' },
  });
  fps.position.set(16, 16);
  game.world.addChild(fps);

  let acc = 0;
  let smoothed = 60;
  game.app.ticker.add(() => {
    smoothed += (game.app.ticker.FPS - smoothed) * 0.1;
    acc += game.app.ticker.deltaMS;
    if (acc >= 250) {
      acc = 0;
      fps.text = `FPS ${Math.round(smoothed)}`;
    }
  });
}

void main();
