/**
 * 📦 Imported models — the door in the wall.
 *
 * The house style is code-built geometry, and it should stay the default:
 * it is the reason a whole game ships in ~130KB. But "better graphics"
 * sometimes means a mesh somebody sculpted, and this is where those come
 * in: glTF (.glb), the one format worth supporting, loaded from the game's
 * own public/ directory so models ship with the game, versioned in git,
 * and counted by the payload budget gate like everything else.
 *
 * What loadModel adds over raw GLTFLoader is NORMALIZATION — the fixes
 * every imported model needs and nobody remembers:
 *
 *   - Shadows on. A mesh that neither casts nor receives shadow floats.
 *   - Feet at y=0. Exported origins are wherever the artist left them;
 *     games position things by where they STAND.
 *   - Scale to a stated height. Units out of Blender are a lottery, so the
 *     game says how tall the thing is in world units and the fit is exact.
 *   - Cached by URL, cloned per call — load once, place many.
 */

import { Box3, Group, Vector3 } from 'three';
import type { AnimationClip, Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export interface LoadModelOptions {
  /** Scale the model so its bounding-box height equals this, in world
   *  units. Omit to keep the file's own scale. */
  height?: number;
  /** Meshes cast shadow. Default true — an unshadowed prop floats. */
  castShadow?: boolean;
  /** Meshes receive shadow. Default false; turn on for ground-like props. */
  receiveShadow?: boolean;
  /** Where the Draco decoder files live, for compressed models. Only
   *  needed if the .glb was exported with Draco compression. */
  dracoPath?: string;
}

/**
 * The pure part of the fit, split out so it is testable without a file:
 * given a bounding box, where does the model move and how much does it
 * scale so its feet sit at y=0 and it stands `height` tall?
 */
export function fitTransform(
  box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  height?: number,
): { scale: number; offsetY: number } {
  const h = box.max.y - box.min.y;
  const scale = height !== undefined && h > 0 ? height / h : 1;
  // Feet on the floor: after scaling, the box's min.y lands at 0. The || 0
  // launders the -0 that negating a zero min produces — cosmetic in maths,
  // a real failed equality for anyone comparing exactly.
  return { scale, offsetY: -box.min.y * scale || 0 };
}

/** A loaded model with everything the file carried. */
export interface LoadedModel {
  view: Group;
  /** The file's animation clips, shareable across clones — hand them to an
   *  AnimationMixer (Actor3 does this for you). */
  clips: AnimationClip[];
}

const cache = new Map<string, Promise<{ scene: Group; clips: AnimationClip[] }>>();

function loaderFor(dracoPath?: string): GLTFLoader {
  const loader = new GLTFLoader();
  if (dracoPath) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(dracoPath);
    loader.setDRACOLoader(draco);
  }
  return loader;
}

/**
 * Load a .glb/.gltf and return a normalized, placeable Group.
 *
 * Repeat calls for the same URL share one fetch and one parse; every call
 * gets its own clone, so placing twenty of something costs one load. The
 * clone shares geometry and materials with its siblings — mutate a
 * material and you restyle every copy, which is the same lever the zone
 * tints use and is usually what you want.
 */
export async function loadModel(url: string, opts: LoadModelOptions = {}): Promise<Group> {
  return (await loadModelWithClips(url, opts)).view;
}

/**
 * Like loadModel, but the animations come too. Clones use SkeletonUtils so
 * a skinned character's bones stay bound to ITS copy of the skeleton —
 * Object3D.clone alone leaves every clone dancing to the original's bones.
 */
export async function loadModelWithClips(
  url: string,
  opts: LoadModelOptions = {},
): Promise<LoadedModel> {
  const { height, castShadow = true, receiveShadow = false, dracoPath } = opts;
  let pending = cache.get(url);
  if (!pending) {
    pending = loaderFor(dracoPath)
      .loadAsync(url)
      .then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
    cache.set(url, pending);
  }
  const source = await pending;
  const model = cloneSkeleton(source.scene) as Group;

  const box = new Box3().setFromObject(model);
  const fit = fitTransform(box, height);
  const wrapper = new Group();
  model.scale.multiplyScalar(fit.scale);
  model.position.y += fit.offsetY;
  // Center laterally too: a model whose origin was off in a corner places
  // like one authored at its own middle.
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x * fit.scale;
  model.position.z -= center.z * fit.scale;
  wrapper.add(model);

  wrapper.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
    }
  });
  return { view: wrapper, clips: source.clips };
}

/** Drop the cache — for tests, or a dev-tools "reload assets". */
export function clearModelCache(): void {
  cache.clear();
}
