import { describe, expect, it, vi } from 'vitest';
import {
  buildForecastPath,
  classifyWeatherCode,
  createWeatherSource,
  fetchWeather,
  SOURCE_ID,
  toWeatherPayload,
} from './weather';
import { createMemoryStore } from './cache';
import { SourceError } from '../types/source';
import type { WeatherKind } from '../types/domain';

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

const OPEN_METEO_BODY = {
  latitude: 35.7,
  longitude: 139.6875,
  utc_offset_seconds: 32400,
  timezone: 'Asia/Tokyo',
  timezone_abbreviation: 'GMT+9',
  elevation: 38,
  current_units: { temperature_2m: '°C' },
  current: {
    time: '2026-10-07T21:00',
    interval: 900,
    temperature_2m: 18,
    weather_code: 0,
    is_day: 0,
    wind_speed_10m: 4.3,
  },
};

/**
 * A fresh store per test. Sharing one would let an earlier test's cached
 * response satisfy a later test and hide the behaviour under test.
 */
function baseOptions() {
  return {
    store: createMemoryStore(),
    mirrors: ['https://api.open-meteo.com'],
    sleep: () => Promise.resolve(),
    attemptsPerMirror: 1,
    now: () => 1_000,
  };
}

describe('classifyWeatherCode', () => {
  const cases: ReadonlyArray<readonly [number, WeatherKind]> = [
    [0, 'clear'],
    [1, 'mostly-clear'],
    [2, 'cloudy'],
    [3, 'overcast'],
    [45, 'fog'],
    [48, 'fog'],
    [51, 'drizzle'],
    [55, 'drizzle'],
    [57, 'drizzle'],
    [61, 'rain'],
    [65, 'rain'],
    [67, 'rain'],
    [80, 'rain'],
    [82, 'rain'],
    [71, 'snow'],
    [75, 'snow'],
    [77, 'snow'],
    [85, 'snow'],
    [86, 'snow'],
    [95, 'thunderstorm'],
    [99, 'thunderstorm'],
  ];

  it.each(cases)('maps WMO %i to %s', (code, expected) => {
    expect(classifyWeatherCode(code)).toBe(expected);
  });

  it('does not force unmapped codes into a wrong bucket', () => {
    expect(classifyWeatherCode(7)).toBe('unknown');
    expect(classifyWeatherCode(-1)).toBe('unknown');
    expect(classifyWeatherCode(200)).toBe('unknown');
  });
});

describe('buildForecastPath', () => {
  it('requests exactly the fields the schema validates', () => {
    const params = new URL(buildForecastPath(35.68, 139.69), 'https://x').searchParams;

    expect(params.get('current')).toBe('temperature_2m,weather_code,is_day,wind_speed_10m');
    expect(params.get('timezone')).toBe('auto');
    expect(params.get('latitude')).toBe('35.6800');
    expect(params.get('longitude')).toBe('139.6900');
  });
});

describe('fetchWeather', () => {
  it('returns a normalised snapshot', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(OPEN_METEO_BODY));

    const { weather, meta } = await fetchWeather(35.68, 139.69, { ...baseOptions(), fetchImpl });

    expect(weather.temperatureC).toBe(18);
    expect(weather.windKph).toBe(4.3);
    expect(weather.kind).toBe('clear');
    expect(weather.isDay).toBe(false);
    expect(weather.weatherCode).toBe(0);
    expect(weather.timezone).toBe('Asia/Tokyo');
    expect(weather.utcOffsetSeconds).toBe(32400);
    expect(weather.observedAtLocal).toBe('2026-10-07T21:00');
    expect(meta.sourceId).toBe(SOURCE_ID);
    expect(meta.fromCache).toBe(false);
  });

  it('treats is_day 1 as daytime', async () => {
    const body = { ...OPEN_METEO_BODY, current: { ...OPEN_METEO_BODY.current, is_day: 1 } };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(body));

    const { weather } = await fetchWeather(35.68, 139.69, { ...baseOptions(), fetchImpl });

    expect(weather.isDay).toBe(true);
  });

  it('caches by rounded coordinate so a city shares one entry', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(OPEN_METEO_BODY));
    const store = createMemoryStore();

    await fetchWeather(35.6812, 139.6917, { ...baseOptions(), store, fetchImpl });
    const second = await fetchWeather(35.6849, 139.6881, { ...baseOptions(), store, fetchImpl });

    expect(second.meta.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a response that does not match the schema', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse({ timezone: 'Asia/Tokyo' }));

    const error = await fetchWeather(35.68, 139.69, { ...baseOptions(), fetchImpl }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('bad-response');
  });

  it('refuses a non-numeric coordinate instead of querying nonsense', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchWeather(Number.NaN, 139.69, { ...baseOptions(), fetchImpl }),
    ).rejects.toBeInstanceOf(SourceError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to stale data when the live request fails', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse(OPEN_METEO_BODY))
      .mockRejectedValue(new Error('down'));
    const onStaleFallback = vi.fn();

    await fetchWeather(35.68, 139.69, { ...baseOptions(), store, fetchImpl });
    const later = await fetchWeather(35.68, 139.69, {
      ...baseOptions(),
      store,
      fetchImpl,
      now: () => 1_000 + 60 * 60 * 1000,
      onStaleFallback,
    });

    expect(later.meta.stale).toBe(true);
    expect(later.weather.temperatureC).toBe(18);
    expect(onStaleFallback).toHaveBeenCalled();
  });
});

describe('toWeatherPayload', () => {
  it('flattens the snapshot into a primitive meta bag', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(OPEN_METEO_BODY));
    const { weather } = await fetchWeather(35.68, 139.69, { ...baseOptions(), fetchImpl });

    const payload = toWeatherPayload(weather);

    expect(payload.type).toBe('meta');
    expect(payload.kind).toBe('weather');
    expect(payload.sourceId).toBe(SOURCE_ID);
    expect(payload.data).toEqual({
      temperatureC: 18,
      windKph: 4.3,
      kind: 'clear',
      isDay: false,
      weatherCode: 0,
      timezone: 'Asia/Tokyo',
      utcOffsetSeconds: 32400,
    });
  });
});

describe('createWeatherSource', () => {
  it('requires a coordinate, because weather without one is meaningless', () => {
    const source = createWeatherSource();

    expect(source.manifest.channels).toEqual(['meta']);
    expect(source.manifest.requiresGeo).toBe(true);
  });

  it('returns nothing when the kernel calls it without a geo', async () => {
    const source = createWeatherSource();

    const payloads = await source.discover({
      locale: 'zh-CN',
      signal: new AbortController().signal,
    });

    expect(payloads).toEqual([]);
  });

  it('produces one meta payload for a coordinate', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse(OPEN_METEO_BODY));
    const source = createWeatherSource({
      store: createMemoryStore(),
      mirrors: ['https://api.open-meteo.com'],
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    const payloads = await source.discover({
      geo: { lat: 35.68, lng: 139.69 },
      locale: 'zh-CN',
      signal: new AbortController().signal,
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('weather');
    expect(payloads[0]?.data.temperatureC).toBe(18);
  });
});
