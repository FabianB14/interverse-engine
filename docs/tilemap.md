# Tilemaps, camera, movement (§4.6)

Maps are authored as readable ASCII rows + a legend, rendered by code-drawn
tile painters (no tileset images). See `games/room/src/map.ts` for a full
example.

```ts
import { tileMapFromRows, buildTileMapView, moveWithCollision, Camera } from '@interverse/engine';

const map = tileMapFromRows(rows, 64, {
  '#': { tile: TILE.WALL, solid: true },
  '.': { tile: TILE.FLOOR },
  '@': { tile: TILE.FLOOR, object: 'player' }, // spawn point
});
mapLayer.addChild(buildTileMapView(map, painters)); // cached as one texture

// Free movement with wall sliding (AABB center + half extents):
const moved = moveWithCollision(map, player.x, player.y, 22, 16, dx, dy);
player.position.set(moved.x, moved.y);

// Camera moves the map layer; UI lives in a separate fixed layer:
const camera = new Camera(mapLayer, W, H, { deadzoneWidth: 140, deadzoneHeight: 180 });
camera.setBounds(0, 0, map.width * 64, map.height * 64);
camera.follow(player);
camera.shake(10, 0.35); // juice
camera.update(dt); // call each onUpdate
```

- `map.objects` holds named spawn points/triggers from the legend.
- Tile painters get a per-tile deterministic `rng` for stable variation.
- Layer scenes as `stage -> [mapLayer, uiLayer]`; add world entities with
  `scene.add(e, mapLayer)` and UI with `scene.add(e, uiLayer)`.
- Tiled `.tmj` loading arrives when a Tiled-authored map exists; the data
  model is already Tiled-shaped (layers/collision/objects).
