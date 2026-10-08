/**
 * SSRF guard for the stream relay.
 *
 * The relay exists because ~71% of popular stations are http-only and an HTTPS
 * page cannot play them (see the mixed-content note in `streamUrl.ts`). A relay
 * that forwards to a caller-supplied URL is an open proxy: anyone can use it to
 * reach the host's internal network. So every target is checked here first.
 *
 * Two rules matter and are easy to get wrong:
 *
 *  1. **Check the resolved IP, not the hostname.** `evil.example.com` can resolve
 *     to `10.0.0.5`.
 *  2. **Check every answer, not the first.** A host with both a public and a
 *     private A record must be rejected; taking `records[0]` is a coin flip.
 *
 * This module is deliberately free of `node:` imports so it can be unit tested
 * in the same vitest environment as the rest of the app.
 */

/** Parse a dotted-quad IPv4 into a 32-bit number, or null. */
export function parseIPv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/** Expand an IPv6 address into eight 16-bit groups, or null. */
export function parseIPv6(value: string): number[] | null {
  let text = value;

  // Strip a zone index (`fe80::1%eth0`).
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted quad is legal in IPv6 (`::ffff:127.0.0.1`) and counts as
  // two groups.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (lastColon !== -1 && text.slice(lastColon + 1).includes('.')) {
    const ipv4 = parseIPv4(text.slice(lastColon + 1));
    if (ipv4 === null) return null;
    tail = [(ipv4 >>> 16) & 0xffff, ipv4 & 0xffff];

    text = text.slice(0, lastColon + 1);
    // Drop the separator colon before the quad — but not one half of a `::`,
    // which is meaningful and must survive.
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups: number[] = [];
    for (const group of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? '');
  if (head === null) return null;

  let tailGroups: number[] = [];
  if (halves.length === 2) {
    const parsed = parseGroups(halves[1] ?? '');
    if (parsed === null) return null;
    tailGroups = parsed;
  }

  const explicit = [...head, ...tailGroups, ...tail];

  // No `::`: the address must already be exactly eight groups.
  if (halves.length === 1) {
    return explicit.length === 8 ? explicit : null;
  }

  const fill = 8 - explicit.length;
  if (fill < 0) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tailGroups, ...tail];
}

/**
 * Whether an IP literal points somewhere it must not.
 *
 * Covers loopback, private ranges, link-local (including the cloud metadata
 * address 169.254.169.254), CGNAT, multicast, reserved space, IPv6 ULA, and
 * IPv4-mapped IPv6 addresses — which are unwrapped and re-checked, because
 * `::ffff:127.0.0.1` is loopback wearing a disguise.
 */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = parseIPv4(address);
  if (ipv4 !== null) return isPrivateIPv4(ipv4);

  const ipv6 = parseIPv6(address);
  if (ipv6 === null) return true; // Unparseable: refuse rather than guess.

  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = ipv6;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge as IPv4.
  const isMapped =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0);
  if (isMapped) {
    return isPrivateIPv4(((g6 << 16) | g7) >>> 0);
  }

  // Unspecified (::) and loopback (::1).
  const isZero = ipv6.every((group) => group === 0);
  if (isZero) return true;
  if (ipv6.slice(0, 7).every((group) => group === 0) && g7 === 1) return true;

  // Link-local fe80::/10.
  if ((g0 & 0xffc0) === 0xfe80) return true;
  // Unique local fc00::/7.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // Multicast ff00::/8.
  if ((g0 & 0xff00) === 0xff00) return true;
  // Documentation 2001:db8::/32.
  if (g0 === 0x2001 && g1 === 0x0db8) return true;

  return false;
}

function isPrivateIPv4(value: number): boolean {
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved

  return false;
}

/** Hostnames that must never be fetched, before any DNS lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    return true;
  }
  return false;
}

export type TargetVerdict = { allowed: true; url: URL } | { allowed: false; reason: string };

/**
 * Decide whether a caller-supplied URL may be fetched.
 *
 * Only http and https are permitted — `file:`, `gopher:`, `data:` and friends are
 * rejected outright, and credentials in the URL are refused because they leak
 * into logs.
 */
export function checkTargetUrl(raw: string): TargetVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'unparseable-url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `protocol-${url.protocol.replace(':', '')}` };
  }

  if (url.username !== '' || url.password !== '') {
    return { allowed: false, reason: 'credentials-in-url' };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    return { allowed: false, reason: 'blocked-hostname' };
  }

  // A literal IP needs no DNS, so it can be judged immediately.
  if (parseIPv4(hostname) !== null || parseIPv6(hostname) !== null) {
    if (isPrivateAddress(hostname)) {
      return { allowed: false, reason: 'private-address' };
    }
  }

  return { allowed: true, url };
}
