/**
 * L1 verification page — `/dev/data`.
 *
 * Per `docs/ARCHITECTURE.md`, every layer gets a page that exercises it in
 * isolation. This one exists to answer the P1 exit question with real network
 * calls rather than mocks: *can we actually get 3000 geolocated stations and the
 * weather/timezone for any coordinate?*
 *
 * It also deliberately surfaces the ugly parts — mirror used, cache hit or miss,
 * stale fallback, reject count, how many stations have no coordinates — because
 * those are the numbers that belong in PROGRESS.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverStations, type PageProgress } from '../sources/radioBrowser';
import { fetchWeather } from '../sources/weather';
import { localTimeAt } from '../sources/time';
import { createNoopStore } from '../sources/cache';
import { SourceError } from '../types/source';
import type { DiscoveryMeta, Station, WeatherSnapshot } from '../types/domain';

const DEFAULT_LAT = '35.6895';
const DEFAULT_LNG = '139.6917';

/**
 * Measured 2026-10-07: a 250-row page is ~320 KB and takes 14–29s from this
 * network, and 3000 rows in one request never completes. Hence small pages.
 */
const PAGE_SIZE = 250;
const MAX_STATIONS = 1000;

interface LoadState<T> {
  data: T | null;
  meta: DiscoveryMeta | null;
  error: string | null;
  loading: boolean;
  elapsedMs: number | null;
}

/**
 * Starts in `loading: true` because every panel fetches on mount, and `run()`
 * only touches state *after* an await — setting state synchronously inside an
 * effect body would trigger a cascading render.
 */
function pendingState<T>(): LoadState<T> {
  return { data: null, meta: null, error: null, loading: true, elapsedMs: null };
}

function describeError(error: unknown): string {
  if (error instanceof SourceError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

const card: React.CSSProperties = {
  background: 'var(--wl-surface)',
  border: '1px solid var(--wl-border)',
  borderRadius: 10,
  padding: 16,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '5px 0',
  fontSize: 13,
  borderBottom: '1px solid var(--wl-border)',
};

const label: React.CSSProperties = { color: 'var(--wl-text-dim)' };
const value: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', textAlign: 'right' };
const button: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--wl-brass)',
  color: 'var(--wl-brass)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};

function KeyValue({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div style={rowStyle}>
      <span style={label}>{name}</span>
      <span style={value}>{children}</span>
    </div>
  );
}

function useStations() {
  const [state, setState] = useState<LoadState<Station[]>>(pendingState);
  const [progress, setProgress] = useState<PageProgress>({
    loaded: 0,
    target: MAX_STATIONS,
    failed: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  /**
   * State is only ever written from inside these callbacks, never synchronously
   * while an effect body is running.
   */
  const run = useCallback((bypassCache: boolean, signal: AbortSignal): void => {
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    discoverStations({
      signal,
      maxStations: MAX_STATIONS,
      pageSize: PAGE_SIZE,
      ...(bypassCache ? { store: createNoopStore() } : {}),
      onPage: (stations, pageProgress) => {
        if (signal.aborted) return;
        setProgress(pageProgress);
        setState({
          data: [...stations],
          meta: null,
          error: null,
          loading: true,
          elapsedMs: elapsed(),
        });
      },
    })
      .then((discovery) => {
        if (signal.aborted) return;
        setState({
          data: [...discovery.stations],
          meta: discovery.meta,
          error: null,
          loading: false,
          elapsedMs: elapsed(),
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState({
          data: null,
          meta: null,
          error: describeError(error),
          loading: false,
          elapsedMs: elapsed(),
        });
      });
  }, []);

  /** User-initiated reload: safe to set loading synchronously, we are in a handler. */
  const reload = useCallback(
    (bypassCache: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(pendingState<Station[]>());
      setProgress({ loaded: 0, target: MAX_STATIONS, failed: 0 });
      run(bypassCache, controller.signal);
    },
    [run],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    run(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [run]);

  return { state, progress, reload };
}

function useWeather() {
  const [state, setState] = useState<LoadState<WeatherSnapshot>>(pendingState);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback((lat: number, lng: number, signal: AbortSignal): void => {
    const startedAt = performance.now();
    fetchWeather(lat, lng, { signal })
      .then((result) => {
        if (signal.aborted) return;
        setState({
          data: result.weather,
          meta: result.meta,
          error: null,
          loading: false,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState({
          data: null,
          meta: null,
          error: describeError(error),
          loading: false,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      });
  }, []);

  const query = useCallback(
    (lat: number, lng: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState(pendingState<WeatherSnapshot>());
      run(lat, lng, controller.signal);
    },
    [run],
  );

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    run(Number(DEFAULT_LAT), Number(DEFAULT_LNG), controller.signal);
    return () => {
      controller.abort();
    };
  }, [run]);

  return { state, query };
}

/** Ticks once a second so the local clock is actually live. */
function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

function StationsPanel() {
  const { state, progress, reload } = useStations();
  const stations = state.data ?? [];
  const withGeo = stations.filter((station) => station.geo !== null).length;
  const healthy = stations.filter((station) => station.healthy).length;
  const countries = new Set(stations.map((station) => station.countryCode).filter(Boolean)).size;

  return (
    <section style={card}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Radio Browser · 电台目录</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={button}
            onClick={() => {
              reload(false);
            }}
          >
            重新加载
          </button>
          <button
            type="button"
            style={button}
            onClick={() => {
              reload(true);
            }}
          >
            绕过缓存
          </button>
        </div>
      </header>

      <p style={{ margin: '10px 0 0', color: 'var(--wl-text-dim)', fontSize: 12 }}>
        分页拉取 · 每页 {PAGE_SIZE} 条 · 目标 {MAX_STATIONS} 条 · 串行（上游对并发限流）
      </p>

      {state.loading && (
        <p
          data-testid="stations-loading"
          style={{ color: 'var(--wl-brass)', fontSize: 13, margin: '8px 0 0' }}
        >
          加载中 {progress.loaded} / {progress.target}
          {progress.failed > 0 ? ` · ${progress.failed} 页失败` : ''}
        </p>
      )}

      {state.error && (
        <p data-testid="stations-error" style={{ color: '#e2726e', fontSize: 13 }}>
          {state.error}
        </p>
      )}

      {state.data && (
        <div style={{ marginTop: 12 }}>
          <KeyValue name="拿到电台数">
            <strong data-testid="station-count">{stations.length}</strong>
          </KeyValue>
          <KeyValue name="其中有坐标">{withGeo}</KeyValue>
          <KeyValue name="健康">{healthy}</KeyValue>
          <KeyValue name="覆盖国家/地区">{countries}</KeyValue>
          <KeyValue name="命中的镜像">{state.meta?.endpoint ?? '—'}</KeyValue>
          <KeyValue name="来自缓存">
            {state.meta === null ? '加载中' : state.meta.fromCache ? '是' : '否'}
            {state.meta?.stale === true ? '（过期回退）' : ''}
          </KeyValue>
          <KeyValue name="失败页数">
            {state.meta === null
              ? `${progress.failed}（进行中）`
              : `${state.meta.failedPages ?? 0} / ${state.meta.totalPages ?? 0}`}
          </KeyValue>
          <KeyValue name="耗时">{state.elapsedMs ?? '—'} ms</KeyValue>
        </div>
      )}

      {stations.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ ...label, fontSize: 12, margin: '0 0 6px' }}>票数最高的 10 个</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12 }}>
            {stations.slice(0, 10).map((station) => (
              <li
                key={station.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '4px 0',
                  color: 'var(--wl-text-dim)',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {station.name}
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                  {station.countryCode || '??'} · {station.geo ? '📍' : '—'} ·{' '}
                  {station.votes.toLocaleString('en-US')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function WeatherPanel() {
  const [draftLat, setDraftLat] = useState(DEFAULT_LAT);
  const [draftLng, setDraftLng] = useState(DEFAULT_LNG);

  const { state, query } = useWeather();
  const now = useNow();
  const weather = state.data;

  const localTime = weather ? localTimeAt(weather.utcOffsetSeconds, now, 'zh-CN') : null;

  const inputStyle: React.CSSProperties = {
    background: 'var(--wl-bg)',
    border: '1px solid var(--wl-border)',
    borderRadius: 6,
    color: 'var(--wl-text)',
    padding: '6px 8px',
    fontSize: 13,
    width: 110,
    fontFamily: 'ui-monospace, monospace',
  };

  const submit = (nextLat: string, nextLng: string) => {
    const parsedLat = Number(nextLat);
    const parsedLng = Number(nextLng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return;
    query(parsedLat, parsedLng);
  };

  return (
    <section style={card}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Open-Meteo · 天气与时区</h2>

      <form
        style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}
        onSubmit={(event) => {
          event.preventDefault();
          submit(draftLat, draftLng);
        }}
      >
        <input
          aria-label="latitude"
          style={inputStyle}
          value={draftLat}
          onChange={(event) => {
            setDraftLat(event.target.value);
          }}
        />
        <input
          aria-label="longitude"
          style={inputStyle}
          value={draftLng}
          onChange={(event) => {
            setDraftLng(event.target.value);
          }}
        />
        <button type="submit" style={button}>
          查询
        </button>
        <button
          type="button"
          style={{ ...button, borderColor: 'var(--wl-border)', color: 'var(--wl-text-dim)' }}
          onClick={() => {
            setDraftLat(DEFAULT_LAT);
            setDraftLng(DEFAULT_LNG);
            submit(DEFAULT_LAT, DEFAULT_LNG);
          }}
        >
          东京
        </button>
      </form>

      {state.loading && <p style={{ color: 'var(--wl-text-dim)', fontSize: 13 }}>查询中…</p>}

      {state.error && (
        <p data-testid="weather-error" style={{ color: '#e2726e', fontSize: 13 }}>
          {state.error}
        </p>
      )}

      {weather && (
        <div style={{ marginTop: 12 }}>
          <KeyValue name="温度">
            <strong data-testid="weather-temp">{weather.temperatureC} °C</strong>
          </KeyValue>
          <KeyValue name="天气">
            {weather.kind}（WMO {weather.weatherCode}）
          </KeyValue>
          <KeyValue name="昼夜">{weather.isDay ? '白天' : '夜间'}</KeyValue>
          <KeyValue name="风速">{weather.windKph} km/h</KeyValue>
          <KeyValue name="IANA 时区">{weather.timezone}</KeyValue>
          <KeyValue name="UTC 偏移">{weather.utcOffsetSeconds} 秒</KeyValue>
          <KeyValue name="当地时间">
            <strong data-testid="local-time">{localTime?.display}</strong>
          </KeyValue>
          <KeyValue name="星期">{localTime?.weekday}</KeyValue>
          <KeyValue name="偏移标签">{localTime?.offsetLabel}</KeyValue>
          <KeyValue name="来源">{state.meta?.endpoint ?? '—'}</KeyValue>
          <KeyValue name="耗时">{state.elapsedMs ?? '—'} ms</KeyValue>
        </div>
      )}
    </section>
  );
}

export default function DataPage() {
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 64px' }}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ ...label, margin: 0, fontSize: 12, letterSpacing: '0.08em' }}>
          L1 数据层 · 独立验证页
        </p>
        <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 500 }}>/dev/data</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--wl-text-dim)', fontSize: 13 }}>
          真实网络请求，不打桩。出口标准：1000 个带坐标电台 + 任意城市天气时区。 首次约
          90s（上游限速）， IndexedDB 缓存后 &lt; 1s。
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <StationsPanel />
        <WeatherPanel />
      </div>
    </main>
  );
}
