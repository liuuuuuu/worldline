/**
 * Domain models.
 *
 * These are the *native* shapes of our data — richer than `Payload`, which the
 * kernel deliberately keeps lean. Adapters map upstream responses into these,
 * then wrap them into `Payload` for the generic pipeline.
 *
 * Rule of thumb: if only one source cares about a field, it belongs here, not
 * in `Payload`.
 */

import type { GeoPoint } from './source';

/** A radio station, normalised across every Radio Browser mirror. */
export interface Station {
  /** `stationuuid` — stable across mirrors. Primary key. Never use `id`. */
  id: string;
  name: string;
  /** Resolved, directly playable URL. */
  streamUrl: string;
  homepage?: string;
  faviconUrl?: string;
  tags: readonly string[];
  country: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  region?: string;
  language?: string;
  votes: number;
  codec: string;
  /** kbps, 0 when unreported. */
  bitrate: number;
  hls: boolean;
  /** Upstream health check result. */
  healthy: boolean;
  /**
   * `null` when the station has no coordinates.
   *
   * This is the common case: only ~17% of the directory is geolocated, and the
   * coverage is wildly uneven (dense in Europe and North America, sparse across
   * Africa and Central Asia). Any UI that assumes every station has a pin is
   * lying to the user.
   */
  geo: GeoPoint | null;
}

/** How a payload list was obtained. Surfaced in the UI and in PROGRESS.md. */
export interface DiscoveryMeta {
  sourceId: string;
  /** Which mirror actually answered. */
  endpoint: string;
  fromCache: boolean;
  /** Live request failed and we served a stale cache entry instead. */
  stale: boolean;
  /** Epoch ms. */
  fetchedAt: number;
  /**
   * Pages that failed to load. Non-zero means the list is incomplete and the UI
   * should say so — upstream is slow enough that partial results are normal.
   */
  failedPages?: number;
  totalPages?: number;
  /**
   * Records dropped during parsing because they had no usable identity.
   *
   * Surfaced rather than swallowed: a sudden spike means upstream changed shape,
   * which is exactly the failure mode schema validation exists to catch.
   */
  rejectedStations?: number;
}

export interface StationDiscovery {
  stations: readonly Station[];
  meta: DiscoveryMeta;
}

/** Coarse weather bucket, derived from a WMO code. */
export type WeatherKind =
  | 'clear'
  | 'mostly-clear'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export interface WeatherSnapshot {
  temperatureC: number;
  windKph: number;
  kind: WeatherKind;
  isDay: boolean;
  /** Raw WMO code, kept for tooltips and debugging. */
  weatherCode: number;
  /** IANA zone name, e.g. `Asia/Tokyo`. */
  timezone: string;
  /** Seconds east of UTC. */
  utcOffsetSeconds: number;
  /** Wall-clock time at the location, `YYYY-MM-DDTHH:mm`. */
  observedAtLocal: string;
}

export interface WeatherResult {
  weather: WeatherSnapshot;
  meta: DiscoveryMeta;
}

/** Rendered local time at a place. */
export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Localised weekday name. */
  weekday: string;
  /** e.g. `GMT+9`. */
  offsetLabel: string;
  /** `2026-10-07 21:00`. */
  display: string;
}
