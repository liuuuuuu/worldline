/**
 * HTTP with mirror rotation, retry, and per-attempt timeouts.
 *
 * Radio Browser is served by several independent mirrors and the official
 * guidance is to try them in turn rather than hard-code one host. This module is
 * the single place that knows how to do that, so every source gets the same
 * resilience for free.
 *
 * Testability: `fetchImpl`, `sleep` and `mirrors` are all injectable, so the
 * retry and failover logic is covered by unit tests with no network involved.
 */

import { SourceError } from '../types/source';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_ATTEMPTS_PER_MIRROR = 2;
export const DEFAULT_BACKOFF_MS = 300;

/** Sent on every request. Radio Browser asks for an identifiable UA. */
export const USER_AGENT = 'worldline/0.1 (+https://github.com/liuuuuuu/worldline)';

export interface HttpDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface MirrorRequestOptions extends HttpDeps {
  /** Tried in order. The first one that answers wins. */
  mirrors: readonly string[];
  /** Path appended to the mirror base URL, starting with `/`. */
  path: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  attemptsPerMirror?: number;
  backoffMs?: number;
  headers?: Readonly<Record<string, string>>;
  /** Observability hook — how failover shows up in tests and logs. */
  onAttemptError?: (endpoint: string, attempt: number, error: unknown) => void;
}

export interface MirrorResponse {
  /** Parsed JSON body, still unvalidated. */
  body: unknown;
  /** Base URL of the mirror that answered. */
  endpoint: string;
  /** Total attempts consumed across all mirrors. */
  attempts: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface TimeoutScope {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * Combine a caller signal with a timeout into one signal.
 *
 * Hand-rolled rather than using `AbortSignal.any` / `AbortSignal.timeout` so the
 * behaviour is identical in Node and in jsdom, and so we can tell "the caller
 * cancelled" apart from "we timed out".
 */
function createTimeoutScope(parent: AbortSignal | undefined, timeoutMs: number): TimeoutScope {
  const controller = new AbortController();

  const onParentAbort = () => {
    controller.abort(new DOMException('Aborted by caller', 'AbortError'));
  };

  if (parent) {
    if (parent.aborted) {
      onParentAbort();
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * Fetch JSON, trying each mirror in turn.
 *
 * Throws `SourceError` with a code the caller can branch on:
 *   - `aborted`      the caller's signal fired — do not retry, do not failover
 *   - `no-mirror`    every mirror and every attempt failed
 */
export async function fetchJsonFromMirrors(options: MirrorRequestOptions): Promise<MirrorResponse> {
  const {
    mirrors,
    path,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    attemptsPerMirror = DEFAULT_ATTEMPTS_PER_MIRROR,
    backoffMs = DEFAULT_BACKOFF_MS,
    headers,
    onAttemptError,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = options;

  if (mirrors.length === 0) {
    throw new SourceError('no-mirror', 'No mirrors configured');
  }

  let attempts = 0;
  let lastError: unknown;

  for (const mirror of mirrors) {
    const endpoint = mirror.replace(/\/+$/, '');

    for (let attempt = 1; attempt <= attemptsPerMirror; attempt += 1) {
      if (signal?.aborted) {
        throw new SourceError('aborted', 'Request aborted before completion', { endpoint });
      }

      attempts += 1;
      const scope = createTimeoutScope(signal, timeoutMs);

      try {
        const response = await fetchImpl(`${endpoint}${path}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            ...headers,
          },
          signal: scope.signal,
        });

        if (!response.ok) {
          throw new SourceError('bad-response', `HTTP ${response.status} from ${endpoint}`, {
            endpoint,
          });
        }

        const body: unknown = await response.json();
        return { body, endpoint, attempts };
      } catch (error) {
        lastError = error;

        // A caller-initiated abort is terminal: retrying wastes time and the
        // caller has already moved on.
        if (signal?.aborted || isAbortError(error)) {
          throw new SourceError('aborted', 'Request aborted', { endpoint, cause: error });
        }

        onAttemptError?.(endpoint, attempt, error);

        const isLastAttempt = attempt === attemptsPerMirror;
        if (!isLastAttempt && backoffMs > 0) {
          await sleep(backoffMs * attempt);
        }
      } finally {
        scope.dispose();
      }
    }
  }

  throw new SourceError(
    'no-mirror',
    `All ${mirrors.length} mirror(s) failed after ${attempts} attempt(s)`,
    { endpoint: mirrors[mirrors.length - 1] ?? '', cause: lastError },
  );
}

/** Classify a thrown value for reporting. */
export function describeHttpError(error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  if (isTimeoutError(error))
    return new SourceError('timeout', 'Request timed out', { cause: error });
  if (isAbortError(error)) return new SourceError('aborted', 'Request aborted', { cause: error });
  if (error instanceof Error) return new SourceError('network', error.message, { cause: error });
  return new SourceError('unknown', 'Unknown error', { cause: error });
}
