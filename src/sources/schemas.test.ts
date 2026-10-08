import { describe, expect, it } from 'vitest';
import {
  openMeteoResponseSchema,
  parseRadioBrowserCountries,
  parseRadioBrowserServers,
  parseRadioBrowserStations,
} from './schemas';

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

describe('parseRadioBrowserServers', () => {
  it('deduplicates the same host listed once per IP family', () => {
    const { hosts, rejected } = parseRadioBrowserServers([
      { name: 'de1.api.radio-browser.info', ip: '91.98.4.78' },
      { name: 'de1.api.radio-browser.info', ip: '2a01:4f8:1c1d:699::1' },
    ]);

    expect(hosts).toEqual(['de1.api.radio-browser.info']);
    expect(rejected).toBe(0);
  });

  it('skips entries with no host name', () => {
    const { hosts, rejected } = parseRadioBrowserServers([
      { name: '', ip: '1.2.3.4' },
      { ip: '1.2.3.4' },
      { name: 'ok.example', ip: '1.2.3.4' },
    ]);

    expect(hosts).toEqual(['ok.example']);
    expect(rejected).toBe(2);
  });

  it('lower-cases host names and trims whitespace', () => {
    const { hosts } = parseRadioBrowserServers([{ name: '  DE1.Example.COM  ', ip: '1.2.3.4' }]);
    expect(hosts).toEqual(['de1.example.com']);
  });

  it('returns nothing for a non-array body', () => {
    expect(parseRadioBrowserServers({ error: 'nope' })).toEqual({ hosts: [], rejected: 0 });
    expect(parseRadioBrowserServers(null)).toEqual({ hosts: [], rejected: 0 });
  });
});

describe('parseRadioBrowserCountries', () => {
  it('parses a country list', () => {
    const { countries, rejected } = parseRadioBrowserCountries([
      { name: 'Andorra', iso_3166_1: 'AD', stationcount: 12 },
      { name: 'Germany', iso_3166_1: 'DE', stationcount: 6482 },
    ]);

    expect(countries).toHaveLength(2);
    expect(countries[1]?.stationcount).toBe(6482);
    expect(rejected).toBe(0);
  });

  it('skips rows with no country code', () => {
    const { countries, rejected } = parseRadioBrowserCountries([
      { name: 'Nowhere', iso_3166_1: '', stationcount: 3 },
      { name: 'Somewhere', iso_3166_1: 'XX', stationcount: 3 },
    ]);

    expect(countries).toHaveLength(1);
    expect(rejected).toBe(1);
  });

  it('returns nothing for a non-array body', () => {
    expect(parseRadioBrowserCountries('nope')).toEqual({ countries: [], rejected: 0 });
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
