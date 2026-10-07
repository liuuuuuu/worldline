import { describe, expect, it } from 'vitest';
import { openMeteoResponseSchema, parseRadioBrowserStations } from './schemas';

describe('parseRadioBrowserStations', () => {
  it('parses a well-formed record', () => {
    const { stations, rejected } = parseRadioBrowserStations([
      {
        stationuuid: 'abc-123',
        name: 'Radio Paradise',
        url_resolved: 'http://example.com/stream',
        tags: 'california,eclectic',
        countrycode: 'US',
        votes: 318772,
        bitrate: 320,
        hls: 0,
        lastcheckok: 1,
        geo_lat: 34.05,
        geo_long: -118.24,
      },
    ]);

    expect(rejected).toBe(0);
    expect(stations).toHaveLength(1);
    expect(stations[0]?.stationuuid).toBe('abc-123');
    expect(stations[0]?.votes).toBe(318772);
    expect(stations[0]?.geo_lat).toBe(34.05);
  });

  it('rejects records with no usable stationuuid and counts them', () => {
    const { stations, rejected } = parseRadioBrowserStations([
      { stationuuid: '', name: 'no id' },
      { name: 'missing id entirely' },
      { stationuuid: 'kept', name: 'fine' },
    ]);

    expect(stations).toHaveLength(1);
    expect(stations[0]?.stationuuid).toBe('kept');
    expect(rejected).toBe(2);
  });

  it('coerces numeric strings', () => {
    const { stations } = parseRadioBrowserStations([
      { stationuuid: 'x', votes: '42', bitrate: '128', geo_lat: '35.68', geo_long: '139.69' },
    ]);

    expect(stations[0]?.votes).toBe(42);
    expect(stations[0]?.bitrate).toBe(128);
    expect(stations[0]?.geo_lat).toBe(35.68);
    expect(stations[0]?.geo_long).toBe(139.69);
  });

  it('keeps missing coordinates as null rather than zero', () => {
    const { stations } = parseRadioBrowserStations([
      { stationuuid: 'x', geo_lat: null, geo_long: null },
      { stationuuid: 'y' },
    ]);

    expect(stations[0]?.geo_lat).toBeNull();
    expect(stations[0]?.geo_long).toBeNull();
    expect(stations[1]?.geo_lat).toBeNull();
  });

  it('degrades unusable fields to defaults instead of failing the batch', () => {
    const { stations, rejected } = parseRadioBrowserStations([
      { stationuuid: 'x', name: 42, votes: 'not a number', hls: 'true', tags: null },
    ]);

    expect(rejected).toBe(0);
    expect(stations[0]?.name).toBe('42');
    expect(stations[0]?.votes).toBe(0);
    expect(stations[0]?.hls).toBe(true);
    expect(stations[0]?.tags).toBe('');
  });

  it('returns nothing for a non-array body', () => {
    expect(parseRadioBrowserStations({ error: 'nope' })).toEqual({ stations: [], rejected: 0 });
    expect(parseRadioBrowserStations(null)).toEqual({ stations: [], rejected: 0 });
  });
});

describe('openMeteoResponseSchema', () => {
  const valid = {
    latitude: 35.7,
    longitude: 139.69,
    utc_offset_seconds: 32400,
    timezone: 'Asia/Tokyo',
    timezone_abbreviation: 'GMT+9',
    current: {
      time: '2026-10-07T21:00',
      temperature_2m: 18,
      weather_code: 0,
      is_day: 0,
      wind_speed_10m: 4.3,
    },
  };

  it('accepts a valid payload', () => {
    expect(openMeteoResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a payload missing the fields we requested', () => {
    const { current: _current, ...withoutCurrent } = valid;
    expect(openMeteoResponseSchema.safeParse(withoutCurrent).success).toBe(false);

    const partial = { ...valid, current: { time: '2026-10-07T21:00' } };
    expect(openMeteoResponseSchema.safeParse(partial).success).toBe(false);
  });

  it('rejects a payload with a non-numeric temperature', () => {
    const broken = { ...valid, current: { ...valid.current, temperature_2m: 'warm' } };
    expect(openMeteoResponseSchema.safeParse(broken).success).toBe(false);
  });
});
