/**
 * Weather + timezone source, backed by Open-Meteo.
 *
 * Chosen because a single key-less request returns both the current conditions
 * and the place's IANA timezone name *and* its UTC offset — so one call covers
 * the whole "时空层" (local time, daylight, weather) for a coordinate. No
 * separate timezone lookup is needed anywhere in the app.
 *
 * Measured 2026-10-07: no API key, CORS enabled.
 */

import { readThrough, createDefaultStore, type KeyValueStore } from './cache';
import { fetchJsonFromMirrors, type HttpDeps } from './http';
import { openMeteoResponseSchema } from './schemas';
import type { DiscoveryMeta, WeatherKind, WeatherResult, WeatherSnapshot } from '../types/domain';
import type { DiscoverContext, MetaPayload, Source } from '../types/source';
import { SourceError } from '../types/source';

export const SOURCE_ID = 'open-meteo';
export const OPEN_METEO_MIRRORS: readonly string[] = ['https://api.open-meteo.com'];

/** Weather is far more volatile than the station directory. */
export const WEATHER_TTL_MS = 10 * 60 * 1000;

export interface FetchWeatherOptions extends HttpDeps {
  signal?: AbortSignal;
  store?: KeyValueStore;
  ttlMs?: number;
  mirrors?: readonly string[];
  now?: () => number;
  timeoutMs?: number;
  attemptsPerMirror?: number;
  onStaleFallback?: (error: unknown) => void;
}

/**
 * Map a WMO weather code onto a coarse bucket.
 *
 * The full code list is 28 entries; the UI needs about nine. Anything unmapped
 * becomes `unknown` rather than being forced into a wrong bucket.
 */
export function classifyWeatherCode(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly-clear';
  if (code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunderstorm';
  return 'unknown';
}

export function buildForecastPath(lat: number, lng: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
    timezone: 'auto',
  });
  return `/v1/forecast?${params.toString()}`;
}

function cacheKeyFor(lat: number, lng: number): string {
  // ~1km buckets: two nearby stations in the same city share one entry.
  return `open-meteo:current:${lat.toFixed(2)}:${lng.toFixed(2)}`;
}

interface CachedWeather {
  weather: WeatherSnapshot;
  endpoint: string;
  fetchedAt: number;
}

/**
 * Current conditions and timezone for a coordinate.
 *
 * Cached for 10 minutes — long enough to avoid hammering the API while dragging
 * across a globe, short enough that the temperature is still true.
 */
export async function fetchWeather(
  lat: number,
  lng: number,
  options: FetchWeatherOptions = {},
): Promise<WeatherResult> {
  const {
    signal,
    store = createDefaultStore(),
    ttlMs = WEATHER_TTL_MS,
    mirrors = OPEN_METEO_MIRRORS,
    now = Date.now,
    timeoutMs,
    attemptsPerMirror,
    onStaleFallback,
    fetchImpl,
    sleep,
  } = options;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new SourceError('bad-response', `Invalid coordinate: ${String(lat)}, ${String(lng)}`);
  }

  const result = await readThrough<CachedWeather>({
    store,
    key: cacheKeyFor(lat, lng),
    ttlMs,
    now,
    ...(onStaleFallback ? { onStaleFallback } : {}),
    load: async () => {
      const response = await fetchJsonFromMirrors({
        mirrors,
        path: buildForecastPath(lat, lng),
        ...(signal ? { signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(attemptsPerMirror !== undefined ? { attemptsPerMirror } : {}),
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(sleep ? { sleep } : {}),
      });

      const parsed = openMeteoResponseSchema.safeParse(response.body);
      if (!parsed.success) {
        throw new SourceError('bad-response', 'Open-Meteo response did not match the schema', {
          endpoint: response.endpoint,
          cause: parsed.error,
        });
      }

      const { current } = parsed.data;
      const weather: WeatherSnapshot = {
        temperatureC: current.temperature_2m,
        windKph: current.wind_speed_10m,
        kind: classifyWeatherCode(current.weather_code),
        isDay: current.is_day === 1,
        weatherCode: current.weather_code,
        timezone: parsed.data.timezone,
        utcOffsetSeconds: parsed.data.utc_offset_seconds,
        observedAtLocal: current.time,
      };

      return { weather, endpoint: response.endpoint, fetchedAt: now() };
    },
  });

  const meta: DiscoveryMeta = {
    sourceId: SOURCE_ID,
    endpoint: result.value.endpoint,
    fromCache: result.fromCache,
    stale: result.stale,
    fetchedAt: result.value.fetchedAt,
  };

  return { weather: result.value.weather, meta };
}

/** Flatten a snapshot into the primitive bag a `MetaPayload` carries. */
export function toWeatherPayload(weather: WeatherSnapshot): MetaPayload {
  return {
    type: 'meta',
    kind: 'weather',
    sourceId: SOURCE_ID,
    label: weather.timezone,
    attribution: 'Open-Meteo',
    data: {
      temperatureC: weather.temperatureC,
      windKph: weather.windKph,
      kind: weather.kind,
      isDay: weather.isDay,
      weatherCode: weather.weatherCode,
      timezone: weather.timezone,
      utcOffsetSeconds: weather.utcOffsetSeconds,
    },
  };
}

/**
 * The generic `Source` view.
 *
 * `requiresGeo: true` — weather is meaningless without a coordinate, so the
 * kernel must refuse to call `discover()` without one.
 */
export function createWeatherSource(options: FetchWeatherOptions = {}): Source<MetaPayload> {
  return {
    manifest: {
      id: SOURCE_ID,
      name: 'Open-Meteo',
      channels: ['meta'],
      requiresGeo: true,
      attribution: 'Open-Meteo — open-meteo.com (CC BY 4.0)',
    },
    async discover(ctx: DiscoverContext): Promise<MetaPayload[]> {
      if (!ctx.geo) return [];
      const { weather } = await fetchWeather(ctx.geo.lat, ctx.geo.lng, {
        ...options,
        signal: ctx.signal,
      });
      return [toWeatherPayload(weather)];
    },
  };
}
