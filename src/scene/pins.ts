/**
 * Station pins on the globe.
 *
 * Two problems this module exists to solve, beyond "draw dots":
 *
 * **1. Scale.** The directory gives ~1000 geolocated stations today and the
 * design targets 3000. One `InstancedMesh` keeps that to a single draw call;
 * 3000 individual meshes would be 3000 draw calls.
 *
 * **2. Hit accuracy.** A pin is a few pixels wide, so raycasting alone makes the
 * user click exactly on it — which the exit criterion ("click accuracy 100%")
 * would technically pass and which is miserable to use. So picking is
 * screen-space: the nearest *visible* pin within a tolerance wins. That also
 * fixes the far-side problem, where a pin hidden behind the globe would
 * otherwise be picked through it.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isFacingCamera, latLngToVector3, outwardQuaternion } from './geo/sphere';
import type { Station } from '../types/domain';

/** Pin proportions, as multiples of the globe radius. */
const PIN_HEIGHT = 0.055;
const PIN_SHAFT_RADIUS = 0.0045;
const PIN_HEAD_RADIUS = 0.013;
/** How much the hover highlight is scaled up. */
const HIGHLIGHT_SCALE = 2.2;
/** Default screen-space pick tolerance, in CSS pixels. */
export const DEFAULT_PICK_TOLERANCE = 18;

export interface PinFieldOptions {
  radius: number;
  /** Cap on rendered pins, taken in the order given. */
  limit?: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PinField {
  /** Add to the *spinning* group so pins rotate with the globe. */
  readonly object: THREE.Object3D;
  readonly mesh: THREE.InstancedMesh;
  /** Stations that actually got a pin, in instance order. */
  readonly stations: readonly Station[];
  readonly count: number;
  /** Stations dropped because they had no coordinates. */
  readonly skipped: number;
  /** Show the hover ring on an instance, or hide it with `null`. */
  setHighlight(index: number | null): void;
  /** Direct ray hit against the pin geometry. */
  raycast(raycaster: THREE.Raycaster): number | null;
  /** Nearest visible pin to a screen point, or `null` when nothing is close. */
  nearestToScreen(
    x: number,
    y: number,
    camera: THREE.Camera,
    viewport: Viewport,
    tolerance?: number,
  ): number | null;
  /** Where a pin currently is on screen, or `null` when it faces away. */
  screenPositionOf(
    index: number,
    camera: THREE.Camera,
    viewport: Viewport,
  ): { x: number; y: number } | null;
  dispose(): void;
}

/**
 * A pin: a short shaft pointing away from the surface with a ball head.
 *
 * Built once and reused by every instance. Segment counts are deliberately low —
 * at the size a pin occupies on screen, more segments are invisible and cost
 * real time across 3000 instances.
 */
export function createPinGeometry(radius: number): THREE.BufferGeometry {
  const shaftHeight = radius * PIN_HEIGHT;

  const shaft = new THREE.CylinderGeometry(
    radius * PIN_SHAFT_RADIUS,
    radius * PIN_SHAFT_RADIUS,
    shaftHeight,
    6,
    1,
    true,
  );
  // Cylinders are centred on the origin; move it so the pin grows outwards.
  shaft.translate(0, shaftHeight / 2, 0);

  const head = new THREE.SphereGeometry(radius * PIN_HEAD_RADIUS, 8, 6);
  head.translate(0, shaftHeight, 0);

  const merged = mergeGeometries([shaft, head]);
  shaft.dispose();
  head.dispose();

  if (!merged) {
    throw new Error('Failed to merge pin geometry');
  }
  return merged;
}

export function createPinField(stations: readonly Station[], options: PinFieldOptions): PinField {
  const { radius, limit = Number.POSITIVE_INFINITY } = options;

  const pinned = stations.filter((station) => station.geo !== null).slice(0, limit);
  const skipped = stations.length - pinned.length;
  const count = pinned.length;

  const geometry = createPinGeometry(radius);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8a94a,
    roughness: 0.42,
    metalness: 0.85,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
  mesh.name = 'station-pins';
  mesh.count = count;
  // Pins are a couple of pixels wide at any sensible camera distance, so a
  // shadow pass over 3000 instances would cost real time and show nothing.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Picking is screen-space, so three.js's own raycast is only a fallback.
  mesh.frustumCulled = false;

  const localPositions = new Float32Array(count * 3);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();

  for (let index = 0; index < count; index += 1) {
    const station = pinned[index];
    const geo = station?.geo;
    if (!geo) continue;

    latLngToVector3(geo.lat, geo.lng, radius, position);
    localPositions[index * 3] = position.x;
    localPositions[index * 3 + 1] = position.y;
    localPositions[index * 3 + 2] = position.z;

    outwardQuaternion(position, quaternion);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();

  // Hover ring: same geometry, scaled up, emissive, hidden until needed.
  const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd98a,
    emissive: 0xc9963f,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.4,
  });
  const highlight = new THREE.Mesh(geometry, highlightMaterial);
  highlight.name = 'station-pin-highlight';
  highlight.visible = false;
  highlight.castShadow = false;
  highlight.scale.setScalar(HIGHLIGHT_SCALE);

  const object = new THREE.Group();
  object.name = 'station-pins-group';
  object.add(mesh, highlight);

  const worldPosition = new THREE.Vector3();
  const projected = new THREE.Vector3();

  const worldAt = (index: number, target: THREE.Vector3): THREE.Vector3 => {
    target.set(
      localPositions[index * 3] ?? 0,
      localPositions[index * 3 + 1] ?? 0,
      localPositions[index * 3 + 2] ?? 0,
    );
    return target.applyMatrix4(mesh.matrixWorld);
  };

  const screenPositionOf = (
    index: number,
    camera: THREE.Camera,
    viewport: Viewport,
  ): { x: number; y: number } | null => {
    if (index < 0 || index >= count) return null;
    worldAt(index, worldPosition);
    projected.copy(worldPosition).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * viewport.width,
      y: (-projected.y * 0.5 + 0.5) * viewport.height,
    };
  };

  return {
    object,
    mesh,
    stations: pinned,
    count,
    skipped,

    setHighlight(index) {
      if (index === null || index < 0 || index >= count) {
        highlight.visible = false;
        return;
      }
      worldAt(index, worldPosition);
      highlight.position.copy(worldPosition);
      highlight.quaternion.copy(outwardQuaternion(worldPosition));
      highlight.visible = true;
    },

    raycast(raycaster) {
      const hits = raycaster.intersectObject(mesh, false);
      const first = hits[0];
      if (!first || first.instanceId === undefined) return null;
      return first.instanceId;
    },

    nearestToScreen(x, y, camera, viewport, tolerance = DEFAULT_PICK_TOLERANCE) {
      mesh.updateWorldMatrix(true, false);

      const cameraPosition = camera.position;
      const radiusSquared = radius * radius;
      let bestIndex: number | null = null;
      let bestDistanceSquared = tolerance * tolerance;

      for (let index = 0; index < count; index += 1) {
        worldAt(index, worldPosition);

        // Skip pins on the far side: without this, a click near the silhouette
        // would grab a pin hidden behind the globe.
        if (worldPosition.dot(cameraPosition) <= radiusSquared) continue;

        projected.copy(worldPosition).project(camera);
        const screenX = (projected.x * 0.5 + 0.5) * viewport.width;
        const screenY = (-projected.y * 0.5 + 0.5) * viewport.height;

        const dx = screenX - x;
        const dy = screenY - y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < bestDistanceSquared) {
          bestDistanceSquared = distanceSquared;
          bestIndex = index;
        }
      }

      return bestIndex;
    },

    screenPositionOf,

    dispose() {
      geometry.dispose();
      material.dispose();
      highlightMaterial.dispose();
      mesh.dispose();
    },
  };
}

/** Exported for tests: the occlusion test used by `nearestToScreen`. */
export { isFacingCamera };
