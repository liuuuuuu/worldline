/**
 * Stream relay — a Vite dev/preview middleware.
 *
 * Solves mixed content: ~71% of popular stations serve only `http://`, and a
 * page in a secure context cannot play those. The relay fetches on the server
 * (where mixed content does not apply) and hands the bytes back over HTTPS.
 *
 * ## Not an open proxy
 *
 * The obvious implementation — "proxy whatever URL you pass me" — turns the
 * host into a pivot into its own private network. So:
 *
 *  - The main stream is requested by **station id**; the server looks the address
 *    up in the snapshot itself. A caller cannot ask for an arbitrary URL.
 *  - HLS sub-resources do pass a URL, because segments live on other hosts, but
 *    every one goes through the SSRF guard in `src/relay/ssrf.ts`, and every DNS
 *    answer is checked — not just the first.
 *  - Redirects are followed manually so each hop is re-validated. `redirect:
 *    'follow'` would let a public URL bounce into `169.254.169.254`.
 *
 * Deploying this for real costs the host bandwidth, which is why it is a single
 * plugin that can simply be left out of the build.
 */

import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import { checkTargetUrl, isPrivateAddress, parseIPv4, parseIPv6 } from '../src/relay/ssrf.ts';
import { isPlaylist, rewritePlaylist } from '../src/relay/playlist.ts';
import { DEFAULT_RELAY_PATH, relaySubResource } from '../src/relay/streamUrl.ts';

/**
 * Handshake only.
 *
 * A live stream is a long-lived response; a timeout on the whole thing would cut
 * playback off after a few seconds. Once headers arrive the timer is cleared and
 * the body streams for as long as it likes.
 */
const HANDSHAKE_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
/** Playlists are text and small; anything larger is not a playlist. */
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'worldline-relay/0.1 (+https://github.com/liuuuuuu/worldline)';

export interface StreamRelayOptions {
  /** Snapshot used to resolve station ids to stream URLs. */
  snapshotPath?: string;
  /** Mount point. */
  path?: string;
}

function send(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}

/**
 * Follow redirects one hop at a time, validating each target.
 *
 * Returns the first non-redirect response, or an error string.
 */
async function fetchChecked(
  startUrl: string,
  init: RequestInit,
): Promise<{ response: Response } | { error: string; status: number }> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const verdict = checkTargetUrl(current);
    if (!verdict.allowed) return { error: verdict.reason, status: 403 };

    const hostname = verdict.url.hostname.replace(/^\[|\]$/g, '');
    if (!isIpLiteral(hostname)) {
      try {
        const records = await lookup(hostname, { all: true });
        // Every answer must be public: a host with one private A record among
        // public ones is exactly the trick this guards against.
        if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
          return { error: 'resolves-to-private-address', status: 403 };
        }
      } catch {
        return { error: 'dns-lookup-failed', status: 502 };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, HANDSHAKE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(verdict.url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return { error: `upstream-failed: ${String(error)}`, status: 502 };
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location !== null) {
      current = new URL(location, verdict.url).toString();
      continue;
    }

    return { response };
  }

  return { error: 'too-many-redirects', status: 502 };
}

export function streamRelay(options: StreamRelayOptions = {}): Plugin {
  const mountPath = options.path ?? DEFAULT_RELAY_PATH;
  const snapshotPath = resolve(
    process.cwd(),
    options.snapshotPath ?? 'public/stations.snapshot.json',
  );

  const stations = new Map<string, string>();
  let loaded = false;

  const loadStations = async (): Promise<void> => {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
        stations?: Array<Record<string, unknown>>;
      };
      for (const record of parsed.stations ?? []) {
        const id = typeof record.stationuuid === 'string' ? record.stationuuid : '';
        const resolved =
          typeof record.url_resolved === 'string' && record.url_resolved !== ''
            ? record.url_resolved
            : typeof record.url === 'string'
              ? record.url
              : '';
        if (id !== '' && resolved !== '') stations.set(id, resolved);
      }
    } catch {
      // The snapshot is optional; without it only `?u=` sub-resource requests work.
    }
  };

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const url = new URL(req.url ?? '', 'http://relay.local');
      const uuid = url.searchParams.get('uuid');
      const explicit = url.searchParams.get('u');

      let target: string;
      if (uuid !== null && uuid !== '') {
        await loadStations();
        const found = stations.get(uuid);
        if (!found) {
          send(res, 404, 'unknown station id');
          return;
        }
        target = found;
      } else if (explicit !== null && explicit !== '') {
        target = explicit;
      } else {
        send(res, 400, 'missing uuid or u');
        return;
      }

      const range = req.headers.range;
      const result = await fetchChecked(target, {
        headers: {
          Accept: '*/*',
          // Audio is already compressed; re-compressing wastes CPU and can
          // confuse clients that expect byte-identical segments.
          'Accept-Encoding': 'identity',
          'User-Agent': USER_AGENT,
          ...(typeof range === 'string' ? { Range: range } : {}),
        },
      });

      if ('error' in result) {
        send(res, result.status, result.error);
        return;
      }

      const { response } = result;
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';

      res.statusCode = response.status;
      res.setHeader('Cache-Control', 'no-store');

      if (isPlaylist(contentType, target)) {
        const body = await response.text();
        if (body.length > MAX_PLAYLIST_BYTES) {
          send(res, 502, 'playlist too large');
          return;
        }
        // Rewrite against the *final* URL, so relative segments resolve correctly.
        const rewritten = rewritePlaylist(body, {
          baseUrl: response.url === '' ? target : response.url,
          proxy: (absolute) => relaySubResource(absolute, { relayPath: mountPath }),
        });
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.end(rewritten);
        return;
      }

      const length = response.headers.get('content-length');
      if (length !== null) res.setHeader('Content-Length', length);
      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges !== null) res.setHeader('Accept-Ranges', acceptRanges);
      res.setHeader('Content-Type', contentType);

      if (!response.body) {
        res.end();
        return;
      }

      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    })().catch((error: unknown) => {
      if (!res.headersSent) send(res, 500, `relay error: ${String(error)}`);
      else res.end();
    });
  };

  return {
    name: 'worldline:stream-relay',
    configureServer(server) {
      server.middlewares.use(mountPath, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mountPath, handler);
    },
  };
}
