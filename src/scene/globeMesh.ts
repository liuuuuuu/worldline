/**
 * The desk globe: sphere, brass meridian ring, wooden pedestal.
 *
 * Object hierarchy is the important part here:
 *
 *   root          world placement, never tilted
 *   ├─ spinner    tilted 23.5° — rotating this about its own Y spins the globe
 *   │   ├─ sphere   the printed skin
 *   │   └─ ring     brass meridian, tilts *with* the globe, as on a real one
 *   └─ pedestal   stays vertical
 *
 * Getting this wrong is the classic globe bug: tilt the root and the pedestal
 * leans too; put the ring outside the spinner and it detaches from the sphere as
 * soon as you drag.
 */

import * as THREE from 'three';
import { createBrassMaterial, createPaperMaterial, createPedestalMaterial } from './materials';

export const GLOBE_RADIUS = 1;
export const GLOBE_TILT_DEGREES = 23.5;

/** Ring radius as a multiple of the sphere radius. */
const RING_RADIUS_FACTOR = 1.055;
/** Ring tube thickness as a multiple of the sphere radius. */
const RING_TUBE_FACTOR = 0.018;
/** Pedestal height as a multiple of the sphere radius. */
const PEDESTAL_HEIGHT_FACTOR = 0.465;

/**
 * Pedestal profile as `[radius, height]` pairs, in sphere-radius units.
 *
 * A wide foot and a short, thick stem: the first version was a thin dark stick
 * that read as a lamp stand rather than a globe base.
 */
const PEDESTAL_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.56, 0.0],
  [0.58, 0.045],
  [0.5, 0.088],
  [0.31, 0.118],
  [0.17, 0.17],
  [0.135, 0.3],
  [0.165, 0.36],
  [0.225, 0.415],
  [0.195, 0.465],
  [0.0, 0.465],
];

export interface GlobeLayout {
  /** Y position of the desk surface, in world units. */
  deskY: number;
  /** Y position of the globe's centre. */
  centreY: number;
}

export interface GlobeAssembly {
  root: THREE.Group;
  /** Tilted group. Rotate `spinner.rotation.y` to spin the globe. */
  spinner: THREE.Group;
  sphere: THREE.Mesh;
  ring: THREE.Mesh;
  pedestal: THREE.Mesh;
  layout: GlobeLayout;
  dispose(): void;
}

/**
 * Where everything sits vertically, derived rather than hard-coded so the
 * proportions stay right if the radius changes.
 *
 * The ring's lowest point is always `-ringOuter`: tilting a circle about an axis
 * in its own plane does not raise its minimum.
 */
export function computeLayout(radius: number): GlobeLayout {
  const ringOuter = radius * (RING_RADIUS_FACTOR + RING_TUBE_FACTOR);
  const pedestalHeight = radius * PEDESTAL_HEIGHT_FACTOR;
  return {
    centreY: 0,
    deskY: -ringOuter - pedestalHeight,
  };
}

export function createPedestalGeometry(radius: number): THREE.LatheGeometry {
  const points = PEDESTAL_PROFILE.map(([r, h]) => new THREE.Vector2(r * radius, h * radius));
  return new THREE.LatheGeometry(points, 96);
}

export interface CreateGlobeOptions {
  radius?: number;
  tiltDegrees?: number;
  /** The printed paper skin. */
  skin: THREE.Texture;
  /** Wood grain for the pedestal. */
  wood: THREE.Texture;
}

export function createGlobe(options: CreateGlobeOptions): GlobeAssembly {
  const { radius = GLOBE_RADIUS, tiltDegrees = GLOBE_TILT_DEGREES, skin, wood } = options;

  const layout = computeLayout(radius);
  const ringOuter = radius * (RING_RADIUS_FACTOR + RING_TUBE_FACTOR);
  const pedestalHeight = radius * PEDESTAL_HEIGHT_FACTOR;

  const paperMaterial = createPaperMaterial(skin);
  const brassMaterial = createBrassMaterial();
  const woodMaterial = createPedestalMaterial(wood);

  const sphereGeometry = new THREE.SphereGeometry(radius, 128, 80);
  const sphere = new THREE.Mesh(sphereGeometry, paperMaterial);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  sphere.name = 'globe-sphere';

  const ringGeometry = new THREE.TorusGeometry(
    radius * RING_RADIUS_FACTOR,
    radius * RING_TUBE_FACTOR,
    16,
    200,
  );
  const ring = new THREE.Mesh(ringGeometry, brassMaterial);
  ring.castShadow = true;
  ring.name = 'globe-ring';

  const spinner = new THREE.Group();
  spinner.name = 'globe-spinner';
  spinner.add(sphere, ring);
  // Tilt about Z so the axis leans towards the viewer, as a real globe does.
  spinner.rotation.z = THREE.MathUtils.degToRad(tiltDegrees);

  const pedestalGeometry = createPedestalGeometry(radius);
  const pedestal = new THREE.Mesh(pedestalGeometry, woodMaterial);
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  pedestal.name = 'globe-pedestal';
  // The lathe is built upwards from y = 0; drop it so its top meets the ring.
  pedestal.position.y = -ringOuter - pedestalHeight;

  const root = new THREE.Group();
  root.name = 'globe-root';
  root.add(spinner, pedestal);

  return {
    root,
    spinner,
    sphere,
    ring,
    pedestal,
    layout,
    dispose() {
      sphereGeometry.dispose();
      ringGeometry.dispose();
      pedestalGeometry.dispose();
      paperMaterial.dispose();
      brassMaterial.dispose();
      woodMaterial.dispose();
      skin.dispose();
      wood.dispose();
    },
  };
}
