/**
 * HLS playlist rewriting.
 *
 * An `m3u8` is not audio — it is a list of more URLs. Relaying only the playlist
 * leaves every segment request on plain HTTP, which the browser still blocks, so
 * the playlist has to be rewritten to point at the relay too.
 *
 * Three things must be rewritten, and missing any of them breaks playback in a
 * way that looks like "the stream is down":
 *
 *  1. Bare URL lines — segments in a media playlist, child playlists in a master.
 *  2. `URI="..."` attributes — `#EXT-X-KEY` (decryption key), `#EXT-X-MAP` (init
 *     section), `#EXT-X-MEDIA`.
 *  3. Relative paths, resolved against **the playlist's own URL**, not the page's.
 *
 * Pure string work, so it is unit tested rather than debugged through a player.
 */

const URI_ATTRIBUTE = /URI="([^"]*)"/g;

export interface RewriteOptions {
  /** Absolute URL the playlist was fetched from — the base for relative paths. */
  baseUrl: string;
  /** Maps an absolute URL to its relayed form. */
  proxy: (url: string) => string;
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function resolve(reference: string, baseUrl: string): string {
  if (isAbsoluteUrl(reference)) return reference;
  try {
    return new URL(reference, baseUrl).toString();
  } catch {
    return reference;
  }
}

/**
 * Rewrite every URL in a playlist.
 *
 * Comment lines are preserved verbatim apart from their `URI=` attributes, so
 * tags we do not understand survive untouched.
 */
export function rewritePlaylist(playlist: string, options: RewriteOptions): string {
  const { baseUrl, proxy } = options;

  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();

      if (trimmed === '') return line;

      if (trimmed.startsWith('#')) {
        return line.replace(URI_ATTRIBUTE, (_match, uri: string) => {
          if (uri === '') return 'URI=""';
          return `URI="${proxy(resolve(uri, baseUrl))}"`;
        });
      }

      return proxy(resolve(trimmed, baseUrl));
    })
    .join('\n');
}

/** True when a body looks like an HLS playlist rather than media bytes. */
export function isPlaylist(contentType: string, url: string): boolean {
  const type = contentType.toLowerCase();
  if (type.includes('mpegurl') || type.includes('x-mpegURL'.toLowerCase())) return true;
  return url.split('?')[0]?.toLowerCase().endsWith('.m3u8') ?? false;
}
