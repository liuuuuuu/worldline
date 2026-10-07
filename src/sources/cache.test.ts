import { describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbStore,
  createMemoryStore,
  createNoopStore,
  readThrough,
  type KeyValueStore,
} from './cache';

function brokenStore(): KeyValueStore {
  return {
    get: () => Promise.reject(new Error('indexedDB is unavailable')),
    set: () => Promise.reject(new Error('indexedDB is unavailable')),
    delete: () => Promise.reject(new Error('indexedDB is unavailable')),
  };
}

describe('createMemoryStore', () => {
  it('round-trips values and deletes them', async () => {
    const store = createMemoryStore();
    expect(await store.get('k')).toBeUndefined();

    await store.set('k', { a: 1 });
    expect(await store.get('k')).toEqual({ a: 1 });

    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });
});

describe('createNoopStore', () => {
  it('never returns anything', async () => {
    const store = createNoopStore();
    await store.set('k', 1);
    expect(await store.get('k')).toBeUndefined();
  });
});

describe('createIndexedDbStore', () => {
  it('degrades gracefully when IndexedDB cannot be opened', async () => {
    const blockedFactory = {
      open: () => {
        throw new Error('IndexedDB is blocked in this context');
      },
    } as unknown as IDBFactory;

    const store = createIndexedDbStore(blockedFactory);

    await expect(store.set('k', 'v')).resolves.toBeUndefined();
    await expect(store.get('k')).resolves.toBeUndefined();
    await expect(store.delete('k')).resolves.toBeUndefined();
  });

  it('falls back to memory when no IndexedDB exists at all', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });

    try {
      const store = createIndexedDbStore();
      await store.set('k', 'v');
      expect(await store.get('k')).toBe('v');
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'indexedDB', original);
      } else {
        Reflect.deleteProperty(globalThis, 'indexedDB');
      }
    }
  });
});

describe('readThrough', () => {
  it('loads and caches on a cold cache', async () => {
    const store = createMemoryStore();
    const load = vi.fn().mockResolvedValue(['a', 'b']);

    const result = await readThrough({ store, key: 'k', load, now: () => 1000 });

    expect(result).toMatchObject({ value: ['a', 'b'], fromCache: false, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await store.get('k')).toEqual({ value: ['a', 'b'], storedAt: 1000 });
  });

  it('serves a fresh entry without loading', async () => {
    const store = createMemoryStore();
    await store.set('k', { value: 'cached', storedAt: 1000 });
    const load = vi.fn().mockResolvedValue('live');

    const result = await readThrough({ store, key: 'k', load, ttlMs: 500, now: () => 1200 });

    expect(result).toMatchObject({
      value: 'cached',
      fromCache: true,
      stale: false,
      storedAt: 1000,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('reloads once the entry expires', async () => {
    const store = createMemoryStore();
    await store.set('k', { value: 'cached', storedAt: 1000 });
    const load = vi.fn().mockResolvedValue('live');

    const result = await readThrough({ store, key: 'k', load, ttlMs: 500, now: () => 1600 });

    expect(result).toMatchObject({ value: 'live', fromCache: false, stale: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('treats an entry exactly at the TTL boundary as expired', async () => {
    const store = createMemoryStore();
    await store.set('k', { value: 'cached', storedAt: 1000 });
    const load = vi.fn().mockResolvedValue('live');

    await readThrough({ store, key: 'k', load, ttlMs: 500, now: () => 1500 });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falls back to a stale entry when the live load fails', async () => {
    const store = createMemoryStore();
    await store.set('k', { value: 'stale-but-usable', storedAt: 1000 });
    const load = vi.fn().mockRejectedValue(new Error('all mirrors down'));
    const onStaleFallback = vi.fn();

    const result = await readThrough({
      store,
      key: 'k',
      load,
      ttlMs: 500,
      now: () => 9000,
      onStaleFallback,
    });

    expect(result).toMatchObject({ value: 'stale-but-usable', fromCache: true, stale: true });
    expect(onStaleFallback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rethrows when the load fails and there is nothing cached', async () => {
    const store = createMemoryStore();
    const load = vi.fn().mockRejectedValue(new Error('all mirrors down'));

    await expect(readThrough({ store, key: 'k', load })).rejects.toThrow('all mirrors down');
  });

  it('ignores malformed cache entries', async () => {
    const store = createMemoryStore();
    await store.set('k', { nonsense: true });
    const load = vi.fn().mockResolvedValue('live');

    const result = await readThrough({ store, key: 'k', load, now: () => 1000 });

    expect(result).toMatchObject({ value: 'live', fromCache: false });
  });

  it('does not break when the store itself is broken', async () => {
    const load = vi.fn().mockResolvedValue('live');

    const result = await readThrough({ store: brokenStore(), key: 'k', load, now: () => 1000 });

    expect(result.value).toBe('live');
  });

  it('still returns the value when the cache write fails', async () => {
    const store: KeyValueStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('quota exceeded')),
      delete: () => Promise.resolve(),
    };
    const load = vi.fn().mockResolvedValue('live');

    await expect(readThrough({ store, key: 'k', load })).resolves.toMatchObject({ value: 'live' });
  });
});
