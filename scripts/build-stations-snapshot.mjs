/**
 * Build the bundled station snapshot.
 *
 * Run with `npm run snapshot`. Writes `public/stations.snapshot.json`, which the
 * app loads at startup so the globe is populated in ~100ms instead of waiting
 * ~130s for 150 country requests (ADR-0004).
 *
 * Records are written in Radio Browser's own field names so the app can run them
 * through the same parser and mapper as live responses — see the note at the top
 * of `src/sources/snapshot.ts`.
 *
 * Not run in CI: it takes minutes and depends on a volunteer-run service being
 * up. Regenerate it when releasing.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MIRROR = process.env.RB_MIRROR ?? 'https://de1.api.radio-browser.info';
const COUNTRY_COUNT = Number(process.env.RB_COUNTRY_COUNT ?? 150);
const PER_COUNTRY = Number(process.env.RB_PER_COUNTRY ?? 20);
const CONCURRENCY = 3;
const TIMEOUT_MS = 45_000;
const RETRIES = 2;
const OUTPUT = resolve(process.cwd(), 'public/stations.snapshot.json');

/** Fields `toStation` actually reads. Dropping the rest saves ~30% of the file. */
const FIELDS = [
  'stationuuid',
  'name',
  'url',
  'url_resolved',
  'homepage',
  'favicon',
  'tags',
  'country',
  'countrycode',
  'state',
  'language',
  'votes',
  'codec',
  'bitrate',
  'hls',
  'lastcheckok',
  'geo_lat',
  'geo_long',
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function getJson(path) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);

    try {
      const response = await fetch(`${MIRROR}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${path} failed after ${RETRIES} attempts: ${String(lastError)}`);
}

async function mapWithConcurrency(items, limit, run) {
  const results = [];
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results.push(await run(items[index], index));
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function pick(record) {
  const trimmed = {};
  for (const field of FIELDS) {
    trimmed[field] = record[field] ?? null;
  }
  return trimmed;
}

async function main() {
  const started = Date.now();

  console.log(`mirror: ${MIRROR}`);
  const countries = await getJson('/json/countries');
  const chosen = countries
    .filter((country) => (country.stationcount ?? 0) > 0 && country.iso_3166_1)
    .sort((a, b) => b.stationcount - a.stationcount)
    .slice(0, COUNTRY_COUNT);

  console.log(`countries: ${chosen.length} of ${countries.length}`);

  const byId = new Map();
  let failed = 0;
  let done = 0;

  await mapWithConcurrency(chosen, CONCURRENCY, async (country) => {
    const code = country.iso_3166_1.toUpperCase();
    const path =
      `/json/stations/search?order=votes&reverse=true&limit=${PER_COUNTRY}&offset=0` +
      `&countrycode=${code}&has_geo_info=true&hidebroken=true`;

    try {
      const stations = await getJson(path);
      for (const station of stations) {
        if (!station.stationuuid || !byId.has(station.stationuuid)) {
          byId.set(station.stationuuid, pick(station));
        }
      }
    } catch (error) {
      failed += 1;
      console.warn(`  ${code} failed: ${String(error)}`);
    }

    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${chosen.length} countries, ${byId.size} stations`);
  });

  const stations = [...byId.values()].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));

  const coveredCountries = new Set(
    stations.map((station) => String(station.countrycode ?? '').toUpperCase()).filter(Boolean),
  ).size;
  const withGeo = stations.filter(
    (station) => station.geo_lat !== null && station.geo_long !== null,
  ).length;

  const payload = {
    generatedAt: new Date().toISOString(),
    source: `${MIRROR} (Radio Browser, community-maintained)`,
    count: stations.length,
    stations,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(payload));

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log('');
  console.log(`stations       : ${stations.length}`);
  console.log(`with geo       : ${withGeo}`);
  console.log(`countries      : ${coveredCountries}`);
  console.log(`failed requests: ${failed}`);
  console.log(`file size      : ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`elapsed        : ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`written        : ${OUTPUT}`);

  if (stations.length === 0) {
    console.error('\nRefusing to ship an empty snapshot.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
