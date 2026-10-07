/**
 * Map projections.
 *
 * The globe's skin is a plain equirectangular (plate carrée) image — the
 * standard lat/lng grid that every sphere texture uses, because the UV mapping
 * of a `SphereGeometry` is already equirectangular. That means a coordinate and
 * its pixel are related by a straight linear map, which keeps this file tiny and
 * makes pin placement (P3) exact rather than approximate.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * `lng`/`lat` in degrees → pixel coordinates on a `width` × `height` texture.
 *
 * The result is a fractional pixel position; callers that need a pixel centre
 * should round. Longitude -180 maps to x = 0, +180 to x = width, so a point
 * exactly on the seam can land on either edge.
 */
export function projectEquirectangular(
  lng: number,
  lat: number,
  width: number,
  height: number,
): Point {
  return {
    x: ((lng + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

/** Inverse of `projectEquirectangular`. */
export function unprojectEquirectangular(
  x: number,
  y: number,
  width: number,
  height: number,
): { lng: number; lat: number } {
  return {
    lng: (x / width) * 360 - 180,
    lat: 90 - (y / height) * 180,
  };
}

export interface Graticule {
  /** Longitudes to draw, in degrees, ascending. */
  meridians: number[];
  /** Latitudes to draw, in degrees, ascending. */
  parallels: number[];
}

/**
 * Longitude/latitude lines at a fixed interval.
 *
 * The poles are excluded from `parallels`: a parallel at ±90° is a point, not a
 * line, and drawing it produces a degenerate stroke at the texture's edge.
 */
export function graticuleValues(stepDegrees: number): Graticule {
  if (!Number.isFinite(stepDegrees) || stepDegrees <= 0) {
    throw new RangeError(`graticule step must be a positive number, got ${String(stepDegrees)}`);
  }

  const meridians: number[] = [];
  for (let lng = -180; lng <= 180; lng += stepDegrees) {
    meridians.push(Number(lng.toFixed(6)));
  }

  const parallels: number[] = [];
  for (let lat = -90 + stepDegrees; lat <= 90 - stepDegrees; lat += stepDegrees) {
    parallels.push(Number(lat.toFixed(6)));
  }

  return { meridians, parallels };
}

/**
 * Normalise a longitude into [-180, 180).
 *
 * Used when a ring crosses the antimeridian: rather than splitting the polygon,
 * we detect the wrap and break the path so the stroke does not run back across
 * the whole texture.
 */
export function normaliseLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped;
}
