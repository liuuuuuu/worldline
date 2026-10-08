/**
 * Stream URL resolution.
 *
 * Why a relay exists at all: measured on the top 300 stations by votes, ~71%
 * serve only `http://`. A page loaded over HTTPS cannot play those — the browser
 * blocks them as mixed content. Tauri builds and any deployed web build are both
 * secure contexts, so this is not a dev-only concern.
 *
 * Two rules keep the relay from becoming an open proxy:
 *
 *  - The **main stream** is requested by station id, never by URL. The server
 *    looks the address up itself, so a caller cannot ask it to fetch anything.
 *  - Only **HLS sub-resources** pass a URL, because segments live on other hosts.
 *    Those go through the SSRF guard on the server (see `ssrf.ts`).
 */

export const DEFAULT_RELAY_PATH = '/api/stream';

export interface StreamUrlOptions {
  relayPath?: string;
  /** Set false to bypass the relay entirely (e.g. when it is not deployed). */
  enabled?: boolean;
}

/** True when the URL cannot be played from a secure context. */
export function needsRelay(url: string): boolean {
  return url.startsWith('http://');
}

/**
 * Where the player should fetch this station from.
 *
 * HTTPS streams are left alone: proxying them would spend the host's bandwidth
 * to gain nothing.
 */
export function resolveStreamUrl(
  streamUrl: string,
  stationId: string,
  options: StreamUrlOptions = {},
): string {
  const { relayPath = DEFAULT_RELAY_PATH, enabled = true } = options;

  if (!enabled) return streamUrl;
  if (!needsRelay(streamUrl)) return streamUrl;

  return `${relayPath}?uuid=${encodeURIComponent(stationId)}`;
}

/** Relay URL for an arbitrary sub-resource (HLS segment, key, init section). */
export function relaySubResource(url: string, options: StreamUrlOptions = {}): string {
  const { relayPath = DEFAULT_RELAY_PATH, enabled = true } = options;

  if (!enabled) return url;
  return `${relayPath}?u=${encodeURIComponent(url)}`;
}

/** Rewrite an upstream URL from a relay request back into absolute form. */
export function absolutise(reference: string, base: string): string {
  try {
    return new URL(reference, base).toString();
  } catch {
    return reference;
  }
}
