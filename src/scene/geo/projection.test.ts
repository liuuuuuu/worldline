import { describe, expect, it } from 'vitest';
import {
  graticuleValues,
  normaliseLongitude,
  projectEquirectangular,
  unprojectEquirectangular,
} from './projection';

describe('projectEquirectangular', () => {
  it('maps the corners of the world to the corners of the texture', () => {
    expect(projectEquirectangular(-180, 90, 4096, 2048)).toEqual({ x: 0, y: 0 });
    expect(projectEquirectangular(180, -90, 4096, 2048)).toEqual({ x: 4096, y: 2048 });
  });

  it('maps the origin to the centre', () => {
    expect(projectEquirectangular(0, 0, 4096, 2048)).toEqual({ x: 2048, y: 1024 });
  });

  it('scales linearly with longitude and latitude', () => {
    // 90° east is three quarters of the way across.
    expect(projectEquirectangular(90, 0, 360, 180)).toEqual({ x: 270, y: 90 });
    // 45° north is a quarter of the way down.
    expect(projectEquirectangular(0, 45, 360, 180)).toEqual({ x: 180, y: 45 });
  });

  it('increases y as latitude decreases', () => {
    const north = projectEquirectangular(0, 60, 100, 100);
    const south = projectEquirectangular(0, -60, 100, 100);
    expect(north.y).toBeLessThan(south.y);
  });
});

describe('unprojectEquirectangular', () => {
  it('round-trips with the forward projection', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [-180, 90],
      [180, -90],
      [139.6917, 35.6895],
      [-122.4194, 37.7749],
      [18.4241, -33.9249],
    ];

    for (const [lng, lat] of samples) {
      const point = projectEquirectangular(lng, lat, 4096, 2048);
      const back = unprojectEquirectangular(point.x, point.y, 4096, 2048);
      expect(back.lng).toBeCloseTo(lng, 6);
      expect(back.lat).toBeCloseTo(lat, 6);
    }
  });
});

describe('graticuleValues', () => {
  it('spans the full longitude range inclusive of both seams', () => {
    const { meridians } = graticuleValues(15);
    expect(meridians[0]).toBe(-180);
    expect(meridians.at(-1)).toBe(180);
    expect(meridians).toHaveLength(25);
  });

  it('excludes the poles from the parallels', () => {
    const { parallels } = graticuleValues(15);
    // A parallel at ±90° is a point, not a line — stroking it produces a
    // degenerate artefact at the texture edge.
    expect(parallels).not.toContain(-90);
    expect(parallels).not.toContain(90);
    expect(parallels[0]).toBe(-75);
    expect(parallels.at(-1)).toBe(75);
  });

  it('always includes the equator and prime meridian for standard steps', () => {
    for (const step of [5, 10, 15, 30]) {
      const { meridians, parallels } = graticuleValues(step);
      expect(meridians).toContain(0);
      expect(parallels).toContain(0);
    }
  });

  it('rejects a non-positive step instead of looping forever', () => {
    expect(() => graticuleValues(0)).toThrow(RangeError);
    expect(() => graticuleValues(-15)).toThrow(RangeError);
    expect(() => graticuleValues(Number.NaN)).toThrow(RangeError);
  });
});

describe('normaliseLongitude', () => {
  it('leaves in-range values alone', () => {
    expect(normaliseLongitude(0)).toBe(0);
    expect(normaliseLongitude(179)).toBe(179);
    expect(normaliseLongitude(-179)).toBe(-179);
  });

  it('wraps values past the antimeridian', () => {
    expect(normaliseLongitude(181)).toBe(-179);
    expect(normaliseLongitude(-181)).toBe(179);
    expect(normaliseLongitude(360)).toBe(0);
    expect(normaliseLongitude(540)).toBe(-180);
  });
});
