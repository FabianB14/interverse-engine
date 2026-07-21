import { Graphics } from 'pixi.js';

export interface PanelStyle {
  fill?: number;
  fillAlpha?: number;
  stroke?: number;
  strokeAlpha?: number;
  strokeWidth?: number;
  radius?: number;
}

/** Draw a themed rounded panel into a Graphics (top-left at 0,0). */
export function drawPanel(
  g: Graphics,
  width: number,
  height: number,
  style: PanelStyle = {},
): Graphics {
  const {
    fill = 0x241a3f,
    fillAlpha = 0.94,
    stroke = 0xffffff,
    strokeAlpha = 0.25,
    strokeWidth = 3,
    radius = 24,
  } = style;
  g.roundRect(0, 0, width, height, radius).fill({ color: fill, alpha: fillAlpha });
  if (strokeWidth > 0) {
    g.roundRect(0, 0, width, height, radius).stroke({
      color: stroke,
      alpha: strokeAlpha,
      width: strokeWidth,
    });
  }
  return g;
}
