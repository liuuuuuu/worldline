import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAY_PATH, needsRelay, relaySubResource, resolveStreamUrl } from './streamUrl';

describe('needsRelay', () => {
  it('is true only for plain http', () => {
    expect(needsRelay('http://stream.example.com/live')).toBe(true);
    expect(needsRelay('https://stream.example.com/live')).toBe(false);
    expect(needsRelay('//stream.example.com/live')).toBe(false);
    expect(needsRelay('')).toBe(false);
  });
});

describe('resolveStreamUrl', () => {
  const uuid = 'a1b2c3d4-0000-0000-0000-000000000000';

  it('routes an http stream through the relay by station id', () => {
    // By id, never by URL: a caller must not be able to name an arbitrary target.
    expect(resolveStreamUrl('http://stream.example.com/live', uuid)).toBe(
      `${DEFAULT_RELAY_PATH}?uuid=${uuid}`,
    );
  });

  it('leaves an https stream alone', () => {
    // Proxying it would spend host bandwidth to gain nothing.
    expect(resolveStreamUrl('https://stream.example.com/live', uuid)).toBe(
      'https://stream.example.com/live',
    );
  });

  it('escapes the station id', () => {
    expect(resolveStreamUrl('http://x/y', 'a b&c')).toBe(
      `${DEFAULT_RELAY_PATH}?uuid=${encodeURIComponent('a b&c')}`,
    );
  });

  it('honours a custom mount path', () => {
    expect(resolveStreamUrl('http://x/y', uuid, { relayPath: '/relay' })).toBe(
      `/relay?uuid=${uuid}`,
    );
  });

  it('passes everything through when the relay is disabled', () => {
    expect(resolveStreamUrl('http://x/y', uuid, { enabled: false })).toBe('http://x/y');
    expect(resolveStreamUrl('https://x/y', uuid, { enabled: false })).toBe('https://x/y');
  });
});

describe('relaySubResource', () => {
  it('passes the absolute URL, escaped', () => {
    const segment = 'http://cdn.example.com/a/b.ts?token=1';
    expect(relaySubResource(segment)).toBe(
      `${DEFAULT_RELAY_PATH}?u=${encodeURIComponent(segment)}`,
    );
  });

  it('is idempotent enough to survive being applied twice by accident', () => {
    const once = relaySubResource('http://cdn.example.com/a.ts');
    const twice = relaySubResource(once);
    // Not a correctness requirement, but it must not throw or mangle the string.
    expect(twice).toContain(encodeURIComponent(once));
  });
});
