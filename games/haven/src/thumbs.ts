/**
 * 📸 Model thumbnails — the store shows a PICTURE of every .glb it sells.
 *
 * One tiny offscreen renderer (128px, preserveDrawingBuffer so toDataURL
 * works — the same trick rush3d's hat shop uses), one photo per model
 * URL, cached forever. loadModel's own cache means the store thumbnail
 * and the placed item share a single fetch.
 */

import {
  AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { loadModel } from '@interverse/three';

const SIZE = 128;
let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
const cache = new Map<string, Promise<string>>();

function rig(): { r: WebGLRenderer; s: Scene; c: PerspectiveCamera } {
  if (!renderer) {
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setSize(SIZE, SIZE);
    scene = new Scene();
    scene.background = new Color(0x1c2620);
    const key = new DirectionalLight(0xfff2e0, 2.4);
    key.position.set(1.5, 2.2, 2.5);
    scene.add(key, new AmbientLight(0xbcd0e0, 1.4));
    camera = new PerspectiveCamera(35, 1, 1, 4000);
  }
  return { r: renderer, s: scene!, c: camera! };
}

/** Photograph a model (framed 3/4 view, feet at the bottom). */
export function modelThumb(url: string, height: number): Promise<string> {
  let hit = cache.get(url);
  if (!hit) {
    hit = loadModel(url, { height, castShadow: false }).then((m) => {
      const { r, s, c } = rig();
      s.add(m);
      const d = height * 1.7;
      c.position.set(d * 0.75, height * 0.72, d);
      c.lookAt(0, height * 0.45, 0);
      r.render(s, c);
      const shot = r.domElement.toDataURL('image/png');
      s.remove(m);
      return shot;
    });
    cache.set(url, hit);
  }
  return hit;
}
