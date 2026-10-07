import { afterEach, describe, expect, it, vi } from 'vitest';
import land110m from 'world-atlas/land-110m.json';
import { decodeLandRings, loadLandRings, resetLandCache, ringsFromFeatureCollection } from './land';
import type { FeatureCollection } from 'geojson';

afterEach(() => {
  resetLandCache();
  vi.unstubAllGlobals();
});

describe('decodeLandRings', () => {
  it('decodes the real Natural Earth topology into polygons', () => {
    // Uses the actual shipped data: a hand-rolled fixture would not catch a
    // mismatch with the real TopoJSON shape.
    const polygons = decodeLandRings(land110m);

    expect(polygons.length).toBeGreaterThan(50);
    const first = polygons[0];
    expect(first).toBeDefined();
    expect(first?.[0]?.length).toBeGreaterThan(2);
  });

  it('produces [lng, lat] pairs inside valid ranges', () => {
    const polygons = decodeLandRings(land110m);
    const ring = polygons[0]?.[0] ?? [];

    for (const position of ring.slice(0, 200)) {
      const [lng, lat] = position;
      expect(typeof lng).toBe('number');
      expect(typeof lat).toBe('number');
      expect(lng as number).toBeGreaterThanOrEqual(-180.0001);
      expect(lng as number).toBeLessThanOrEqual(180.0001);
      expect(lat as number).toBeGreaterThanOrEqual(-90.0001);
      expect(lat as number).toBeLessThanOrEqual(90.0001);
    }
  });

  it('rejects a non-object payload', () => {
    expect(() => decodeLandRings(null)).toThrow(TypeError);
    expect(() => decodeLandRings('nope')).toThrow(TypeError);
  });

  it('rejects a topology with no land object', () => {
    expect(() => decodeLandRings({ type: 'Topology', objects: {}, arcs: [] })).toThrow(
      /objects\.land/,
    );
  });

  it('rejects a topology that decodes to nothing, rather than showing a blank globe', () => {
    const empty = {
      type: 'Topology',
      objects: { land: { type: 'GeometryCollection', geometries: [] } },
      arcs: [],
      transform: { scale: [1, 1], translate: [0, 0] },
    };
    expect(() => decodeLandRings(empty)).toThrow(/zero polygons/);
  });
});

describe('ringsFromFeatureCollection', () => {
  it('flattens Polygon and MultiPolygon features', () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const collection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring]] },
        },
      ],
    } as unknown as FeatureCollection;

    expect(ringsFromFeatureCollection(collection)).toHaveLength(3);
  });

  it('skips features with no geometry', () => {
    const collection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null }],
    } as unknown as FeatureCollection;

    expect(ringsFromFeatureCollection(collection)).toEqual([]);
  });
});

describe('loadLandRings', () => {
  it('fetches, decodes, and caches across calls', async () => {
    const fetchImpl = vi.fn<() => Promise<Response>>(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(land110m),
      } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const first = await loadLandRings('/land.json');
    const second = await loadLandRings('/land.json');

    expect(first.length).toBeGreaterThan(50);
    // Cached as a promise, so concurrent and later callers share one request.
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports the HTTP status when the asset is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404 } as unknown as Response)),
    );

    await expect(loadLandRings('/missing.json')).rejects.toThrow(/HTTP 404/);
  });

  it('does not cache a failure, so a retry can succeed', async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(land110m),
          } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchImpl);

    await expect(loadLandRings('/land.json')).rejects.toThrow('network down');
    await expect(loadLandRings('/land.json')).resolves.toBeInstanceOf(Array);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
