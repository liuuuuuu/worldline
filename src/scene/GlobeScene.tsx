/**
 * The 3D stage as a React component.
 *
 * Thin on purpose: all three.js work lives in `createGlobeStage`. This component
 * mounts it, tracks coarse status (loading / ready / error), forwards pins and
 * hover events, and overlays the vignette and grain.
 *
 * Callbacks and the station list are routed through refs so that an inline arrow
 * function from the parent cannot tear down and rebuild the whole WebGL scene.
 * Every state write happens inside a promise callback — setting state
 * synchronously in an effect body triggers a cascading render, and the scene
 * setup is genuinely asynchronous anyway.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createGlobeStage,
  type GlobeStage,
  type HoverInfo,
  type SceneStats,
} from './createGlobeStage';
import type { Station } from '../types/domain';

export type { HoverInfo, SceneStats };

export interface GlobeSceneProps {
  /** Reported roughly twice a second. */
  onStats?: (stats: SceneStats) => void;
  onHover?: (info: HoverInfo | null) => void;
  onPick?: (station: Station) => void;
  /** Pins to render. Replaced in place when the reference changes. */
  stations?: readonly Station[];
  /** Idle spin, radians per second. Zero freezes the globe. */
  idleSpin?: number;
  /** Vertical camera angle limits, in degrees. */
  elevationRange?: readonly [number, number];
}

const DEFAULT_ELEVATION: readonly [number, number] = [6, 58];

export default function GlobeScene({
  onStats,
  onHover,
  onPick,
  stations,
  idleSpin = 0.03,
  elevationRange = DEFAULT_ELEVATION,
}: GlobeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<GlobeStage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Latest callbacks, read at call time so the scene effect never re-runs.
  const onStatsRef = useRef(onStats);
  const onHoverRef = useRef(onHover);
  const onPickRef = useRef(onPick);
  const stationsRef = useRef<readonly Station[]>(stations ?? []);

  useEffect(() => {
    onStatsRef.current = onStats;
    onHoverRef.current = onHover;
    onPickRef.current = onPick;
  }, [onStats, onHover, onPick]);

  const handleStats = useCallback((stats: SceneStats) => {
    onStatsRef.current?.(stats);
  }, []);

  const handleHover = useCallback((info: HoverInfo | null) => {
    onHoverRef.current?.(info);
  }, []);

  const handlePick = useCallback((station: Station) => {
    onPickRef.current?.(station);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    Promise.resolve()
      .then(() =>
        createGlobeStage(container, {
          idleSpin,
          elevationRange,
          onStats: handleStats,
          onHover: handleHover,
          onPick: handlePick,
        }),
      )
      .then((stage) => {
        if (disposed) {
          stage.dispose();
          return null;
        }
        stageRef.current = stage;
        // Pins may have arrived before the stage existed.
        stage.setStations(stationsRef.current);
        // Wrap rather than assign the method: an unbound `dispose` would be
        // called with the wrong `this`.
        teardown = () => {
          stageRef.current = null;
          stage.dispose();
        };
        // `skinReady` resolves to void, so wrap it — otherwise the next link
        // cannot tell "loaded" from "we bailed out".
        return stage.skinReady.then(() => true);
      })
      .then((ready) => {
        if (disposed || ready !== true) return;
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start the 3D scene');
        setStatus('error');
      });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [idleSpin, elevationRange, handleStats, handleHover, handlePick]);

  // Push pin changes into the live stage without rebuilding it.
  useEffect(() => {
    stationsRef.current = stations ?? [];
    stageRef.current?.setStations(stationsRef.current);
  }, [stations]);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Vignette and film grain live in the DOM rather than in a
          post-processing pass: it costs nothing and, crucially, it is part of
          the frame we screenshot. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.42) 100%)',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.05,
          mixBlendMode: 'overlay',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {status === 'loading' && (
        <p
          data-testid="globe-status"
          style={{
            position: 'absolute',
            left: 24,
            bottom: 20,
            margin: 0,
            fontSize: 12,
            color: 'var(--wl-text-dim)',
            letterSpacing: '0.06em',
          }}
        >
          正在绘制地图…
        </p>
      )}

      {status === 'error' && (
        <p
          data-testid="globe-status"
          style={{
            position: 'absolute',
            left: 24,
            bottom: 20,
            margin: 0,
            fontSize: 12,
            color: '#e2726e',
          }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
