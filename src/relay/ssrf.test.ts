import { describe, expect, it } from 'vitest';
import { checkTargetUrl, isBlockedHostname, isPrivateAddress, parseIPv4, parseIPv6 } from './ssrf';

describe('parseIPv4', () => {
  it('parses dotted quads', () => {
    expect(parseIPv4('0.0.0.0')).toBe(0);
    expect(parseIPv4('127.0.0.1')).toBe(0x7f000001);
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
  });

  it('rejects malformed input', () => {
    expect(parseIPv4('1.2.3')).toBeNull();
    expect(parseIPv4('1.2.3.4.5')).toBeNull();
    expect(parseIPv4('256.1.1.1')).toBeNull();
    expect(parseIPv4('1.2.3.x')).toBeNull();
    expect(parseIPv4('::1')).toBeNull();
  });
});

describe('parseIPv6', () => {
  it('parses a full address', () => {
    expect(parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual([
      0x2001, 0x0db8, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('expands the :: shorthand', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2001:db8::')).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 0]);
  });

  it('parses the IPv4-mapped form', () => {
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    expect(parseIPv6('::ffff:192.168.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0001]);
  });

  it('strips a zone index', () => {
    expect(parseIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('rejects malformed input', () => {
    expect(parseIPv6('not:an:address')).toBeNull();
    expect(parseIPv6('1:2:3')).toBeNull();
    expect(parseIPv6('::1::2')).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254', // cloud metadata — the one that matters most
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.1',
    '198.18.0.1',
    '100.64.0.1',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fd00::1',
    'ff02::1',
    '2001:db8::1',
    // IPv4-mapped loopback: loopback wearing a disguise.
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
  ];

  it.each(blocked)('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  const allowed = [
    '1.1.1.1',
    '8.8.8.8',
    '91.98.4.78', // the actual Radio Browser node
    '172.15.0.1', // just outside 172.16/12
    '172.32.0.1',
    '100.63.255.255', // just outside CGNAT
    '100.128.0.1',
    '223.255.255.255', // just below multicast
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ];

  it.each(allowed)('allows %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('refuses rather than guesses when the address is unparseable', () => {
    expect(isPrivateAddress('not-an-address')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('isBlockedHostname', () => {
  it('blocks loopback and internal suffixes', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('LOCALHOST')).toBe(true);
    expect(isBlockedHostname('api.localhost')).toBe(true);
    expect(isBlockedHostname('printer.local')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('router.home.arpa')).toBe(true);
    expect(isBlockedHostname('')).toBe(true);
  });

  it('treats a trailing dot as the same name', () => {
    expect(isBlockedHostname('localhost.')).toBe(true);
  });

  it('allows ordinary hosts', () => {
    expect(isBlockedHostname('de1.api.radio-browser.info')).toBe(false);
    expect(isBlockedHostname('stream.example.com')).toBe(false);
    // Not a `.local` suffix, just a name that ends in those letters.
    expect(isBlockedHostname('notlocal.example')).toBe(false);
  });
});

describe('checkTargetUrl', () => {
  it('allows a public http or https URL', () => {
    const verdict = checkTargetUrl('http://stream.example.com/live.mp3');
    expect(verdict.allowed).toBe(true);
    expect(verdict.allowed && verdict.url.hostname).toBe('stream.example.com');

    expect(checkTargetUrl('https://example.com/a').allowed).toBe(true);
  });

  it('rejects non-http protocols', () => {
    for (const raw of [
      'file:///etc/passwd',
      'gopher://example.com',
      'data:text/plain,hi',
      'ftp://example.com',
    ]) {
      const verdict = checkTargetUrl(raw);
      expect(verdict.allowed, raw).toBe(false);
    }
  });

  it('rejects private IP literals without any DNS lookup', () => {
    expect(checkTargetUrl('http://169.254.169.254/latest/meta-data/')).toMatchObject({
      allowed: false,
      reason: 'private-address',
    });
    expect(checkTargetUrl('http://127.0.0.1:8080/').allowed).toBe(false);
    expect(checkTargetUrl('http://[::1]:8080/').allowed).toBe(false);
    expect(checkTargetUrl('http://10.0.0.5/').allowed).toBe(false);
  });

  it('rejects loopback hostnames', () => {
    expect(checkTargetUrl('http://localhost:3000/')).toMatchObject({
      allowed: false,
      reason: 'blocked-hostname',
    });
    expect(checkTargetUrl('http://metadata.google.internal/').allowed).toBe(false);
  });

  it('rejects credentials embedded in the URL', () => {
    expect(checkTargetUrl('http://user:pass@example.com/')).toMatchObject({
      allowed: false,
      reason: 'credentials-in-url',
    });
  });

  it('rejects unparseable input', () => {
    expect(checkTargetUrl('not a url')).toMatchObject({ allowed: false });
    expect(checkTargetUrl('').allowed).toBe(false);
  });

  it('allows a public hostname that needs DNS to judge', () => {
    // The literal is public; resolution is checked separately by the relay.
    expect(checkTargetUrl('http://evil.example.com/').allowed).toBe(true);
  });
});
