/**
 * Spherical coordinate maths for placing things on the globe.
 *
 * This must agree exactly with two other things or pins land on the wrong city:
 *
 *  1. `three.js` `SphereGeometry`'s vertex generation, which is
 *     `x = -r·cos(phi)·sin(theta)`, `y = r·cos(theta)`, `z = r·sin(phi)·sin(theta)`
 *     with `phi = u·2π` and `theta = v·π`.
 *  2. Our equirectangular texture, where `u = (lng+180)/360` and the image's top
 *     row is +90° latitude.
 *
 * The two together give `phi = (lng+180)°` and `theta = (90-lat)°`. Every
 * function here is the inverse of another in the same file, and the tests
 * round-trip them, because a sign error would put every pin in the ocean and
 * look plausible at a glance.
 */

import * as THREE from 'three';
import { normaliseLongitude } from './projection';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const UP = new THREE.Vector3(0, 1, 0);

export { normaliseLongitude };

/**
 * Latitude/longitude in degrees → a point on a sphere of `radius` centred at
 * the origin.
 *
 * Writes into `target` when supplied so a 3000-pin loop allocates nothing.
 */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = (lng + 180) * DEG2RAD;
  const theta = (90 - lat) * DEG2RAD;
  const sinTheta = Math.sin(theta);

  return target.set(
    -radius * Math.cos(phi) * sinTheta,
    radius * Math.cos(theta),
    radius * Math.sin(phi) * sinTheta,
  );
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Inverse of `latLngToVector3`. Longitude comes back in [-180, 180). */
export function vector3ToLatLng(point: THREE.Vector3): LatLng {
  const radius = point.length();
  if (radius === 0) return { lat: 0, lng: 0 };

  // Clamp guards against floating-point drift pushing the ratio past ±1.
  const theta = Math.acos(Math.min(1, Math.max(-1, point.y / radius)));
  const phi = Math.atan2(point.z, -point.x);

  const lat = 90 - theta * RAD2DEG;
  const lng = normaliseLongitude(phi * RAD2DEG - 180);

  return { lat, lng };
}

/** Wrap any longitude into [-180, 180). Re-exported from the projection module
 *  so there is exactly one implementation. */

/**
 * Whether a point on a sphere of `radius` centred at the origin is on the
 * hemisphere facing `cameraPosition`.
 *
 * The exact test is `dot(P, C) > r²`, which is the tangent plane at P — cheaper
 * and more robust than projecting and comparing depths, and it is what keeps
 * hover picking from selecting pins on the far side of the globe.
 */
export function isFacingCamera(
  point: THREE.Vector3,
  cameraPosition: THREE.Vector3,
  radius: number,
): boolean {
  return point.dot(cameraPosition) > radius * radius;
}

/**
 * A rotation that maps the pin's local +Y axis onto its outward surface normal.
 *
 * Pins are modelled pointing up; without this they would all stick straight out
 * of the north pole.
 */
export function outwardQuaternion(
  surfacePoint: THREE.Vector3,
  target: THREE.Quaternion = new THREE.Quaternion(),
): THREE.Quaternion {
  const normal = surfacePoint.clone().normalize();
  return target.setFromUnitVectors(UP, normal);
}
