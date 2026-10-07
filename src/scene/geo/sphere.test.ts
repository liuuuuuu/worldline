import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isFacingCamera, latLngToVector3, outwardQuaternion, vector3ToLatLng } from './sphere';

const RADIUS = 1;

describe('latLngToVector3', () => {
  it('places the equator/prime-meridian intersection on +X', () => {
    const point = latLngToVector3(0, 0, RADIUS);
    expect(point.x).toBeCloseTo(1, 10);
    expect(point.y).toBeCloseTo(0, 10);
    expect(point.z).toBeCloseTo(0, 10);
  });

  it('places the poles on ±Y', () => {
    const north = latLngToVector3(90, 0, RADIUS);
    expect(north.y).toBeCloseTo(1, 10);

    const south = latLngToVector3(-90, 0, RADIUS);
    expect(south.y).toBeCloseTo(-1, 10);
  });

  it('places 90°W on +Z, which is where the default camera looks', () => {
    // The camera sits on +Z, so this is the point of the globe facing the
    // viewer. If this sign flipped, every pin would render on the far side.
    const point = latLngToVector3(0, -90, RADIUS);
    expect(point.z).toBeCloseTo(1, 10);
    expect(point.x).toBeCloseTo(0, 10);
  });

  it('places 90°E on -Z', () => {
    const point = latLngToVector3(0, 90, RADIUS);
    expect(point.z).toBeCloseTo(-1, 10);
  });

  it('scales with the radius', () => {
    const point = latLngToVector3(0, 0, 4);
    expect(point.length()).toBeCloseTo(4, 10);
  });

  it('always lands on the sphere', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [51.5074, -0.1278],
      [-33.9249, 18.4241],
      [35.6895, 139.6917],
      [-90, 0],
      [90, 0],
      [0, 180],
      [0, -180],
    ];

    for (const [lat, lng] of samples) {
      expect(latLngToVector3(lat, lng, RADIUS).length()).toBeCloseTo(RADIUS, 10);
    }
  });

  it('writes into the target vector instead of allocating', () => {
    const target = new THREE.Vector3();
    const result = latLngToVector3(10, 20, RADIUS, target);
    expect(result).toBe(target);
  });
});

describe('vector3ToLatLng', () => {
  it('round-trips every sample', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [51.5074, -0.1278],
      [-33.9249, 18.4241],
      [35.6895, 139.6917],
      [-45, -122],
      [60, 18],
      [-90, 0],
      [90, 0],
    ];

    for (const [lat, lng] of samples) {
      const back = vector3ToLatLng(latLngToVector3(lat, lng, RADIUS));
      expect(back.lat).toBeCloseTo(lat, 8);
      // Longitude is only defined modulo 360 at the poles.
      if (Math.abs(lat) < 89) {
        expect(back.lng).toBeCloseTo(lng, 8);
      }
    }
  });

  it('normalises longitude into [-180, 180)', () => {
    // 180° and -180° are the same meridian; the inverse must pick one.
    const point = latLngToVector3(0, 180, RADIUS);
    const { lng } = vector3ToLatLng(point);
    expect(lng).toBeGreaterThanOrEqual(-180);
    expect(lng).toBeLessThan(180);
  });

  it('returns the origin rather than NaN for a zero vector', () => {
    expect(vector3ToLatLng(new THREE.Vector3(0, 0, 0))).toEqual({ lat: 0, lng: 0 });
  });
});

describe('isFacingCamera', () => {
  const camera = new THREE.Vector3(0, 0, 5);

  it('accepts the near hemisphere', () => {
    expect(isFacingCamera(new THREE.Vector3(0, 0, 1), camera, RADIUS)).toBe(true);
    // 60° off the view axis — comfortably inside the horizon.
    expect(isFacingCamera(new THREE.Vector3(0.5, 0, Math.sqrt(3) / 2), camera, RADIUS)).toBe(true);
  });

  it('rejects the far hemisphere', () => {
    expect(isFacingCamera(new THREE.Vector3(0, 0, -1), camera, RADIUS)).toBe(false);
    expect(isFacingCamera(new THREE.Vector3(-1, 0, 0), camera, RADIUS)).toBe(false);
  });

  it('puts the silhouette exactly on the boundary', () => {
    // The tangent-plane test: dot(P, C) == r² is the horizon, and the horizon
    // is a great circle of points that are *not* facing the camera.
    expect(isFacingCamera(new THREE.Vector3(RADIUS, 0, 0), camera, RADIUS)).toBe(false);
    expect(isFacingCamera(new THREE.Vector3(0, RADIUS, 0), camera, RADIUS)).toBe(false);
  });
});

describe('outwardQuaternion', () => {
  it('maps the pin’s local +Y onto the surface normal', () => {
    const surface = new THREE.Vector3(1, 0, 0);
    const quaternion = outwardQuaternion(surface);
    const rotated = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

    expect(rotated.x).toBeCloseTo(1, 8);
    expect(rotated.y).toBeCloseTo(0, 8);
    expect(rotated.z).toBeCloseTo(0, 8);
  });

  it('points outward at the equator, both poles, and in between', () => {
    const samples = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0.4, 0.5, -0.7).normalize(),
    ];

    for (const surface of samples) {
      const rotated = new THREE.Vector3(0, 1, 0).applyQuaternion(outwardQuaternion(surface));
      expect(rotated.dot(surface.clone().normalize())).toBeCloseTo(1, 6);
    }
  });
});
