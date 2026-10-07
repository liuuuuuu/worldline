import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPinField, createPinGeometry, DEFAULT_PICK_TOLERANCE } from './pins';
import type { Station } from '../types/domain';

const RADIUS = 1;

function station(id: string, lat: number | null, lng: number | null): Station {
  return {
    id,
    name: `Station ${id}`,
    streamUrl: 'http://example.invalid/stream',
    tags: [],
    country: 'Test',
    countryCode: 'XX',
    votes: 0,
    codec: 'MP3',
    bitrate: 128,
    hls: false,
    healthy: true,
    geo: lat === null || lng === null ? null : { lat, lng },
  };
}

/** A camera on +Z looking at the origin, which is where the scene starts. */
function makeCamera(distance = 5): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

const VIEWPORT = { width: 800, height: 800 };

describe('createPinGeometry', () => {
  it('merges the shaft and the head into one geometry', () => {
    const geometry = createPinGeometry(RADIUS);
    expect(geometry.getAttribute('position')).toBeDefined();
    expect(geometry.getAttribute('position').count).toBeGreaterThan(20);
    geometry.dispose();
  });

  it('grows outwards from the origin', () => {
    const geometry = createPinGeometry(RADIUS);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;

    expect(box).not.toBeNull();
    // The pin starts at the surface and extends outwards, never inwards.
    expect(box?.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box?.max.y).toBeGreaterThan(0.05);
    geometry.dispose();
  });
});

describe('createPinField', () => {
  it('creates one instance per geolocated station', () => {
    const field = createPinField(
      [station('a', 0, -90), station('b', 10, 20), station('c', -10, -20)],
      { radius: RADIUS },
    );

    expect(field.count).toBe(3);
    expect(field.skipped).toBe(0);
    expect(field.mesh.count).toBe(3);
    field.dispose();
  });

  it('skips stations with no coordinates and reports how many', () => {
    const field = createPinField(
      [station('a', 0, -90), station('b', null, null), station('c', 10, 20)],
      { radius: RADIUS },
    );

    expect(field.count).toBe(2);
    expect(field.skipped).toBe(1);
    expect(field.stations.map((item) => item.id)).toEqual(['a', 'c']);
    field.dispose();
  });

  it('honours the limit', () => {
    const stations = Array.from({ length: 50 }, (_, index) =>
      station(`s${index}`, index - 25, index * 3),
    );
    const field = createPinField(stations, { radius: RADIUS, limit: 10 });

    expect(field.count).toBe(10);
    expect(field.skipped).toBe(40);
    field.dispose();
  });

  it('places every pin on the sphere surface', () => {
    const field = createPinField([station('a', 0, -90), station('b', 45, 120)], {
      radius: RADIUS,
    });

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let index = 0; index < field.count; index += 1) {
      field.mesh.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.length()).toBeCloseTo(RADIUS, 6);
    }
    field.dispose();
  });

  it('does not cast shadows, because a 3000-instance shadow pass is invisible', () => {
    const field = createPinField([station('a', 0, 0)], { radius: RADIUS });
    expect(field.mesh.castShadow).toBe(false);
    field.dispose();
  });

  it('handles an empty list without throwing', () => {
    const field = createPinField([], { radius: RADIUS });
    expect(field.count).toBe(0);
    expect(field.nearestToScreen(400, 400, makeCamera(), VIEWPORT)).toBeNull();
    field.dispose();
  });
});

describe('nearestToScreen', () => {
  it('finds a pin sitting at the centre of the view', () => {
    // 90°W faces the default camera.
    const field = createPinField([station('front', 0, -90)], { radius: RADIUS });
    const camera = makeCamera();

    expect(field.nearestToScreen(400, 400, camera, VIEWPORT)).toBe(0);
    field.dispose();
  });

  it('picks the closer of two nearby pins', () => {
    const field = createPinField([station('near', 0, -90), station('far', 0, -70)], {
      radius: RADIUS,
    });
    const camera = makeCamera();

    const near = field.screenPositionOf(0, camera, VIEWPORT);
    const far = field.screenPositionOf(1, camera, VIEWPORT);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();

    expect(field.nearestToScreen(near?.x ?? 0, near?.y ?? 0, camera, VIEWPORT)).toBe(0);
    expect(field.nearestToScreen(far?.x ?? 0, far?.y ?? 0, camera, VIEWPORT)).toBe(1);
    field.dispose();
  });

  it('ignores pins on the far side of the globe', () => {
    // 90°E is directly behind the globe from the default camera.
    const field = createPinField([station('behind', 0, 90)], { radius: RADIUS });
    const camera = makeCamera();

    // Even asking exactly where it would project must not return it — a click
    // near the silhouette should never grab a hidden pin.
    const projected = field.screenPositionOf(0, camera, VIEWPORT);
    expect(projected).not.toBeNull();
    expect(
      field.nearestToScreen(projected?.x ?? 0, projected?.y ?? 0, camera, VIEWPORT),
    ).toBeNull();
    field.dispose();
  });

  it('respects the pick tolerance', () => {
    const field = createPinField([station('front', 0, -90)], { radius: RADIUS });
    const camera = makeCamera();

    const offset = DEFAULT_PICK_TOLERANCE + 20;
    expect(field.nearestToScreen(400 + offset, 400, camera, VIEWPORT)).toBeNull();
    expect(field.nearestToScreen(400 + offset, 400, camera, VIEWPORT, offset + 5)).toBe(0);
    field.dispose();
  });

  it('tracks the globe as it spins', () => {
    const field = createPinField([station('front', 0, -90)], { radius: RADIUS });
    const camera = makeCamera();

    expect(field.nearestToScreen(400, 400, camera, VIEWPORT)).toBe(0);

    // A quarter turn takes that pin to the far side.
    field.object.rotation.y = Math.PI / 2;
    field.object.updateMatrixWorld(true);
    expect(field.nearestToScreen(400, 400, camera, VIEWPORT)).toBeNull();
    field.dispose();
  });
});

describe('screenPositionOf', () => {
  it('returns null for an out-of-range index', () => {
    const field = createPinField([station('a', 0, -90)], { radius: RADIUS });
    expect(field.screenPositionOf(5, makeCamera(), VIEWPORT)).toBeNull();
    expect(field.screenPositionOf(-1, makeCamera(), VIEWPORT)).toBeNull();
    field.dispose();
  });

  it('projects a front-facing pin near the centre of the viewport', () => {
    const field = createPinField([station('a', 0, -90)], { radius: RADIUS });
    const position = field.screenPositionOf(0, makeCamera(), VIEWPORT);

    expect(position).not.toBeNull();
    expect(position?.x).toBeCloseTo(400, 1);
    expect(position?.y).toBeCloseTo(400, 1);
    field.dispose();
  });
});

describe('setHighlight', () => {
  function highlightOf(field: ReturnType<typeof createPinField>): THREE.Object3D {
    const found = field.object.children.find((child) => child.name === 'station-pin-highlight');
    if (!found) throw new Error('highlight mesh missing');
    return found;
  }

  it('starts hidden and shows on demand', () => {
    const field = createPinField([station('a', 0, -90)], { radius: RADIUS });
    const highlight = highlightOf(field);

    expect(highlight.visible).toBe(false);

    field.setHighlight(0);
    expect(highlight.visible).toBe(true);
    expect(highlight.position.length()).toBeCloseTo(RADIUS, 6);

    field.setHighlight(null);
    expect(highlight.visible).toBe(false);
    field.dispose();
  });

  it('ignores an out-of-range index rather than showing a stray marker', () => {
    const field = createPinField([station('a', 0, -90)], { radius: RADIUS });
    field.setHighlight(9);
    expect(highlightOf(field).visible).toBe(false);
    field.dispose();
  });
});

describe('raycast', () => {
  it('hits a pin the ray passes through', () => {
    const field = createPinField([station('front', 0, -90)], { radius: RADIUS });
    const camera = makeCamera();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    expect(field.raycast(raycaster)).toBe(0);
    field.dispose();
  });

  it('returns null when the ray misses', () => {
    const field = createPinField([station('front', 0, -90)], { radius: RADIUS });
    const camera = makeCamera();
    const raycaster = new THREE.Raycaster();
    // Aim at a corner of the viewport, well away from the single pin.
    raycaster.setFromCamera(new THREE.Vector2(-0.95, 0.95), camera);

    expect(field.raycast(raycaster)).toBeNull();
    field.dispose();
  });
});
