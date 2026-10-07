import { describe, expect, it } from 'vitest';
import {
  isPayloadOfType,
  SourceError,
  SourceRegistry,
  type AudioStreamPayload,
  type ImagePayload,
  type MetaPayload,
  type Payload,
  type Source,
} from './source';

function audioSource(id: string): Source<AudioStreamPayload> {
  return {
    manifest: {
      id,
      name: id,
      channels: ['audio'],
      requiresGeo: false,
      attribution: 'test',
    },
    discover: () => Promise.resolve([]),
  };
}

function visualSource(id: string): Source<ImagePayload> {
  return {
    manifest: {
      id,
      name: id,
      channels: ['visual'],
      requiresGeo: true,
      attribution: 'test',
    },
    discover: () => Promise.resolve([]),
  };
}

describe('SourceRegistry', () => {
  it('registers and retrieves by id', () => {
    const registry = new SourceRegistry();
    const source = audioSource('radio-browser');

    registry.register(source);

    expect(registry.get('radio-browser')).toBe(source);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('lists everything in registration order', () => {
    const registry = new SourceRegistry();
    registry.register(audioSource('a'));
    registry.register(visualSource('b'));

    expect(registry.all().map((source) => source.manifest.id)).toEqual(['a', 'b']);
  });

  it('filters by channel', () => {
    const registry = new SourceRegistry();
    registry.register(audioSource('radio'));
    registry.register(visualSource('gibs'));

    expect(registry.byChannel('audio').map((source) => source.manifest.id)).toEqual(['radio']);
    expect(registry.byChannel('visual').map((source) => source.manifest.id)).toEqual(['gibs']);
    expect(registry.byChannel('meta')).toEqual([]);
  });

  it('refuses duplicate ids', () => {
    const registry = new SourceRegistry();
    registry.register(audioSource('dup'));

    expect(() => {
      registry.register(audioSource('dup'));
    }).toThrow(SourceError);
  });
});

describe('isPayloadOfType', () => {
  const audio: Payload = {
    type: 'audio-stream',
    sourceId: 'radio-browser',
    url: 'http://example.com/s',
    codec: 'MP3',
    bitrate: 128,
    title: 'Test',
    hls: false,
  };

  const meta: MetaPayload = {
    type: 'meta',
    kind: 'weather',
    sourceId: 'open-meteo',
    data: { temperatureC: 18 },
  };

  it('narrows the union by type', () => {
    expect(isPayloadOfType(audio, 'audio-stream')).toBe(true);
    expect(isPayloadOfType(audio, 'meta')).toBe(false);
    expect(isPayloadOfType(meta, 'meta')).toBe(true);
  });
});

describe('SourceError', () => {
  it('carries a machine-readable code', () => {
    const error = new SourceError('no-mirror', 'everything failed');

    expect(error.code).toBe('no-mirror');
    expect(error.name).toBe('SourceError');
    expect(error).toBeInstanceOf(Error);
  });

  it('only exposes endpoint when one was supplied', () => {
    const withEndpoint = new SourceError('network', 'boom', { endpoint: 'https://a.test' });
    const withoutEndpoint = new SourceError('network', 'boom');

    expect(withEndpoint.endpoint).toBe('https://a.test');
    expect('endpoint' in withoutEndpoint).toBe(false);
  });

  it('preserves the cause for debugging', () => {
    const cause = new Error('root cause');
    expect(new SourceError('unknown', 'wrapped', { cause }).cause).toBe(cause);
  });
});
