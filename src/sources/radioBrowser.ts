/**
 * Radio Browser source.
 *
 * The directory is a free, key-less, community-maintained database of internet
 * radio stations (measured 2026-10-07: 60,505 stations, 7,147 of them broken,
 * across 241 countries).
 *
 * ## Two uncomfortable facts this module is built around
 *
 * **1. Only ~17% of the directory is geolocated**, and coverage is wildly uneven
 * — dense across Europe and North America, sparse across Africa and Central
 * Asia. `Station.geo` is nullable and `geoOnly` defaults to true because the MVP
 * draws pins on a globe.
 *
 * **2. The service is slow and the network is worse.** Measured from this machine
 * on 2026-10-07: a 250-row page (~317 KB) took 14–29s; the same 300-row request
 * took 4s once and 25s another time. A 3000-row request never completed inside
 * 120s. Four of the five documented mirrors were unreachable entirely
 * (`HTTP 000`); only `de1` answered.
 *
 * So: **one big request is not an option.** We fetch small pages, cache each page
 * independently for 24h, fetch a few in parallel, and hand results to the caller
 * as they land so pins can appear progressively. A partial result beats a failed
 * one, so pages that fail are counted and reported rather than sinking the load.
 */

import { readThrough, createDefaultStore, DEFAULT_TTL_MS, type KeyValueStore } from './cache';
import { fetchJsonFromMirrors, type HttpDeps } from './http';
import {
  parseRadioBrowserCountries,
  parseRadioBrowserStations,
  type RawRadioBrowserStation,
} from './schemas';
import type { Country, DiscoveryMeta, Station, StationDiscovery } from '../types/domain';
import type { AudioStreamPayload, DiscoverContext, GeoPoint, Source } from '../types/source';
import { SourceError } from '../types/source';

export const SOURCE_ID = 'radio-browser';

/**
 * Tried in order.
 *
 * The official guidance is to hit `all` first, because it is a DNS round-robin
 * across the named nodes. Measured from this network, `all` hangs until the
 * timeout while `de1` answers — and the other named nodes fail *fast* (under
 * 1.5s) when unreachable. Concrete hosts that fail fast beat a round-robin that
 * hangs, so `de1` leads and `all` stays last for networks where it does resolve.
 */
export const RADIO_BROWSER_MIRRORS: readonly string[] = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];

/** Rows per request. Large pages are dramatically less reliable. */
export const DEFAULT_PAGE_SIZE = 250;
/** Total stations to assemble. */
export const DEFAULT_MAX_STATIONS = 1000;
/**
 * Pages in flight at once — **one**.
 *
 * Measured 2026-10-07: with 3 pages in flight, exactly one completed and the
 * other three timed out; run sequentially, every page succeeded. Upstream (or
 * the path to it) throttles concurrent connections, so parallelism here does not
 * buy throughput, it only buys failures.
 */
export const DEFAULT_CONCURRENCY = 1;
/** A page is ~320 KB and took 14–29s measured. 10s is not enough. */
export const DEFAULT_PAGE_TIMEOUT_MS = 45_000;

export const CACHE_KEY_PREFIX = 'radio-browser:page';
export const CACHE_KEY_COUNTRIES = 'radio-browser:countries';
export const CACHE_KEY_COUNTRY_PREFIX = 'radio-browser:country';

/**
 * By-country selection defaults.
 *
 * Measured 2026-10-07: a 20-row, single-country request is ~25 KB and takes
 * 1.3–4.1s, against ~30s for a 250-row global page. So asking 80 countries for
 * 20 stations each is roughly the same wall-clock cost as the global paging it
 * replaces — while guaranteeing that the globe is populated everywhere instead
 * of only where internet radio happens to be popular.
 */
export const DEFAULT_COUNTRY_COUNT = 80;
export const DEFAULT_PER_COUNTRY = 20;
/**
 * Countries in flight at once.
 *
 * Higher than the global page concurrency (1) because these responses are an
 * order of magnitude smaller: the throttling that made parallel large pages fail
 * does not bite at 25 KB.
 */
export const DEFAULT_COUNTRY_CONCURRENCY = 3;

/**
 * How the directory is sampled.
 *
 * - `top` — highest-voted stations overall. Fast and reliable, but the result is
 *   a Europe/US blob: the directory itself is skewed, so no sort order fixes it.
 * - `by-country` — a fixed quota per country. Slower and more requests, but the
 *   globe ends up genuinely covered.
 */
export type StationSelection = 'top' | 'by-country';

export interface PageProgress {
  loaded: number;
  target: number;
  failed: number;
}

export interface DiscoverStationsOptions extends HttpDeps {
  /** Total stations to assemble across all pages. */
  maxStations?: number;
  /** Rows per request. */
  pageSize?: number;
  /** Pages fetched in parallel. */
  concurrency?: number;
  /** Which stations to keep. Defaults to `top`. */
  selection?: StationSelection;
  /** `by-country`: how many countries to sample. */
  countryCount?: number;
  /** `by-country`: how many stations to take from each. */
  perCountry?: number;
  /** `by-country`: how many country requests to run at once. */
  countryConcurrency?: number;
  /** Ask the API for geolocated stations only. Default true. */
  geoOnly?: boolean;
  /** Exclude stations whose last health check failed. Default true. */
  hideBroken?: boolean;
  signal?: AbortSignal;
  store?: KeyValueStore;
  ttlMs?: number;
  mirrors?: readonly string[];
  now?: () => number;
  timeoutMs?: number;
  attemptsPerMirror?: number;
  onAttemptError?: (endpoint: string, attempt: number, error: unknown) => void;
  onStaleFallback?: (error: unknown) => void;
  /** Called as each page or country lands, for progressive rendering. */
  onPage?: (stations: readonly Station[], progress: PageProgress) => void;
}

function buildSearchPath(options: {
  limit: number;
  offset: number;
  geoOnly: boolean;
  hideBroken: boolean;
}): string {
  const params = new URLSearchParams({
    order: 'votes',
    reverse: 'true',
    limit: String(options.limit),
    offset: String(options.offset),
  });
  if (options.geoOnly) params.set('has_geo_info', 'true');
  if (options.hideBroken) params.set('hidebroken', 'true');
  return `/json/stations/search?${params.toString()}`;
}

function buildCountryPath(options: {
  countryCode: string;
  limit: number;
  geoOnly: boolean;
  hideBroken: boolean;
}): string {
  const params = new URLSearchParams({
    order: 'votes',
    reverse: 'true',
    limit: String(options.limit),
    offset: '0',
    countrycode: options.countryCode,
  });
  if (options.geoOnly) params.set('has_geo_info', 'true');
  if (options.hideBroken) params.set('hidebroken', 'true');
  return `/json/stations/search?${params.toString()}`;
}

/**
 * `(0, 0)` is in the Gulf of Guinea and is effectively never a real broadcast
 * location — in this dataset it is the "coordinates missing" sentinel.
 */
function toGeoPoint(lat: number | null, lng: number | null): GeoPoint | null {
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

export function toStation(raw: RawRadioBrowserStation): Station {
  const homepage = raw.homepage.trim();
  const faviconUrl = raw.favicon.trim();
  const region = raw.state.trim();
  const language = raw.language.trim();

  return {
    id: raw.stationuuid,
    name: raw.name.trim() || 'Unknown station',
    // `url_resolved` is the post-redirect URL; fall back to `url` for older records.
    streamUrl: (raw.url_resolved || raw.url).trim(),
    ...(homepage ? { homepage } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    tags: splitTags(raw.tags),
    country: raw.country.trim(),
    countryCode: raw.countrycode.trim().toUpperCase(),
    ...(region ? { region } : {}),
    ...(language ? { language } : {}),
    votes: raw.votes,
    codec: raw.codec.trim(),
    bitrate: raw.bitrate,
    hls: raw.hls,
    healthy: raw.lastcheckok,
    geo: toGeoPoint(raw.geo_lat, raw.geo_long),
  };
}

/** Deterministic ordering, independent of which mirror answered. */
function compareStations(a: Station, b: Station): number {
  return b.votes - a.votes || a.id.localeCompare(b.id);
}

/**
 * Run `run` over `items` with at most `limit` in flight.
 *
 * Results come back in completion order, not input order — which is what we want
 * for progressive rendering, and harmless because the caller sorts at the end.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results.push(await run(item, index));
    }
  };

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/**
 * Fetch and normalise the station directory.
 *
 * Two selection strategies, sharing one aggregation path:
 *
 * - `top`: page through the globally highest-voted stations.
 * - `by-country`: ask each of the N largest countries for its top K. More
 *   requests, but the pins end up spread across the globe rather than piled into
 *   Europe and North America.
 *
 * Resolves with whatever it managed to collect. `meta.failedPages` being
 * non-zero means the list is incomplete — the caller should say so rather than
 * pretend the globe is fully populated.
 */
/**
 * Everything the page and country loaders need, resolved once.
 *
 * Threading a dozen options through every helper would be worse than one object
 * that is built in exactly one place.
 */
interface FetchContext {
  store: KeyValueStore;
  mirrors: readonly string[];
  ttlMs: number;
  now: () => number;
  timeoutMs: number;
  attemptsPerMirror: number;
  perCountry: number;
  geoOnly: boolean;
  hideBroken: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onAttemptError?: (endpoint: string, attempt: number, error: unknown) => void;
  onStaleFallback?: (error: unknown) => void;
}

/** The shared shape of one HTTP-backed unit of work. */
interface FetchOutcome {
  stations: Station[];
  /** Records dropped during parsing because they had no usable identity. */
  rejected: number;
  endpoint: string;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
}

function httpArgs(ctx: FetchContext, path: string): Parameters<typeof fetchJsonFromMirrors>[0] {
  return {
    mirrors: ctx.mirrors,
    path,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    timeoutMs: ctx.timeoutMs,
    attemptsPerMirror: ctx.attemptsPerMirror,
    ...(ctx.onAttemptError ? { onAttemptError: ctx.onAttemptError } : {}),
    ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    ...(ctx.sleep ? { sleep: ctx.sleep } : {}),
  };
}

function normaliseStations(raw: unknown): { stations: Station[]; rejected: number } {
  const parsed = parseRadioBrowserStations(raw);
  return {
    stations: parsed.stations.map(toStation).filter((station) => station.streamUrl !== ''),
    rejected: parsed.rejected,
  };
}

interface CachedCountryList {
  countries: Country[];
  endpoint: string;
  fetchedAt: number;
}

/**
 * The directory's country list, largest first.
 *
 * Cached separately from station data because it is small (14 KB) and changes
 * very slowly, and because every `by-country` load needs it first.
 */
async function loadCountryList(ctx: FetchContext): Promise<{
  countries: Country[];
  endpoint: string;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
}> {
  const result = await readThrough<CachedCountryList>({
    store: ctx.store,
    key: CACHE_KEY_COUNTRIES,
    ttlMs: ctx.ttlMs,
    now: ctx.now,
    ...(ctx.onStaleFallback ? { onStaleFallback: ctx.onStaleFallback } : {}),
    load: async () => {
      const response = await fetchJsonFromMirrors(httpArgs(ctx, '/json/countries'));
      const parsed = parseRadioBrowserCountries(response.body);

      const countries = parsed.countries
        .map((raw) => ({
          code: raw.iso_3166_1.trim().toUpperCase(),
          name: raw.name.trim() || raw.iso_3166_1.trim().toUpperCase(),
          stationCount: raw.stationcount,
        }))
        .filter((country) => country.code !== '')
        .sort((a, b) => b.stationCount - a.stationCount || a.code.localeCompare(b.code));

      if (countries.length === 0) {
        throw new SourceError('bad-response', 'Country list decoded to zero entries', {
          endpoint: response.endpoint,
        });
      }

      return { countries, endpoint: response.endpoint, fetchedAt: ctx.now() };
    },
  });

  return {
    countries: result.value.countries,
    endpoint: result.value.endpoint,
    fromCache: result.fromCache,
    stale: result.stale,
    fetchedAt: result.value.fetchedAt,
  };
}

/** One country's top stations, cached independently. */
async function loadCountryStations(countryCode: string, ctx: FetchContext): Promise<FetchOutcome> {
  const cacheKey = `${CACHE_KEY_COUNTRY_PREFIX}:${countryCode}:limit=${ctx.perCountry}:geo=${String(ctx.geoOnly)}:hidebroken=${String(ctx.hideBroken)}`;

  const result = await readThrough<{
    stations: Station[];
    rejected: number;
    endpoint: string;
    fetchedAt: number;
  }>({
    store: ctx.store,
    key: cacheKey,
    ttlMs: ctx.ttlMs,
    now: ctx.now,
    ...(ctx.onStaleFallback ? { onStaleFallback: ctx.onStaleFallback } : {}),
    load: async () => {
      const path = buildCountryPath({
        countryCode,
        limit: ctx.perCountry,
        geoOnly: ctx.geoOnly,
        hideBroken: ctx.hideBroken,
      });
      const response = await fetchJsonFromMirrors(httpArgs(ctx, path));
      const normalised = normaliseStations(response.body);
      return {
        stations: normalised.stations,
        rejected: normalised.rejected,
        endpoint: response.endpoint,
        fetchedAt: ctx.now(),
      };
    },
  });

  return {
    stations: result.value.stations,
    rejected: result.value.rejected,
    endpoint: result.value.endpoint,
    fromCache: result.fromCache,
    stale: result.stale,
    fetchedAt: result.value.fetchedAt,
  };
}

/** One page of the globally highest-voted stations, cached independently. */
async function loadPageByOffset(
  offset: number,
  pageSize: number,
  ctx: FetchContext,
): Promise<FetchOutcome> {
  const cacheKey = `${CACHE_KEY_PREFIX}:limit=${pageSize}:offset=${offset}:geo=${String(ctx.geoOnly)}:hidebroken=${String(ctx.hideBroken)}`;

  const result = await readThrough<{
    stations: Station[];
    rejected: number;
    endpoint: string;
    fetchedAt: number;
  }>({
    store: ctx.store,
    key: cacheKey,
    ttlMs: ctx.ttlMs,
    now: ctx.now,
    ...(ctx.onStaleFallback ? { onStaleFallback: ctx.onStaleFallback } : {}),
    load: async () => {
      const path = buildSearchPath({
        limit: pageSize,
        offset,
        geoOnly: ctx.geoOnly,
        hideBroken: ctx.hideBroken,
      });
      const response = await fetchJsonFromMirrors(httpArgs(ctx, path));
      const normalised = normaliseStations(response.body);
      return {
        stations: normalised.stations,
        rejected: normalised.rejected,
        endpoint: response.endpoint,
        fetchedAt: ctx.now(),
      };
    },
  });

  return {
    stations: result.value.stations,
    rejected: result.value.rejected,
    endpoint: result.value.endpoint,
    fromCache: result.fromCache,
    stale: result.stale,
    fetchedAt: result.value.fetchedAt,
  };
}

export async function discoverStations(
  options: DiscoverStationsOptions = {},
): Promise<StationDiscovery> {
  const {
    maxStations = DEFAULT_MAX_STATIONS,
    pageSize = DEFAULT_PAGE_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
    selection = 'top',
    countryCount = DEFAULT_COUNTRY_COUNT,
    perCountry = DEFAULT_PER_COUNTRY,
    countryConcurrency = DEFAULT_COUNTRY_CONCURRENCY,
    geoOnly = true,
    hideBroken = true,
    signal,
    store = createDefaultStore(),
    ttlMs = DEFAULT_TTL_MS,
    mirrors = RADIO_BROWSER_MIRRORS,
    now = Date.now,
    timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
    attemptsPerMirror = 1,
    onAttemptError,
    onStaleFallback,
    onPage,
    fetchImpl,
    sleep,
  } = options;

  const ctx: FetchContext = {
    store,
    mirrors,
    ttlMs,
    now,
    timeoutMs,
    attemptsPerMirror,
    perCountry,
    geoOnly,
    hideBroken,
    ...(signal ? { signal } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(sleep ? { sleep } : {}),
    ...(onAttemptError ? { onAttemptError } : {}),
    ...(onStaleFallback ? { onStaleFallback } : {}),
  };

  const byId = new Map<string, Station>();
  let failedUnits = 0;
  let rejected = 0;
  let endpoint = '';
  let allFromCache = true;
  let anyStale = false;
  let fetchedAt = 0;
  let completed = 0;
  // Assigned by whichever strategy runs; no initial value is ever read.
  let totalUnits: number;

  // The progress denominator differs by strategy: stations for one, countries
  // for the other.
  const target = selection === 'by-country' ? countryCount * perCountry : maxStations;

  const absorb = (outcome: FetchOutcome): void => {
    for (const station of outcome.stations) {
      if (!byId.has(station.id)) byId.set(station.id, station);
    }
    if (endpoint === '') endpoint = outcome.endpoint;
    allFromCache = allFromCache && outcome.fromCache;
    anyStale = anyStale || outcome.stale;
    fetchedAt = Math.max(fetchedAt, outcome.fetchedAt);
    rejected += outcome.rejected;
    completed += 1;
    onPage?.([...byId.values()], { loaded: byId.size, target, failed: failedUnits });
  };

  const recordFailure = (): void => {
    failedUnits += 1;
    completed += 1;
    onPage?.([...byId.values()], { loaded: byId.size, target, failed: failedUnits });
  };

  if (selection === 'by-country') {
    const list = await loadCountryList(ctx);
    // Fold the country list into the metadata but not into the progress count —
    // it is a lookup, not a unit of station data.
    endpoint = list.endpoint;
    allFromCache = list.fromCache;
    anyStale = list.stale;
    fetchedAt = Math.max(fetchedAt, list.fetchedAt);

    const chosen = list.countries.slice(0, countryCount);
    totalUnits = chosen.length;

    await mapWithConcurrency(chosen, countryConcurrency, async (country) => {
      try {
        absorb(await loadCountryStations(country.code, ctx));
      } catch (error) {
        // One dead country must not sink the load. Aborting is terminal.
        if (signal?.aborted) throw error;
        recordFailure();
      }
    });
  } else {
    const pages = Math.max(1, Math.ceil(maxStations / pageSize));
    totalUnits = pages;
    const offsets = Array.from({ length: pages }, (_, index) => index * pageSize);

    await mapWithConcurrency(offsets, concurrency, async (offset) => {
      try {
        absorb(await loadPageByOffset(offset, pageSize, ctx));
      } catch (error) {
        if (signal?.aborted) throw error;
        recordFailure();
      }
    });
  }

  // Every request failed and we collected nothing — that is a real failure.
  if (completed > 0 && completed === failedUnits) {
    throw new SourceError('no-mirror', `All ${failedUnits} request(s) failed`);
  }

  const stations = [...byId.values()].sort(compareStations).slice(0, maxStations);

  const meta: DiscoveryMeta = {
    sourceId: SOURCE_ID,
    endpoint,
    fromCache: allFromCache,
    stale: anyStale,
    fetchedAt,
    failedPages: failedUnits,
    totalPages: totalUnits,
    rejectedStations: rejected,
  };

  return { stations, meta };
}

function toAudioPayload(station: Station): AudioStreamPayload {
  return {
    type: 'audio-stream',
    sourceId: SOURCE_ID,
    url: station.streamUrl,
    codec: station.codec,
    bitrate: station.bitrate,
    title: station.name,
    hls: station.hls,
    ...(station.geo ? { origin: station.geo } : {}),
    label: station.name,
    attribution: 'Radio Browser',
  };
}

/**
 * The generic `Source` view of the directory.
 *
 * `requiresGeo: false` because the directory search is global — geo filtering is
 * applied internally via `geoOnly`. The manifest describes what the *caller*
 * must supply, not what the source happens to filter on.
 */
export function createRadioBrowserSource(
  options: DiscoverStationsOptions = {},
): Source<AudioStreamPayload> {
  return {
    manifest: {
      id: SOURCE_ID,
      name: 'Radio Browser',
      channels: ['audio'],
      requiresGeo: false,
      attribution: 'Radio Browser — radio-browser.info (community-maintained)',
    },
    async discover(ctx: DiscoverContext): Promise<AudioStreamPayload[]> {
      const discovery = await discoverStations({
        ...options,
        signal: ctx.signal,
        ...(ctx.limit !== undefined ? { maxStations: ctx.limit } : {}),
      });
      return discovery.stations.map(toAudioPayload);
    },
  };
}
