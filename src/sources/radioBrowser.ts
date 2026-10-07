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
import { parseRadioBrowserStations, type RawRadioBrowserStation } from './schemas';
import type { DiscoveryMeta, Station, StationDiscovery } from '../types/domain';
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
  /** Called as each page lands, for progressive rendering. */
  onPage?: (stations: readonly Station[], progress: PageProgress) => void;
}

/** Exactly what we cache per page, so a cache hit reports where the data came from. */
interface CachedPage {
  stations: Station[];
  endpoint: string;
  rejected: number;
  fetchedAt: number;
}

interface PageOutcome {
  stations: Station[];
  endpoint: string;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
  rejected: number;
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
 * Fetch and normalise the station directory as a sequence of cached pages.
 *
 * Resolves with whatever it managed to collect. `meta.failedPages` being
 * non-zero means the list is incomplete — the caller should say so rather than
 * pretend the globe is fully populated.
 */
export async function discoverStations(
  options: DiscoverStationsOptions = {},
): Promise<StationDiscovery> {
  const {
    maxStations = DEFAULT_MAX_STATIONS,
    pageSize = DEFAULT_PAGE_SIZE,
    concurrency = DEFAULT_CONCURRENCY,
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

  const totalPages = Math.max(1, Math.ceil(maxStations / pageSize));
  const offsets = Array.from({ length: totalPages }, (_, index) => index * pageSize);

  const byId = new Map<string, Station>();
  let failedPages = 0;
  let rejected = 0;
  let endpoint = '';
  let allFromCache = true;
  let anyStale = false;
  let fetchedAt = 0;
  let completed = 0;

  const loadPage = async (offset: number): Promise<PageOutcome> => {
    const cacheKey = `${CACHE_KEY_PREFIX}:limit=${pageSize}:offset=${offset}:geo=${String(geoOnly)}:hidebroken=${String(hideBroken)}`;
    const path = buildSearchPath({ limit: pageSize, offset, geoOnly, hideBroken });

    const result = await readThrough<CachedPage>({
      store,
      key: cacheKey,
      ttlMs,
      now,
      ...(onStaleFallback ? { onStaleFallback } : {}),
      load: async () => {
        const response = await fetchJsonFromMirrors({
          mirrors,
          path,
          ...(signal ? { signal } : {}),
          timeoutMs,
          attemptsPerMirror,
          ...(onAttemptError ? { onAttemptError } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(sleep ? { sleep } : {}),
        });

        const parsed = parseRadioBrowserStations(response.body);
        return {
          stations: parsed.stations.map(toStation).filter((station) => station.streamUrl !== ''),
          endpoint: response.endpoint,
          rejected: parsed.rejected,
          fetchedAt: now(),
        };
      },
    });

    return {
      stations: result.value.stations,
      endpoint: result.value.endpoint,
      fromCache: result.fromCache,
      stale: result.stale,
      fetchedAt: result.value.fetchedAt,
      rejected: result.value.rejected,
    };
  };

  await mapWithConcurrency(offsets, concurrency, async (offset) => {
    let outcome: PageOutcome;
    try {
      outcome = await loadPage(offset);
    } catch (error) {
      // One dead page must not sink the load. Aborting, however, is terminal.
      if (signal?.aborted) throw error;
      failedPages += 1;
      completed += 1;
      onPage?.([...byId.values()], { loaded: byId.size, target: maxStations, failed: failedPages });
      return;
    }

    for (const station of outcome.stations) {
      if (!byId.has(station.id)) byId.set(station.id, station);
    }

    if (endpoint === '') endpoint = outcome.endpoint;
    allFromCache = allFromCache && outcome.fromCache;
    anyStale = anyStale || outcome.stale;
    fetchedAt = Math.max(fetchedAt, outcome.fetchedAt);
    rejected += outcome.rejected;
    completed += 1;

    onPage?.([...byId.values()], { loaded: byId.size, target: maxStations, failed: failedPages });
  });

  // Every page failed and we collected nothing — that is a real failure.
  if (completed > 0 && completed === failedPages) {
    throw new SourceError('no-mirror', `All ${failedPages} page(s) failed`);
  }

  const stations = [...byId.values()].sort(compareStations).slice(0, maxStations);

  const meta: DiscoveryMeta = {
    sourceId: SOURCE_ID,
    endpoint,
    fromCache: allFromCache,
    stale: anyStale,
    fetchedAt,
    failedPages,
    totalPages,
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
