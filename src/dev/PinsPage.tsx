/**
 * L3 verification page — `/dev/pins`.
 *
 * Answers the two halves of the P3 exit criterion with real numbers:
 *
 *  - *3000 pins at ≥50 fps* — but the directory only yields ~1000 geolocated
 *    stations on this network, so the frame-rate claim is measured against
 *    **synthetic** pins. Testing the renderer with 1000 pins and calling it
 *    "3000 verified" would be a lie.
 *  - *accurate clicks* — a hover tooltip and a picked-station card, so a
 *    mis-hit is immediately visible rather than hidden behind a passing test.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import GlobeScene, { type HoverInfo, type SceneStats } from '../scene/GlobeScene';
import { discoverStations, type PageProgress } from '../sources/radioBrowser';
import { SourceError } from '../types/source';
import type { Station } from '../types/domain';
import { navigate } from './router';

const MAX_STATIONS = 4000;
const STRESS_PIN_COUNT = 3000;
/**
 * `by-country` rather than the global top-voted list.
 *
 * Measured: the global list puts ~19% of its rows in a single country, so the
 * globe renders as a Europe/US blob with most of the planet bare. Asking each of
 * the 150 largest countries for 20 stations costs about the same wall-clock time
 * — a 20-row country request is ~25 KB against ~320 KB for a 250-row global page
 * — and covers the map.
 *
 * A flat per-country quota is the whole point: it is what turns a popularity
 * ranking into a geographic spread.
 */
const COUNTRY_COUNT = 150;
const PER_COUNTRY = 20;

/**
 * Idle spin, overridable with `?spin=0` so screenshots and coverage
 * measurements are reproducible — otherwise every capture catches the globe at
 * whatever angle the spin happened to be at.
 */
const IDLE_SPIN = (() => {
  const raw = new URLSearchParams(window.location.search).get('spin');
  if (raw === null) return 0.03;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0.03;
})();

type Mode = 'live' | 'stress';

function describeError(error: unknown): string {
  if (error instanceof SourceError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Deterministic pseudo-random pins spread over the sphere.
 *
 * Area-correct: `lat = asin(2u - 1)` rather than a uniform draw, so the pins do
 * not clump at the poles. A naive uniform latitude would put most of the load in
 * a small screen area and understate the real cost.
 */
function makeStressStations(count: number): Station[] {
  let seed = 0x9e3779b9;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  return Array.from({ length: count }, (_, index) => ({
    id: `stress-${index}`,
    name: `Stress station ${index}`,
    streamUrl: 'http://example.invalid/stream',
    tags: [],
    country: 'Test',
    countryCode: 'XX',
    votes: index,
    codec: 'MP3',
    bitrate: 128,
    hls: false,
    healthy: true,
    geo: {
      lat: Math.asin(2 * random() - 1) * (180 / Math.PI),
      lng: random() * 360 - 180,
    },
  }));
}

const panel: React.CSSProperties = {
  position: 'absolute',
  background: 'rgba(20, 17, 14, 0.72)',
  border: '1px solid var(--wl-border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 12,
  lineHeight: 1.65,
  color: 'var(--wl-text-dim)',
  pointerEvents: 'none',
};

const button: React.CSSProperties = {
  background: 'rgba(20,17,14,0.72)',
  border: '1px solid var(--wl-border)',
  color: 'var(--wl-text-dim)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

export default function PinsPage() {
  const [mode, setMode] = useState<Mode>('live');
  const [reloadToken, setReloadToken] = useState(0);
  const [liveStations, setLiveStations] = useState<readonly Station[]>([]);
  const [progress, setProgress] = useState<PageProgress>({ loaded: 0, target: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [picked, setPicked] = useState<Station | null>(null);

  // Derived, not stored: putting the stress set in state would mean writing
  // state synchronously inside an effect.
  const stressStations = useMemo(() => makeStressStations(STRESS_PIN_COUNT), []);
  const stations = mode === 'stress' ? stressStations : liveStations;

  /**
   * How many countries the pins actually cover.
   *
   * A deterministic coverage number, unlike "what fraction of the visible globe
   * has a pin" — that depends on which hemisphere the idle spin happens to be
   * showing when you look.
   */
  const countryTotal = useMemo(
    () => new Set(stations.map((station) => station.countryCode).filter(Boolean)).size,
    [stations],
  );

  useEffect(() => {
    if (mode !== 'live') return undefined;

    const controller = new AbortController();

    discoverStations({
      signal: controller.signal,
      selection: 'by-country',
      countryCount: COUNTRY_COUNT,
      perCountry: PER_COUNTRY,
      maxStations: MAX_STATIONS,
      onPage: (list, pageProgress) => {
        if (controller.signal.aborted) return;
        setLiveStations([...list]);
        setProgress(pageProgress);
      },
    })
      .then((discovery) => {
        if (controller.signal.aborted) return;
        setLiveStations([...discovery.stations]);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(describeError(caught));
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [mode, reloadToken]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setProgress({ loaded: 0, target: MAX_STATIONS, failed: 0 });
    setStats(null);
    setPicked(null);
    setReloadToken((token) => token + 1);
  }, []);

  const switchMode = useCallback((next: Mode) => {
    setStats(null);
    setPicked(null);
    setHover(null);
    setError(null);
    setLoading(next === 'live');
    setProgress({ loaded: 0, target: MAX_STATIONS, failed: 0 });
    setMode(next);
  }, []);

  return (
    <main style={{ position: 'fixed', inset: 0, background: '#14110e' }}>
      <GlobeScene
        stations={stations}
        onStats={setStats}
        onHover={setHover}
        onPick={setPicked}
        idleSpin={IDLE_SPIN}
      />

      <div style={{ ...panel, top: 20, left: 24 }}>
        <div style={{ color: 'var(--wl-brass)', letterSpacing: '0.08em' }}>
          L3 交互层 · /dev/pins
        </div>
        <div data-testid="pins-fps">fps {stats?.fps ?? '—'}</div>
        <div data-testid="pins-count">pins {(stats?.pinCount ?? 0).toLocaleString('en-US')}</div>
        <div>triangles {(stats?.triangles ?? 0).toLocaleString('en-US')}</div>
        <div>draw calls {stats?.drawCalls ?? '—'}</div>
        <div>frames {(stats?.frames ?? 0).toLocaleString('en-US')}</div>
        <div style={{ marginTop: 6 }}>
          数据源 {mode === 'live' ? `真实 ${stations.length}` : `压测 ${stations.length}`}
        </div>
        <div data-testid="pins-countries">覆盖国家/地区 {countryTotal}</div>
        {loading && mode === 'live' && (
          <div data-testid="pins-loading" style={{ color: 'var(--wl-brass)' }}>
            拉取中 {progress.loaded} / {progress.target}
            {progress.failed > 0 ? ` · ${progress.failed} 页失败` : ''}
          </div>
        )}
        {error && (
          <div data-testid="pins-error" style={{ color: '#e2726e' }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', top: 20, right: 24, display: 'flex', gap: 8 }}>
        <button
          type="button"
          style={{ ...button, pointerEvents: 'auto' }}
          onClick={() => {
            switchMode(mode === 'live' ? 'stress' : 'live');
          }}
        >
          {mode === 'live' ? `压测 ${STRESS_PIN_COUNT} 钉` : '切回真实数据'}
        </button>
        <button type="button" style={{ ...button, pointerEvents: 'auto' }} onClick={reload}>
          重载
        </button>
        <button
          type="button"
          style={{ ...button, pointerEvents: 'auto' }}
          onClick={() => {
            navigate('/');
          }}
        >
          返回
        </button>
      </div>

      {hover && (
        <div
          data-testid="pins-tooltip"
          style={{
            ...panel,
            left: Math.min(hover.x + 16, window.innerWidth - 260),
            top: Math.min(hover.y + 16, window.innerHeight - 90),
            maxWidth: 240,
            color: 'var(--wl-text)',
          }}
        >
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {hover.station.name}
          </div>
          <div style={{ color: 'var(--wl-text-dim)' }}>
            {hover.station.countryCode || '??'} · {hover.station.votes.toLocaleString('en-US')} 票
          </div>
          <div style={{ color: 'var(--wl-text-dim)' }}>
            {hover.station.geo
              ? `${hover.station.geo.lat.toFixed(2)}, ${hover.station.geo.lng.toFixed(2)}`
              : '无坐标'}
          </div>
        </div>
      )}

      {picked && (
        <div
          data-testid="pins-picked"
          style={{
            ...panel,
            left: 24,
            bottom: 24,
            color: 'var(--wl-text)',
            maxWidth: 420,
          }}
        >
          <div style={{ color: 'var(--wl-brass)', letterSpacing: '0.08em' }}>已选中</div>
          <div
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {picked.name}
          </div>
          <div style={{ color: 'var(--wl-text-dim)' }}>
            {picked.country || '—'} · {picked.codec} {picked.bitrate}kbps ·{' '}
            {picked.votes.toLocaleString('en-US')} 票
          </div>
          <div style={{ color: 'var(--wl-text-dim)' }}>
            {picked.geo ? `${picked.geo.lat.toFixed(4)}, ${picked.geo.lng.toFixed(4)}` : '无坐标'}
          </div>
        </div>
      )}
    </main>
  );
}
