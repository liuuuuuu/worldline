/**
 * Bundled station snapshot.
 *
 * The by-country load is ~150 requests and takes ~130s cold (ADR-0004). That is
 * unacceptable for a first launch, so the build ships a snapshot: the globe is
 * populated in ~100ms from a local file, and the live load runs on top and
 * replaces it.
 *
 * The snapshot is also the answer to the `de1` single-point dependency — if every
 * mirror is down, the app still has a globe full of stations instead of an error.
 *
 * ## Why this stores raw upstream records
 *
 * The file holds records in Radio Browser's own field names, not our `Station`
 * shape. That means the mapping lives in exactly one place (`toStation`) and the
 * snapshot is validated by the same `parseRadioBrowserStations` that guards live
 * responses. Trimming to our shape would save ~30% of the file and cost a second
 * copy of the mapping that could silently drift.
 */

import { z } from 'zod';

export const DEFAULT_SNAPSHOT_URL = '/stations.snapshot.json';

/**
 * Only the envelope is validated here.
 *
 * `stations` stays `unknown[]` on purpose: those records are validated by
 * `parseRadioBrowserStations`, which is already tested against real responses.
 * Duplicating that schema would create two sources of truth.
 */
export const snapshotFileSchema = z.object({
  generatedAt: z.string(),
  source: z.string(),
  count: z.number(),
  stations: z.array(z.unknown()),
});

export type SnapshotFile = z.infer<typeof snapshotFileSchema>;

export interface LoadedSnapshot {
  /** Raw upstream-shaped records. */
  records: unknown[];
  generatedAt: string;
  /** Age in ms, or null when the timestamp is unparseable. */
  ageMs: number | null;
}

/**
 * Fetch and validate the bundled snapshot.
 *
 * Returns `null` rather than throwing for every failure mode — a missing or
 * malformed snapshot is a degradation, not an error the user should see. The
 * caller falls back to the network path.
 */
export async function loadSnapshot(
  url: string = DEFAULT_SNAPSHOT_URL,
  now: () => number = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedSnapshot | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;

    const parsed = snapshotFileSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    if (parsed.data.stations.length === 0) return null;

    const generatedAt = Date.parse(parsed.data.generatedAt);
    return {
      records: parsed.data.stations,
      generatedAt: parsed.data.generatedAt,
      ageMs: Number.isFinite(generatedAt) ? Math.max(0, now() - generatedAt) : null,
    };
  } catch {
    return null;
  }
}
