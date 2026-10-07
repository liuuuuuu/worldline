/**
 * Land geometry, decoded from Natural Earth via TopoJSON.
 *
 * Natural Earth is public domain, which is the whole point: the globe's skin is
 * generated from vector data at runtime instead of shipping a copyrighted map
 * image. It also means the same rings can drive pin placement and future
 * features (country outlines, region highlighting) without another data source.
 *
 * `land-50m` (~545 KB) is served as a static asset and fetched on demand rather
 * than inlined into the bundle — the coastlines are noticeably smoother than
 * `land-110m` at a 4096px texture width, and a desktop app can afford one local
 * fetch that a JS bundle should not carry.
 */

import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import landTopologyUrl from 'world-atlas/land-50m.json?url';

/** A closed ring of `[lng, lat]` positions. */
export type LinearRing = readonly Position[];
/** A polygon as its outer ring followed by its holes. */
export type PolygonRings = readonly LinearRing[];

interface LandTopology extends Topology {
  objects: {
    land: GeometryCollection;
  };
}

function polygonsFromGeometry(geometry: Geometry | null): PolygonRings[] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Flatten a decoded FeatureCollection into polygons. */
export function ringsFromFeatureCollection(collection: FeatureCollection): PolygonRings[] {
  const polygons: PolygonRings[] = [];
  for (const item of collection.features) {
    polygons.push(...polygonsFromGeometry(item.geometry));
  }
  return polygons;
}

/**
 * Decode a `world-atlas` TopoJSON topology into plain polygon rings.
 *
 * Throws when the shape is not what we expect — a silent empty result would show
 * up as a featureless blank globe, which is much harder to diagnose than a
 * stack trace at load time.
 */
export function decodeLandRings(topology: unknown): PolygonRings[] {
  if (typeof topology !== 'object' || topology === null) {
    throw new TypeError('Land topology is not an object');
  }

  const typed = topology as LandTopology;
  const land = typed.objects?.land;
  if (!land) {
    throw new TypeError('Land topology has no `objects.land`');
  }

  // `feature()` with a GeometryCollection always yields a FeatureCollection.
  const decoded = feature(typed, land as GeometryCollection<GeoJsonProperties>);
  const polygons = ringsFromFeatureCollection(decoded);
  if (polygons.length === 0) {
    throw new TypeError('Land topology decoded to zero polygons');
  }
  return polygons;
}

let landPromise: Promise<PolygonRings[]> | null = null;

/**
 * Fetch and decode the land rings once per session.
 *
 * Cached as a promise, not a value, so concurrent callers share one request.
 * A failed load clears the cache so a later attempt can retry rather than
 * caching the rejection forever.
 */
export function loadLandRings(url: string = landTopologyUrl): Promise<PolygonRings[]> {
  landPromise ??= (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load land geometry: HTTP ${response.status}`);
    }
    return decodeLandRings(await response.json());
  })().catch((error: unknown) => {
    landPromise = null;
    throw error;
  });

  return landPromise;
}

/** Test seam: forget the cached promise. */
export function resetLandCache(): void {
  landPromise = null;
}
