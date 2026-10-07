import { describe, expect, it, vi } from 'vitest';
import { fetchJsonFromMirrors, describeHttpError } from './http';
import { SourceError } from '../types/source';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * `fetch` accepts a string, a `URL`, or a `Request`. Our code always passes a
 * string, but reading it back needs the narrowing to stay type-safe.
 */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const noSleep = () => Promise.resolve();

const MIRRORS = ['https://a.test', 'https://b.test', 'https://c.test'] as const;

describe('fetchJsonFromMirrors', () => {
  it('returns the first mirror that answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse({ hello: 'world' }));

    const result = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/json/stations',
      fetchImpl,
      sleep: noSleep,
    });

    expect(result.body).toEqual({ hello: 'world' });
    expect(result.endpoint).toBe('https://a.test');
    expect(result.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails over to the next mirror on a network error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const result = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/json/stations',
      fetchImpl,
      attemptsPerMirror: 1,
      sleep: noSleep,
    });

    expect(result.endpoint).toBe('https://b.test');
    expect(result.attempts).toBe(2);
  });

  it('retries within a mirror before moving on', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      seen.push(requestUrl(input));
      return Promise.reject(new Error('flaky'));
    });

    await expect(
      fetchJsonFromMirrors({
        mirrors: ['https://a.test'],
        path: '/x',
        fetchImpl,
        attemptsPerMirror: 3,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(SourceError);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(['https://a.test/x', 'https://a.test/x', 'https://a.test/x']);
  });

  it('treats a non-2xx status as a failure and fails over', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const result = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/x',
      fetchImpl,
      attemptsPerMirror: 1,
      sleep: noSleep,
    });

    expect(result.endpoint).toBe('https://b.test');
  });

  it('reports every failed attempt through onAttemptError', async () => {
    const onAttemptError = vi.fn<(endpoint: string, attempt: number, error: unknown) => void>();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));

    await expect(
      fetchJsonFromMirrors({
        mirrors: ['https://a.test', 'https://b.test'],
        path: '/x',
        fetchImpl,
        attemptsPerMirror: 2,
        sleep: noSleep,
        onAttemptError,
      }),
    ).rejects.toBeInstanceOf(SourceError);

    expect(onAttemptError).toHaveBeenCalledTimes(4);
    expect(onAttemptError.mock.calls.map((call) => call[0])).toEqual([
      'https://a.test',
      'https://a.test',
      'https://b.test',
      'https://b.test',
    ]);
    expect(onAttemptError.mock.calls.map((call) => call[1])).toEqual([1, 2, 1, 2]);
  });

  it('throws no-mirror with the attempt count once everything is exhausted', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));

    const error = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/x',
      fetchImpl,
      attemptsPerMirror: 2,
      sleep: noSleep,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SourceError);
    expect((error as SourceError).code).toBe('no-mirror');
    expect((error as SourceError).message).toContain('3 mirror(s)');
    expect((error as SourceError).message).toContain('6 attempt(s)');
  });

  it('refuses to run without mirrors', async () => {
    const error = await fetchJsonFromMirrors({ mirrors: [], path: '/x' }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as SourceError).code).toBe('no-mirror');
  });

  it('does not retry or fail over when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/x',
      fetchImpl,
      signal: controller.signal,
      sleep: noSleep,
    }).catch((thrown: unknown) => thrown);

    expect((error as SourceError).code).toBe('aborted');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces an in-flight abort as aborted rather than failing over', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(() => {
      controller.abort();
      return Promise.reject(abortError());
    });

    const error = await fetchJsonFromMirrors({
      mirrors: MIRRORS,
      path: '/x',
      fetchImpl,
      signal: controller.signal,
      sleep: noSleep,
    }).catch((thrown: unknown) => thrown);

    expect((error as SourceError).code).toBe('aborted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends an identifiable User-Agent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse({}));

    await fetchJsonFromMirrors({
      mirrors: ['https://a.test'],
      path: '/x',
      fetchImpl,
      sleep: noSleep,
      headers: { 'X-Custom': 'yes' },
    });

    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['User-Agent']).toContain('worldline');
    expect(headers?.['X-Custom']).toBe('yes');
  });

  it('strips a trailing slash from the mirror before joining the path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse({}));

    await fetchJsonFromMirrors({
      mirrors: ['https://a.test/'],
      path: '/json/stations',
      fetchImpl,
      sleep: noSleep,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://a.test/json/stations');
  });
});

describe('describeHttpError', () => {
  it('passes SourceError through unchanged', () => {
    const original = new SourceError('timeout', 'slow');
    expect(describeHttpError(original)).toBe(original);
  });

  it('classifies a timeout', () => {
    const error = new Error('timed out');
    error.name = 'TimeoutError';
    expect(describeHttpError(error).code).toBe('timeout');
  });

  it('classifies an abort', () => {
    expect(describeHttpError(abortError()).code).toBe('aborted');
  });

  it('classifies anything else as a network error', () => {
    expect(describeHttpError(new Error('boom')).code).toBe('network');
  });

  it('handles non-Error throwables', () => {
    expect(describeHttpError('just a string').code).toBe('unknown');
  });
});
