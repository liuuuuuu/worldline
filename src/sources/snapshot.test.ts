import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SNAPSHOT_URL, loadSnapshot, snapshotFileSchema } from './snapshot';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function snapshotFile(stations: unknown[], generatedAt = '2026-10-07T12:00:00.000Z') {
  return {
    generatedAt,
    source: 'https://de1.api.radio-browser.info (Radio Browser, community-maintained)',
    count: stations.length,
    stations,
  };
}

const RECORD = {
  stationuuid: 'abc',
  name: 'Radio Paradise',
  url_resolved: 'http://example.invalid/stream',
  countrycode: 'US',
  votes: 100,
  geo_lat: 34.05,
  geo_long: -118.24,
};

describe('snapshotFileSchema', () => {
  it('accepts the envelope with untyped station records', () => {
    const parsed = snapshotFileSchema.safeParse(snapshotFile([RECORD]));
    expect(parsed.success).toBe(true);
  });

  it('rejects a file with no timestamp', () => {
    const { generatedAt: _dropped, ...withoutTimestamp } = snapshotFile([RECORD]);
    expect(snapshotFileSchema.safeParse(withoutTimestamp).success).toBe(false);
  });

  it('rejects a file whose stations is not an array', () => {
    const broken = { ...snapshotFile([RECORD]), stations: { not: 'an array' } };
    expect(snapshotFileSchema.safeParse(broken).success).toBe(false);
  });
});

describe('loadSnapshot', () => {
  const now = () => Date.parse('2026-10-07T13:00:00.000Z');

  it('loads a valid file and reports its age', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(snapshotFile([RECORD]))),
    );

    const snapshot = await loadSnapshot('/snap.json', now, fetchImpl);

    expect(snapshot?.records).toHaveLength(1);
    expect(snapshot?.generatedAt).toBe('2026-10-07T12:00:00.000Z');
    // One hour between generation and now.
    expect(snapshot?.ageMs).toBe(60 * 60 * 1000);
    expect(fetchImpl).toHaveBeenCalledWith('/snap.json');
  });

  it('defaults to the bundled path', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(snapshotFile([RECORD]))),
    );

    await loadSnapshot(undefined, now, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(DEFAULT_SNAPSHOT_URL);
  });

  it('returns null for a missing file', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({}, 404)));
    await expect(loadSnapshot('/missing.json', now, fetchImpl)).resolves.toBeNull();
  });

  it('returns null rather than throwing when the network fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')));
    await expect(loadSnapshot('/snap.json', now, fetchImpl)).resolves.toBeNull();
  });

  it('returns null when the body is not valid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token')),
      } as unknown as Response),
    );

    await expect(loadSnapshot('/snap.json', now, fetchImpl)).resolves.toBeNull();
  });

  it('returns null when the envelope is malformed', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ stations: [RECORD] })),
    );
    await expect(loadSnapshot('/snap.json', now, fetchImpl)).resolves.toBeNull();
  });

  it('returns null for an empty snapshot rather than pretending it loaded', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(snapshotFile([]))));
    await expect(loadSnapshot('/snap.json', now, fetchImpl)).resolves.toBeNull();
  });

  it('reports a null age when the timestamp is unparseable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(snapshotFile([RECORD], 'not a date'))),
    );

    const snapshot = await loadSnapshot('/snap.json', now, fetchImpl);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.ageMs).toBeNull();
  });

  it('never reports a negative age for a clock skewed into the future', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(snapshotFile([RECORD], '2026-10-08T00:00:00.000Z'))),
    );

    const snapshot = await loadSnapshot('/snap.json', now, fetchImpl);
    expect(snapshot?.ageMs).toBe(0);
  });
});
