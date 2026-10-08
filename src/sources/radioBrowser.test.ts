import { describe, expect, it, vi } from 'vitest';
import {
  createRadioBrowserSource,
  discoverStations,
  RADIO_BROWSER_MIRRORS,
  SOURCE_ID,
  toStation,
} from './radioBrowser';
import { createMemoryStore } from './cache';
import { parseRadioBrowserStations } from './schemas';
import { SourceError } from '../types/source';

const noSleep = () => Promise.resolve();

function rawStation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: 'uuid-1',
    name: 'Radio Paradise',
    url: 'http://stream.example/a',
    url_resolved: 'http://stream.example/a',
    homepage: 'https://radioparadise.com/',
    favicon: 'https://radioparadise.com/icon.png',
    tags: 'california, Eclectic ,free',
    country: 'The United States Of America',
    countrycode: 'us',
    state: 'California',
    language: 'english',
    votes: 318772,
    codec: 'AAC',
    bitrate: 320,
    hls: 0,
    lastcheckok: 1,
    geo_lat: 34.05,
    geo_long: -118.24,
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** `fetch` accepts a string, a `URL`, or a `Request`; we always pass a string. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function rawFrom(overrides: Record<string, unknown>): ReturnType<typeof parseRadioBrowserStations> {
  return parseRadioBrowserStations([rawStation(overrides)]);
}

function firstStation(overrides: Record<string, unknown> = {}) {
  const { stations } = rawFrom(overrides);
  const station = stations[0];
  if (!station) throw new Error('fixture produced no station');
  return toStation(station);
}

describe('toStation', () => {
  it('maps a full record', () => {
    const station = firstStation();

    expect(station.id).toBe('uuid-1');
    expect(station.name).toBe('Radio Paradise');
    expect(station.streamUrl).toBe('http://stream.example/a');
    expect(station.homepage).toBe('https://radioparadise.com/');
    expect(station.countryCode).toBe('US');
    expect(station.region).toBe('California');
    expect(station.votes).toBe(318772);
    expect(station.codec).toBe('AAC');
    expect(station.bitrate).toBe(320);
    expect(station.hls).toBe(false);
    expect(station.healthy).toBe(true);
    expect(station.geo).toEqual({ lat: 34.05, lng: -118.24 });
  });

  it('normalises tags into a lower-case, trimmed list', () => {
    expect(firstStation().tags).toEqual(['california', 'eclectic', 'free']);
  });

  it('treats (0, 0) as "no coordinates"', () => {
    expect(firstStation({ geo_lat: 0, geo_long: 0 }).geo).toBeNull();
  });

  it('treats missing coordinates as null', () => {
    expect(firstStation({ geo_lat: null, geo_long: null }).geo).toBeNull();
    expect(firstStation({ geo_lat: 34.05, geo_long: null }).geo).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    expect(firstStation({ geo_lat: 999, geo_long: 10 }).geo).toBeNull();
    expect(firstStation({ geo_lat: 10, geo_long: -999 }).geo).toBeNull();
  });

  it('falls back to `url` when `url_resolved` is empty', () => {
    expect(firstStation({ url_resolved: '', url: 'http://legacy.example/s' }).streamUrl).toBe(
      'http://legacy.example/s',
    );
  });

  it('omits optional fields rather than storing empty strings', () => {
    const station = firstStation({ homepage: '', favicon: '', state: '', language: '' });

    expect(station.homepage).toBeUndefined();
    expect(station.faviconUrl).toBeUndefined();
    expect(station.region).toBeUndefined();
    expect(station.language).toBeUndefined();
    expect('homepage' in station).toBe(false);
  });

  it('names nameless stations instead of leaving a blank label', () => {
    expect(firstStation({ name: '   ' }).name).toBe('Unknown station');
  });

  it('keeps a station that has no coordinates at all', () => {
    const station = firstStation({ geo_lat: null, geo_long: null, name: 'Shortwave' });
    expect(station.geo).toBeNull();
    expect(station.name).toBe('Shortwave');
  });
});

describe('discoverStations', () => {
  /**
   * Fresh store per test — a shared one would let a cache hit mask the behaviour.
   *
   * `selection: 'top'` is explicit because the product default is `by-country`;
   * these cases exercise the paging path specifically.
   */
  function baseOptions() {
    return {
      selection: 'top' as const,
      // Hermetic: the bundled snapshot is exercised by its own tests.
      snapshotUrl: null,
      store: createMemoryStore(),
      mirrors: ['https://mirror.test'],
      sleep: noSleep,
      attemptsPerMirror: 1,
      now: () => 1_000,
      // Single page by default; paging gets its own tests.
      pageSize: 250,
      maxStations: 250,
      concurrency: 1,
    };
  }

  it('normalises, filters and orders the directory', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      okResponse([
        rawStation({ stationuuid: 'low', votes: 5 }),
        rawStation({ stationuuid: 'high', votes: 900 }),
        rawStation({ stationuuid: 'mid', votes: 50 }),
        // No playable URL at all — must be dropped.
        rawStation({ stationuuid: 'dead', votes: 999, url: '', url_resolved: '' }),
      ]),
    );

    const { stations, meta } = await discoverStations({ ...baseOptions(), fetchImpl });

    expect(stations.map((station) => station.id)).toEqual(['high', 'mid', 'low']);
    expect(meta.endpoint).toBe('https://mirror.test');
    expect(meta.fromCache).toBe(false);
    expect(meta.stale).toBe(false);
    expect(meta.sourceId).toBe(SOURCE_ID);
  });

  it('breaks vote ties deterministically so mirrors agree', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        okResponse([
          rawStation({ stationuuid: 'zulu', votes: 10 }),
          rawStation({ stationuuid: 'alpha', votes: 10 }),
        ]),
      );

    const { stations } = await discoverStations({ ...baseOptions(), fetchImpl });

    expect(stations.map((station) => station.id)).toEqual(['alpha', 'zulu']);
  });

  it('requests geolocated, non-broken stations ordered by popularity', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse([]));

    await discoverStations({ ...baseOptions(), fetchImpl, maxStations: 3000, pageSize: 250 });

    const called = fetchImpl.mock.calls[0]?.[0];
    expect(called).toBeDefined();
    const params = new URL(called === undefined ? '' : requestUrl(called)).searchParams;
    expect(params.get('has_geo_info')).toBe('true');
    expect(params.get('hidebroken')).toBe('true');
    expect(params.get('order')).toBe('votes');
    expect(params.get('reverse')).toBe('true');
    expect(params.get('limit')).toBe('250');
    expect(params.get('offset')).toBe('0');
  });

  it('pages through the directory instead of asking for one huge response', async () => {
    const offsets: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const params = new URL(requestUrl(input)).searchParams;
      offsets.push(params.get('offset') ?? '');
      const offset = Number(params.get('offset') ?? '0');
      return Promise.resolve(
        okResponse([rawStation({ stationuuid: `s-${offset}`, votes: 100 - offset })]),
      );
    });

    const { stations, meta } = await discoverStations({
      ...baseOptions(),
      fetchImpl,
      pageSize: 250,
      maxStations: 750,
    });

    expect(offsets).toEqual(['0', '250', '500']);
    expect(stations.map((station) => station.id)).toEqual(['s-0', 's-250', 's-500']);
    expect(meta.totalPages).toBe(3);
    expect(meta.failedPages).toBe(0);
  });

  it('deduplicates stations that appear on more than one page', async () => {
    // Mirrors can shift between requests; the same station may show up twice.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse([rawStation()]));

    const { stations } = await discoverStations({
      ...baseOptions(),
      fetchImpl,
      pageSize: 250,
      maxStations: 750,
    });

    expect(stations).toHaveLength(1);
  });

  it('keeps the stations it got when some pages fail', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      call += 1;
      return call === 2
        ? Promise.reject(new Error('page 2 died'))
        : Promise.resolve(okResponse([rawStation({ stationuuid: `page-${call}` })]));
    });

    const { stations, meta } = await discoverStations({
      ...baseOptions(),
      fetchImpl,
      pageSize: 250,
      maxStations: 750,
    });

    expect(stations.length).toBeGreaterThan(0);
    expect(meta.failedPages).toBe(1);
    expect(meta.totalPages).toBe(3);
  });

  it('reports progress as each page lands', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const offset = Number(new URL(requestUrl(input)).searchParams.get('offset') ?? '0');
      return Promise.resolve(
        okResponse([rawStation({ stationuuid: `s-${offset}`, votes: 100 - offset })]),
      );
    });
    const seen: number[] = [];

    await discoverStations({
      ...baseOptions(),
      fetchImpl,
      pageSize: 250,
      maxStations: 500,
      onPage: (stations) => {
        seen.push(stations.length);
      },
    });

    expect(seen.at(-1)).toBe(2);
  });

  it('surfaces a no-mirror error only when every page failed', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));

    const error = await discoverStations({
      ...baseOptions(),
      fetchImpl,
      pageSize: 250,
      maxStations: 500,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('no-mirror');
  });

  it('serves the second call from cache', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse([rawStation()]));
    const store = createMemoryStore();

    const first = await discoverStations({ ...baseOptions(), store, fetchImpl });
    const second = await discoverStations({ ...baseOptions(), store, fetchImpl });

    expect(first.meta.fromCache).toBe(false);
    expect(second.meta.fromCache).toBe(true);
    expect(second.stations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves stale data rather than failing when every mirror is down', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse([rawStation()]))
      .mockRejectedValue(new Error('all mirrors down'));
    const onStaleFallback = vi.fn();

    await discoverStations({ ...baseOptions(), store, fetchImpl });
    // Move past the TTL so the next call must attempt a live fetch.
    const later = await discoverStations({
      ...baseOptions(),
      store,
      fetchImpl,
      now: () => 1_000 + 25 * 60 * 60 * 1000,
      onStaleFallback,
    });

    expect(later.meta.stale).toBe(true);
    expect(later.meta.fromCache).toBe(true);
    expect(later.stations).toHaveLength(1);
    expect(onStaleFallback).toHaveBeenCalled();
  });

  it('surfaces a no-mirror error when nothing is cached and everything fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));

    const error = await discoverStations({ ...baseOptions(), fetchImpl }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('no-mirror');
  });

  it('reports how many records were unusable', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(okResponse([rawStation(), { name: 'no uuid' }]));

    const { stations } = await discoverStations({ ...baseOptions(), fetchImpl });

    expect(stations).toHaveLength(1);
  });

  it('tries a fast-failing concrete host before the DNS round-robin', () => {
    // Measured 2026-10-07: `all` hangs until the timeout from this network while
    // the named nodes either answer or fail in under 1.5s.
    expect(RADIO_BROWSER_MIRRORS[0]).toBe('https://de1.api.radio-browser.info');
    expect(RADIO_BROWSER_MIRRORS).toContain('https://all.api.radio-browser.info');
    expect(RADIO_BROWSER_MIRRORS.at(-1)).toBe('https://all.api.radio-browser.info');
  });
});

describe('by-country selection', () => {
  function baseOptions() {
    return {
      store: createMemoryStore(),
      mirrors: ['https://mirror.test'],
      sleep: noSleep,
      attemptsPerMirror: 1,
      now: () => 1_000,
      snapshotUrl: null,
      selection: 'by-country' as const,
      countryCount: 3,
      perCountry: 20,
      countryConcurrency: 1,
      maxStations: 1000,
    };
  }

  const COUNTRIES = [
    { name: 'United States', iso_3166_1: 'US', stationcount: 8422 },
    { name: 'Germany', iso_3166_1: 'DE', stationcount: 6482 },
    { name: 'France', iso_3166_1: 'FR', stationcount: 3880 },
    { name: 'Russia', iso_3166_1: 'RU', stationcount: 3256 },
  ];

  /** Descending votes by directory size, so ordering is unambiguous. */
  const VOTES: Record<string, number> = { US: 400, DE: 300, FR: 200, RU: 100 };

  /** Routes the country list and per-country station requests. */
  function routedFetch(stationsPerCountry: (code: string) => unknown[]) {
    return vi.fn<typeof fetch>((input) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith('/json/countries')) {
        return Promise.resolve(okResponse(COUNTRIES));
      }
      const code = url.searchParams.get('countrycode') ?? '??';
      return Promise.resolve(okResponse(stationsPerCountry(code)));
    });
  }

  it('asks the largest countries first, then one request each', async () => {
    const fetchImpl = routedFetch((code) => [
      rawStation({ stationuuid: `${code}-1`, votes: VOTES[code] ?? 0 }),
    ]);

    const { stations, meta } = await discoverStations({ ...baseOptions(), fetchImpl });

    // Ordering is by votes across the merged set, not by the order requested.
    expect(stations.map((station) => station.id)).toEqual(['US-1', 'DE-1', 'FR-1']);
    expect(meta.totalPages).toBe(3);
    expect(meta.failedPages).toBe(0);

    const requested = fetchImpl.mock.calls.map((call) => requestUrl(call[0]));
    expect(requested[0]).toContain('/json/countries');
    expect(requested.filter((url) => url.includes('countrycode=US'))).toHaveLength(1);
    // Russia is 4th by station count and the quota is 3, so it must not be asked.
    expect(requested.some((url) => url.includes('countrycode=RU'))).toBe(false);
  });

  it('deduplicates stations that appear under more than one country', async () => {
    const shared = rawStation({ stationuuid: 'shared', votes: 900 });
    const fetchImpl = routedFetch((code) => [
      shared,
      rawStation({ stationuuid: `${code}-own`, votes: VOTES[code] ?? 0 }),
    ]);

    const { stations } = await discoverStations({ ...baseOptions(), fetchImpl });

    expect(stations.filter((station) => station.id === 'shared')).toHaveLength(1);
    expect(stations).toHaveLength(4);
  });

  it('keeps going when one country fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith('/json/countries')) {
        return Promise.resolve(okResponse(COUNTRIES));
      }
      const code = url.searchParams.get('countrycode');
      if (code === 'DE') return Promise.reject(new Error('Germany is down'));
      return Promise.resolve(
        okResponse([
          rawStation({ stationuuid: `${code ?? 'X'}-1`, votes: VOTES[code ?? ''] ?? 0 }),
        ]),
      );
    });

    const { stations, meta } = await discoverStations({ ...baseOptions(), fetchImpl });

    expect(stations.map((station) => station.id)).toEqual(['US-1', 'FR-1']);
    expect(meta.failedPages).toBe(1);
    expect(meta.totalPages).toBe(3);
  });

  it('fails only when every country fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith('/json/countries')) {
        return Promise.resolve(okResponse(COUNTRIES));
      }
      return Promise.reject(new Error('all down'));
    });

    const error = await discoverStations({ ...baseOptions(), fetchImpl }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('no-mirror');
  });

  it('caches the country list and each country separately', async () => {
    const fetchImpl = routedFetch((code) => [rawStation({ stationuuid: `${code}-1` })]);
    const store = createMemoryStore();

    const first = await discoverStations({ ...baseOptions(), store, fetchImpl });
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await discoverStations({ ...baseOptions(), store, fetchImpl });

    expect(first.meta.fromCache).toBe(false);
    expect(second.meta.fromCache).toBe(true);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
    expect(second.stations).toHaveLength(3);
  });

  it('errors out rather than returning an empty globe when the country list is unusable', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith('/json/countries')) {
        return Promise.resolve(okResponse([]));
      }
      return Promise.resolve(okResponse([]));
    });

    await expect(discoverStations({ ...baseOptions(), fetchImpl })).rejects.toBeInstanceOf(
      SourceError,
    );
  });

  it('reports progress per country, not per station', async () => {
    const fetchImpl = routedFetch((code) => [rawStation({ stationuuid: `${code}-1` })]);
    const seen: number[] = [];

    await discoverStations({
      ...baseOptions(),
      fetchImpl,
      onPage: (_stations, progress) => {
        seen.push(progress.target);
      },
    });

    // target = countryCount * perCountry
    expect(seen.every((target) => target === 60)).toBe(true);
    expect(seen).toHaveLength(3);
  });
});

describe('mirror discovery and stickiness', () => {
  /** `/json/servers` lists each host once per IP family. */
  function serverList(hosts: readonly string[]): unknown[] {
    return hosts.flatMap((host) => [
      { name: host, ip: '91.98.4.78' },
      { name: host, ip: '2a01:4f8:1c1d:699::1' },
    ]);
  }

  const pageOptions = {
    selection: 'top' as const,
    sleep: noSleep,
    attemptsPerMirror: 1,
    pageSize: 250,
    maxStations: 250,
    snapshotUrl: null,
    now: () => 1_000,
  };

  it('discovers live nodes before asking for stations', async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      requested.push(url);
      if (url.includes('/json/servers')) {
        return Promise.resolve(okResponse(serverList(['good.example'])));
      }
      return Promise.resolve(okResponse([rawStation()]));
    });

    const { meta } = await discoverStations({
      ...pageOptions,
      store: createMemoryStore(),
      fetchImpl,
    });

    // The documented mirror list is stale, so the live list must be consulted.
    expect(requested[0]).toContain('/json/servers');
    expect(meta.endpoint).toBe('https://good.example');
  });

  it('does not reorder or discover when the caller pins a mirror list', async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      requested.push(requestUrl(input));
      return Promise.resolve(okResponse([rawStation()]));
    });

    const { meta } = await discoverStations({
      ...pageOptions,
      store: createMemoryStore(),
      mirrors: ['https://pinned.test'],
      fetchImpl,
    });

    expect(requested.some((url) => url.includes('/json/servers'))).toBe(false);
    expect(meta.endpoint).toBe('https://pinned.test');
  });

  it('remembers the working mirror for the next load', async () => {
    const store = createMemoryStore();
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('/json/servers')) {
        return Promise.resolve(okResponse(serverList(['down.example', 'up.example'])));
      }
      if (url.startsWith('https://down.example')) {
        return Promise.reject(new Error('down.example is down'));
      }
      return Promise.resolve(okResponse([rawStation()]));
    });

    await discoverStations({ ...pageOptions, store, fetchImpl });

    expect(await store.get('radio-browser:preferred-mirror')).toMatchObject({
      endpoint: 'https://up.example',
    });
  });

  it('tries the remembered mirror first on the next load', async () => {
    const store = createMemoryStore();
    await store.set('radio-browser:preferred-mirror', {
      endpoint: 'https://up.example',
      storedAt: 1_000,
    });

    const stationRequests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('/json/servers')) {
        return Promise.resolve(okResponse(serverList(['down.example', 'up.example'])));
      }
      stationRequests.push(url);
      return Promise.resolve(okResponse([rawStation()]));
    });

    await discoverStations({ ...pageOptions, store, fetchImpl });

    expect(stationRequests[0]).toContain('https://up.example');
  });

  it('falls back to the static list when discovery fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('/json/servers')) {
        return Promise.reject(new Error('discovery is down'));
      }
      return Promise.resolve(okResponse([rawStation()]));
    });

    const { stations, meta } = await discoverStations({
      ...pageOptions,
      store: createMemoryStore(),
      fetchImpl,
    });

    expect(stations).toHaveLength(1);
    expect(meta.endpoint).toContain('radio-browser.info');
  });
});

describe('snapshot fallback', () => {
  function snapshotFile(records: unknown[]): unknown {
    return {
      generatedAt: '2026-10-07T12:00:00.000Z',
      source: 'test',
      count: records.length,
      stations: records,
    };
  }

  const base = {
    selection: 'top' as const,
    sleep: noSleep,
    attemptsPerMirror: 1,
    pageSize: 250,
    maxStations: 250,
    mirrors: ['https://mirror.test'],
    now: () => Date.parse('2026-10-07T12:30:00.000Z'),
  };

  /** Serves the snapshot path and the station path separately. */
  function routedFetch(snapshot: unknown, stations: unknown[] | Error) {
    return vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('snapshot')) return Promise.resolve(okResponse(snapshot));
      if (stations instanceof Error) return Promise.reject(stations);
      return Promise.resolve(okResponse(stations));
    });
  }

  it('emits snapshot stations before the network answers', async () => {
    const fetchImpl = routedFetch(
      snapshotFile([rawStation({ stationuuid: 'from-snapshot', votes: 10 })]),
      [rawStation({ stationuuid: 'from-network', votes: 20 })],
    );
    const emissions: string[][] = [];

    const { stations } = await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
      onPage: (page) => {
        emissions.push(page.map((station) => station.id));
      },
    });

    // First emission is the snapshot alone, so the globe fills immediately.
    expect(emissions[0]).toEqual(['from-snapshot']);
    // The final result is live data only — snapshot entries are provisional and
    // would otherwise accumulate as ghosts across releases.
    expect(stations.map((station) => station.id)).toEqual(['from-network']);
  });

  it('shows snapshot and live data together while loading', async () => {
    const fetchImpl = routedFetch(
      snapshotFile([rawStation({ stationuuid: 'from-snapshot', votes: 10 })]),
      [rawStation({ stationuuid: 'from-network', votes: 20 })],
    );
    const emissions: string[][] = [];

    await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
      onPage: (page) => {
        emissions.push(page.map((station) => station.id));
      },
    });

    expect(emissions.at(-1)).toEqual(['from-network', 'from-snapshot']);
  });

  it('falls back to the snapshot when every mirror is down', async () => {
    const fetchImpl = routedFetch(
      snapshotFile([rawStation({ stationuuid: 'from-snapshot' })]),
      new Error('every mirror is down'),
    );

    const { stations, meta } = await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
    });

    // No throw: a usable globe beats an error screen.
    expect(stations.map((station) => station.id)).toEqual(['from-snapshot']);
    expect(meta.fromSnapshot).toBe(true);
  });

  it('still throws when there is no snapshot to fall back on', async () => {
    const fetchImpl = routedFetch(snapshotFile([]), new Error('down'));

    const error = await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('no-mirror');
  });

  it('marks live results as not coming from the snapshot', async () => {
    const fetchImpl = routedFetch(snapshotFile([rawStation({ stationuuid: 'from-snapshot' })]), [
      rawStation({ stationuuid: 'from-network' }),
    ]);

    const { meta } = await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
    });

    expect(meta.fromSnapshot).toBe(false);
  });

  it('does not fetch the snapshot when it is disabled', async () => {
    const fetchImpl = routedFetch(snapshotFile([]), [rawStation()]);

    await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: null,
      fetchImpl,
    });

    expect(fetchImpl.mock.calls.some((call) => requestUrl(call[0]).includes('snapshot'))).toBe(
      false,
    );
  });

  it('ignores a snapshot whose records are unusable', async () => {
    // Records missing a stationuuid are dropped by the same parser that guards
    // live responses, so a broken snapshot degrades to the network path.
    const fetchImpl = routedFetch(snapshotFile([{ name: 'no uuid' }]), [
      rawStation({ stationuuid: 'from-network' }),
    ]);

    const { stations } = await discoverStations({
      ...base,
      store: createMemoryStore(),
      snapshotUrl: '/snapshot.json',
      fetchImpl,
    });

    expect(stations.map((station) => station.id)).toEqual(['from-network']);
  });
});

describe('createRadioBrowserSource', () => {
  it('declares itself as an audio source that does not require a coordinate', () => {
    const source = createRadioBrowserSource();

    expect(source.manifest.id).toBe(SOURCE_ID);
    expect(source.manifest.channels).toEqual(['audio']);
    expect(source.manifest.requiresGeo).toBe(false);
    expect(source.manifest.attribution).toContain('Radio Browser');
  });

  it('wraps stations into audio-stream payloads carrying their origin', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse([rawStation()]));
    const source = createRadioBrowserSource({
      selection: 'top',
      store: createMemoryStore(),
      mirrors: ['https://mirror.test'],
      fetchImpl,
      sleep: noSleep,
    });

    const payloads = await source.discover({
      locale: 'zh-CN',
      signal: new AbortController().signal,
    });

    expect(payloads).toHaveLength(1);
    const payload = payloads[0];
    expect(payload?.type).toBe('audio-stream');
    expect(payload?.sourceId).toBe(SOURCE_ID);
    expect(payload?.url).toBe('http://stream.example/a');
    expect(payload?.title).toBe('Radio Paradise');
    expect(payload?.bitrate).toBe(320);
    expect(payload?.origin).toEqual({ lat: 34.05, lng: -118.24 });
  });
});
