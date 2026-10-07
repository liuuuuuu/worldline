/**
 * Cache layer.
 *
 * Two behaviours matter here beyond "remember things":
 *
 *  1. **A cache failure must never break the app.** Every store call is wrapped;
 *     a broken IndexedDB degrades to "no cache", not to a crash.
 *  2. **Stale beats nothing.** If the live request fails but we have an expired
 *     entry, we serve the expired entry and flag it as stale. Radio Browser
 *     mirrors go down; the user should still see their pins.
 */

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms. */
  storedAt: number;
}

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Volatile store. Used in tests and as the fallback when IndexedDB is absent. */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

/** Store that remembers nothing. Useful to force a live fetch in tests. */
export function createNoopStore(): KeyValueStore {
  return {
    get: () => Promise.resolve(undefined),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

const DB_NAME = 'worldline';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * IndexedDB-backed store.
 *
 * Falls back to an in-memory store when IndexedDB is unavailable (private
 * windows, jsdom, locked-down environments) so callers never have to care.
 */
export function createIndexedDbStore(factory?: IDBFactory): KeyValueStore {
  const idb = factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!idb) return createMemoryStore();

  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = (): Promise<IDBDatabase> => {
    dbPromise ??= openDatabase(idb).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };

  return {
    async get(key) {
      try {
        return await runTransaction<unknown>(await getDb(), 'readonly', (store) => store.get(key));
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        await runTransaction(await getDb(), 'readwrite', (store) => store.put(value, key));
      } catch {
        // Cache writes are best-effort.
      }
    },
    async delete(key) {
      try {
        await runTransaction(await getDb(), 'readwrite', (store) => store.delete(key));
      } catch {
        // Best-effort.
      }
    },
  };
}

/** IndexedDB when available, memory otherwise. The default for app code. */
export function createDefaultStore(): KeyValueStore {
  return createIndexedDbStore();
}

export interface ReadThroughResult<T> {
  value: T;
  fromCache: boolean;
  /** Served from an expired entry because the live load failed. */
  stale: boolean;
  storedAt: number;
}

export interface ReadThroughOptions<T> {
  store: KeyValueStore;
  key: string;
  load: () => Promise<T>;
  ttlMs?: number;
  now?: () => number;
  onStaleFallback?: (error: unknown) => void;
}

function asEntry<T>(raw: unknown): CacheEntry<T> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as { value?: unknown; storedAt?: unknown };
  if (typeof candidate.storedAt !== 'number' || !Number.isFinite(candidate.storedAt)) return null;
  if (!('value' in candidate)) return null;
  return { value: candidate.value as T, storedAt: candidate.storedAt };
}

/**
 * A store that throws must not take the app down with it. Callers inject stores
 * (tests, alternate backends), so we cannot assume they swallow their own errors.
 */
async function safeGet(store: KeyValueStore, key: string): Promise<unknown> {
  try {
    return await store.get(key);
  } catch {
    return undefined;
  }
}

async function safeSet(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  try {
    await store.set(key, value);
  } catch {
    // Caching is best-effort; a failed write must not fail the read.
  }
}

/**
 * Return a cached value if fresh, otherwise load it and cache the result.
 * On load failure, fall back to a stale entry when one exists.
 */
export async function readThrough<T>(
  options: ReadThroughOptions<T>,
): Promise<ReadThroughResult<T>> {
  const { store, key, load, ttlMs = DEFAULT_TTL_MS, now = Date.now, onStaleFallback } = options;

  const entry = asEntry<T>(await safeGet(store, key));
  const currentTime = now();

  if (entry && currentTime - entry.storedAt < ttlMs) {
    return { value: entry.value, fromCache: true, stale: false, storedAt: entry.storedAt };
  }

  try {
    const value = await load();
    const storedAt = now();
    await safeSet(store, key, { value, storedAt } satisfies CacheEntry<T>);
    return { value, fromCache: false, stale: false, storedAt };
  } catch (error) {
    if (entry) {
      onStaleFallback?.(error);
      return { value: entry.value, fromCache: true, stale: true, storedAt: entry.storedAt };
    }
    throw error;
  }
}
