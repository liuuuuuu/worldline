/**
 * The desk and the lighting rig.
 *
 * The target look (see `docs/VISUAL.md`) is a still-life photograph of an object
 * on a desk — not a game scene. That means: one warm key light with a real
 * shadow, a low ambient fill, and restraint everywhere else. The shadow is not
 * decoration; it is the main evidence that the globe is a physical thing rather
 * than a rendered sphere.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface DeskOptions {
  /** World Y of the desk surface. */
  y: number;
  /** Side length of the desk plane. */
  size: number;
  texture: THREE.Texture;
  /** How many times the wood texture tiles across `size`. */
  repeat?: number;
}

export function createDesk(options: DeskOptions): THREE.Mesh {
  const { y, size, texture, repeat = 6 } = options;

  const resolved = texture.clone();
  resolved.needsUpdate = true;
  resolved.wrapS = THREE.RepeatWrapping;
  resolved.wrapT = THREE.RepeatWrapping;
  resolved.repeat.set(repeat, repeat);

  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshStandardMaterial({
    map: resolved,
    roughness: 0.78,
    metalness: 0.02,
  });

  const desk = new THREE.Mesh(geometry, material);
  desk.name = 'desk';
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = y;
  desk.receiveShadow = true;
  return desk;
}

export interface LightingRig {
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  dispose(): void;
}

/**
 * One key light, one hemisphere fill. Deliberately no second directional light:
 * a second source flattens the form and reads as "3D render".
 *
 * Shadow camera bounds are derived from the globe radius so the shadow map's
 * texel density does not silently degrade when the scene is rescaled.
 */
export function createLighting(radius: number, shadowMapSize = 2048): LightingRig {
  const key = new THREE.DirectionalLight(0xffd9a0, 2.15);
  key.name = 'key-light';
  key.position.set(radius * 2.4, radius * 3.4, radius * 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = radius * 0.02;

  const extent = radius * 2.4;
  const camera = key.shadow.camera;
  camera.left = -extent;
  camera.right = extent;
  camera.top = extent;
  camera.bottom = -extent;
  camera.near = radius * 0.5;
  camera.far = radius * 9;
  camera.updateProjectionMatrix();

  // Raised from the first pass: with a single strong key the pedestal and the
  // far side of the desk fell to near-black, which read as a floating ball
  // rather than an object on a surface.
  const fill = new THREE.HemisphereLight(0xffe6c4, 0x3a2c20, 0.62);
  fill.name = 'fill-light';

  return {
    key,
    fill,
    dispose() {
      key.shadow.dispose();
    },
  };
}

/**
 * Pre-filtered environment map.
 *
 * Brass with `metalness: 1` is almost entirely reflective, so without an
 * environment it renders near-black no matter how many lights you add. A
 * `RoomEnvironment` gives it something believable to reflect.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const texture = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  return texture;
}
