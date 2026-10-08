/**
 * Runtime schemas for every upstream API response.
 *
 * Why this exists: Radio Browser and Open-Meteo are third-party services whose
 * fields can change without notice. Without validation a renamed field silently
 * becomes `undefined` and the bug surfaces three layers away in the UI. Every
 * response crosses one of these schemas first.
 *
 * Leniency is deliberate but uneven:
 *   - Radio Browser is a messy community database, so field-level `.catch()`
 *     defaults are used for everything except the identity field.
 *   - Open-Meteo is a well-typed service, so its schema is strict — if it
 *     changes shape we want to know immediately.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Shared field coercions
 * ------------------------------------------------------------------ */

/** Number | numeric string | null | undefined → number | null. */
const looseNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  })
  .catch(null);

/** Anything → integer, defaulting to 0. */
const looseInt = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
  })
  .catch(0);

/** Anything → string, defaulting to `''`. */
const looseString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
  })
  .catch('');

/** `1` / `true` / `"1"` → true; everything else → false. */
const looseFlag = z
  .union([z.number(), z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((value) => value === 1 || value === true || value === '1' || value === 'true')
  .catch(false);

/* ------------------------------------------------------------------ *
 * Radio Browser
 * ------------------------------------------------------------------ */

/**
 * One station as returned by `/json/stations/search`.
 *
 * Only `stationuuid` is required — it is the primary key and a station without
 * one cannot be addressed across mirrors. Every other field degrades to a
 * sensible default rather than rejecting the whole record.
 */
export const radioBrowserStationSchema = z.object({
  stationuuid: z.string().min(1),
  name: looseString,
  url: looseString,
  url_resolved: looseString,
  homepage: looseString,
  favicon: looseString,
  tags: looseString,
  country: looseString,
  countrycode: looseString,
  state: looseString,
  language: looseString,
  votes: looseInt,
  codec: looseString,
  bitrate: looseInt,
  hls: looseFlag,
  lastcheckok: looseFlag,
  geo_lat: looseNumber,
  geo_long: looseNumber,
});

export type RawRadioBrowserStation = z.infer<typeof radioBrowserStationSchema>;

export const radioBrowserCountrySchema = z.object({
  name: looseString,
  iso_3166_1: looseString,
  stationcount: looseInt,
});

export type RawRadioBrowserCountry = z.infer<typeof radioBrowserCountrySchema>;

/**
 * `/json/servers` entries.
 *
 * The live node list, which turns out to be much shorter than the documented
 * mirror list — measured 2026-10-07 it returned a single host (`de1`) twice, once
 * per IP family. So the named mirrors in our fallback list are not "blocked from
 * this network", they are gone.
 */
export const radioBrowserServerSchema = z.object({
  name: looseString,
  ip: looseString,
});

export function parseRadioBrowserServers(raw: unknown): { hosts: string[]; rejected: number } {
  if (!Array.isArray(raw)) return { hosts: [], rejected: 0 };

  const hosts: string[] = [];
  let rejected = 0;

  for (const item of raw) {
    const parsed = radioBrowserServerSchema.safeParse(item);
    if (!parsed.success || parsed.data.name.trim() === '') {
      rejected += 1;
      continue;
    }
    const host = parsed.data.name.trim().toLowerCase();
    // The same host appears once per IP family; dedupe by name.
    if (!hosts.includes(host)) hosts.push(host);
  }

  return { hosts, rejected };
}

export interface ParsedCountries {
  countries: RawRadioBrowserCountry[];
  rejected: number;
}

/** Parse `/json/countries`, skipping rows with no usable country code. */
export function parseRadioBrowserCountries(raw: unknown): ParsedCountries {
  if (!Array.isArray(raw)) {
    return { countries: [], rejected: 0 };
  }

  const countries: RawRadioBrowserCountry[] = [];
  let rejected = 0;

  for (const item of raw) {
    const parsed = radioBrowserCountrySchema.safeParse(item);
    if (parsed.success && parsed.data.iso_3166_1.trim() !== '') {
      countries.push(parsed.data);
    } else {
      rejected += 1;
    }
  }

  return { countries, rejected };
}

export interface ParsedStations {
  stations: RawRadioBrowserStation[];
  /** Records dropped because they had no usable `stationuuid`. */
  rejected: number;
}

/**
 * Parse a station list, skipping unaddressable records instead of failing the
 * whole batch. The reject count is returned rather than swallowed so callers can
 * surface it — a sudden spike means upstream changed shape.
 */
export function parseRadioBrowserStations(raw: unknown): ParsedStations {
  if (!Array.isArray(raw)) {
    return { stations: [], rejected: 0 };
  }

  const stations: RawRadioBrowserStation[] = [];
  let rejected = 0;

  for (const item of raw) {
    const parsed = radioBrowserStationSchema.safeParse(item);
    if (parsed.success) {
      stations.push(parsed.data);
    } else {
      rejected += 1;
    }
  }

  return { stations, rejected };
}

/* ------------------------------------------------------------------ *
 * Open-Meteo
 * ------------------------------------------------------------------ */

export const openMeteoResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string().optional(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    weather_code: z.number(),
    is_day: z.number(),
    wind_speed_10m: z.number(),
  }),
});

export type RawOpenMeteoResponse = z.infer<typeof openMeteoResponseSchema>;
