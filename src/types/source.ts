/**
 * The Source plugin contract.
 *
 * This is the architectural core of Worldline. Everything that feeds the app —
 * radio stations, ambient soundscapes, live cameras, wallpaper imagery — is a
 * `Source`. The kernel only ever sees a `Payload`, never a concrete data source,
 * so adding a new content source means adding a Source, not editing the kernel.
 *
 * The design problem this solves: a radio station and a wallpaper are completely
 * different things. They share one lifecycle anyway, because `discover()` is a
 * uniform entry point ("given a place, hand me payloads") and the returned
 * `Payload` is a discriminated union keyed on `type`.
 *
 * Do NOT add `if (sourceId === 'radio-browser')` branches to the kernel. If a
 * new source needs a new kind of thing, add a new `Payload` variant and a
 * matching Renderer.
 */

/** A point on Earth, in WGS-84 decimal degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A place we can label in the UI. */
export interface Place extends GeoPoint {
  name: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode?: string;
  country?: string;
  region?: string;
}

/**
 * What a Source is capable of producing.
 *
 * - `audio`  — a continuous stream of sound
 * - `visual` — imagery that can be rendered (wallpaper, tiles, video)
 * - `meta`   — descriptive data only (weather, local time, daylight)
 */
export type Channel = 'audio' | 'visual' | 'meta';

/** Fields every payload carries, regardless of kind. */
export interface PayloadBase {
  /** Id of the Source that produced this payload. */
  sourceId: string;
  /** Where this payload came from, when it is tied to a place. */
  origin?: GeoPoint;
  /** Short human-readable label for UI. */
  label?: string;
  /** Attribution string required by the upstream licence, if any. */
  attribution?: string;
}

/** A continuous audio stream (internet radio, soundscape, ...). */
export interface AudioStreamPayload extends PayloadBase {
  type: 'audio-stream';
  /** Resolved, directly playable stream URL. */
  url: string;
  codec: string;
  /** kbps. 0 when the upstream does not report it. */
  bitrate: number;
  /** Station / track title. */
  title: string;
  /** Whether the stream is an HLS playlist rather than a raw stream. */
  hls: boolean;
}

/** A single still image, usable as a wallpaper frame. */
export interface ImagePayload extends PayloadBase {
  type: 'image';
  url: string;
}

/** A slippy-map tile layer (URL template with `{z}`/`{x}`/`{y}`). */
export interface TileLayerPayload extends PayloadBase {
  type: 'tile-layer';
  template: string;
}

/** A live video feed. */
export interface LiveCameraPayload extends PayloadBase {
  type: 'live-camera';
  url: string;
  format: 'hls' | 'mjpeg';
}

/**
 * Descriptive data that has no renderable artifact of its own — weather, local
 * time, daylight state. Consumed by the scheduling layer and by UI chrome rather
 * than by a Renderer.
 *
 * `kind` discriminates the shape of `data`. Keep `data` flat and primitive: it
 * crosses the plugin boundary, so it must stay serialisable.
 */
export interface MetaPayload extends PayloadBase {
  type: 'meta';
  kind: string;
  data: Readonly<Record<string, string | number | boolean>>;
}

export type Payload =
  AudioStreamPayload | ImagePayload | TileLayerPayload | LiveCameraPayload | MetaPayload;

export type PayloadType = Payload['type'];

/** Narrow `Payload` to the variant with a given `type`. */
export type PayloadOf<T extends PayloadType> = Extract<Payload, { type: T }>;

/** Everything the kernel needs to know about a Source before calling it. */
export interface SourceManifest {
  /** Stable, unique, kebab-case. Used as `PayloadBase.sourceId`. */
  id: string;
  /** Human-readable name for UI and logs. */
  name: string;
  /** What this source can produce. */
  channels: readonly Channel[];
  /** True when `discover()` needs a `geo` to return anything useful. */
  requiresGeo: boolean;
  /** Licence / credit line to surface in the UI. */
  attribution: string;
}

export interface DiscoverContext {
  /** Required when `manifest.requiresGeo` is true. */
  geo?: GeoPoint;
  /** BCP-47 tag, e.g. `zh-CN`. */
  locale: string;
  /** Soft cap on how many payloads to return. */
  limit?: number;
  /** Always provided. Sources must honour it. */
  signal: AbortSignal;
}

export interface SourceContext {
  signal: AbortSignal;
}

/** A live resource handed back by `connect()`. Closing must be idempotent. */
export interface Handle {
  close(): Promise<void>;
}

/** A source of payloads. */
export interface Source<P extends Payload = Payload> {
  readonly manifest: SourceManifest;
  /** Hand back payloads. Must not throw for "no results" — return `[]`. */
  discover(ctx: DiscoverContext): Promise<P[]>;
  /** Only implemented by streaming sources. */
  connect?(payload: P, ctx: SourceContext): Promise<Handle>;
}

/** Discriminate a payload list by kind. */
export function isPayloadOfType<T extends PayloadType>(
  payload: Payload,
  type: T,
): payload is PayloadOf<T> {
  return payload.type === type;
}

/** Error codes the kernel and sources agree on. */
export type SourceErrorCode =
  'network' | 'timeout' | 'aborted' | 'bad-response' | 'no-mirror' | 'unknown';

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  /**
   * Upstream host or mirror that failed, when known.
   *
   * `declare` so the property is genuinely absent when not supplied, rather than
   * being defined as `undefined` — `'endpoint' in error` should mean something.
   */
  declare readonly endpoint?: string;

  constructor(
    code: SourceErrorCode,
    message: string,
    options?: { endpoint?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SourceError';
    this.code = code;
    if (options?.endpoint !== undefined) {
      this.endpoint = options.endpoint;
    }
  }
}

/**
 * Minimal kernel registry.
 *
 * Deliberately tiny: it exists so that the abstraction is exercised from day one
 * rather than being retrofitted once there are three sources and no time.
 */
export class SourceRegistry {
  readonly #sources = new Map<string, Source>();

  register(source: Source): void {
    const { id } = source.manifest;
    if (this.#sources.has(id)) {
      throw new SourceError('unknown', `Source "${id}" is already registered`);
    }
    this.#sources.set(id, source);
  }

  get(id: string): Source | undefined {
    return this.#sources.get(id);
  }

  all(): readonly Source[] {
    return [...this.#sources.values()];
  }

  byChannel(channel: Channel): readonly Source[] {
    return this.all().filter((source) => source.manifest.channels.includes(channel));
  }
}
